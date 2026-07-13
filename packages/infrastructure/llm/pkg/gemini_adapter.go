package pkg

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"iter"
	"log/slog"
	"mime"
	"net/url"
	"os"
	"path"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/upstream"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/genai"
)

func isGeminiRetryableError(err error) bool {
	return upstream.IsTransientError(err, "quota exceeded")
}

type IGeminiModels interface {
	GenerateContent(ctx context.Context, modelID string, contents []*genai.Content, config *genai.GenerateContentConfig) (*genai.GenerateContentResponse, error)
	GenerateContentStream(ctx context.Context, modelID string, contents []*genai.Content, config *genai.GenerateContentConfig) iter.Seq2[*genai.GenerateContentResponse, error]
	GenerateImages(ctx context.Context, modelID string, prompt string, config *genai.GenerateImagesConfig) (*genai.GenerateImagesResponse, error)
}

type IGeminiFiles interface {
	Upload(ctx context.Context, r io.Reader, config *genai.UploadFileConfig) (*genai.File, error)
	Get(ctx context.Context, name string, config *genai.GetFileConfig) (*genai.File, error)
}

type GeminiAdapter struct {
	cfg                      config.Config
	client                   IGeminiModels
	files                    IGeminiFiles
	breaker                  *circuitbreaker.CircuitBreaker
	fileProcessingInterval   time.Duration
	fileProcessingMaxRetries int
	streamChunkTimeout       time.Duration
}

var (
	geminiBreakerOnce sync.Once
	geminiBreaker     *circuitbreaker.CircuitBreaker
)

func getGeminiCircuitBreaker() *circuitbreaker.CircuitBreaker {
	geminiBreakerOnce.Do(func() {
		geminiBreaker = upstream.NewCircuitBreaker("llm_gemini", 30*time.Second, isGeminiRetryableError)
	})
	return geminiBreaker
}

func NewGeminiAdapter(ctx context.Context, cfg config.Config) (*GeminiAdapter, error) {
	apiKey := cfg.Gateway.APIKey
	if apiKey == "" {
		apiKey = os.Getenv("GEMINI_API_KEY")
	}

	clientConfig := &genai.ClientConfig{
		APIKey: apiKey,
	}

	client, err := genai.NewClient(ctx, clientConfig)
	if err != nil {
		slog.Error("Failed to create Gemini client", "error", err)
		return nil, fmt.Errorf("failed to create gemini client: %w", err)
	}

	return &GeminiAdapter{
		cfg:                      cfg,
		client:                   client.Models,
		files:                    client.Files,
		breaker:                  getGeminiCircuitBreaker(),
		fileProcessingInterval:   5 * time.Second,
		fileProcessingMaxRetries: 60,
		streamChunkTimeout:       defaultStreamChunkTimeout,
	}, nil
}

func normalizeGeminiModelID(modelID string) string {
	return strings.TrimPrefix(modelID, "google/")
}

func (a *GeminiAdapter) gatewayHTTPOptions() *genai.HTTPOptions {
	baseURL := normalizeGeminiGatewayBaseURL(a.cfg.Gateway.BaseURL)
	if baseURL == "" {
		return nil
	}
	return &genai.HTTPOptions{BaseURL: baseURL}
}

func normalizeGeminiGatewayBaseURL(baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return ""
	}
	if before, ok := strings.CutSuffix(baseURL, "/v1beta"); ok {
		return before
	}
	if before, ok := strings.CutSuffix(baseURL, "/v1"); ok {
		return before
	}
	return baseURL
}

func isAIGatewayBaseURL(baseURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Host, "ai-gateway.vercel.sh") ||
		strings.HasSuffix(strings.ToLower(parsed.Host), ".ai-gateway.vercel.sh") ||
		strings.EqualFold(parsed.Host, "api.vercel.ai")
}

func isGeminiImageGenerationModel(modelID string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(modelID)), "flash-image")
}

func (a *GeminiAdapter) streamTimeout() time.Duration {
	if a.streamChunkTimeout > 0 {
		return a.streamChunkTimeout
	}
	return 15 * time.Second
}

func sanitizeGeneratedImageMIMEType(mimeType string) (string, bool) {
	if strings.TrimSpace(mimeType) == "" {
		return "image/png", true
	}

	parsedMIMEType, _, err := mime.ParseMediaType(mimeType)
	if err != nil {
		return "", false
	}

	switch strings.ToLower(strings.TrimSpace(parsedMIMEType)) {
	case "image/png", "image/jpeg", "image/webp":
		return parsedMIMEType, true
	default:
		return "", false
	}
}

func (a *GeminiAdapter) CreateChatCompletion(ctx context.Context, params agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	ctx, span := startModelSpan(ctx, "gen_ai.client.chat.completions", "gemini", params.Model)
	defer span.End()

	if isGeminiImageGenerationModel(params.Model) {
		return a.generateImage(ctx, params)
	}

	systemInstruction, contents := a.mapMessages(params.Messages)
	config := &genai.GenerateContentConfig{
		SystemInstruction: systemInstruction,
		Tools:             a.mapTools(params.Tools),
	}
	if params.Temperature != nil {
		temp := float32(*params.Temperature)
		config.Temperature = &temp
	}

	config.HTTPOptions = a.gatewayHTTPOptions()

	modelID := normalizeGeminiModelID(params.Model)
	return runCompletionWithResilience(
		ctx,
		span,
		a.breaker,
		isGeminiRetryableError,
		modelID,
		"Gemini generate content failed (with resilience)",
		"gemini generate content returned nil response",
		func(retryCtx context.Context) (*agent.ChatCompletion, error) {
			resp, err := a.client.GenerateContent(retryCtx, modelID, contents, config)
			if err != nil {
				return nil, err
			}
			return a.toCoreCompletion(resp), nil
		},
	)
}

func (a *GeminiAdapter) generateImage(ctx context.Context, params agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	ctx, span := startModelSpan(ctx, "gen_ai.client.image_generation", "gemini", params.Model)
	defer span.End()

	// Extract the last user message as the prompt
	prompt := ""
	for _, v := range slices.Backward(params.Messages) {
		if v.Role == agent.RoleUser {
			prompt = v.TextContent()
			break
		}
	}

	if prompt == "" {
		err := fmt.Errorf("no user prompt found for image generation")
		recordSpanError(span, err)
		return nil, err
	}

	if isAIGatewayBaseURL(a.cfg.Gateway.BaseURL) || (a.client == nil && strings.TrimSpace(a.cfg.Gateway.BaseURL) != "") {
		return a.generateGatewayImage(ctx, params, prompt)
	}

	modelID := normalizeGeminiModelID(params.Model)
	imgConfig := &genai.GenerateContentConfig{
		ResponseModalities: []string{"IMAGE", "TEXT"},
	}
	imgConfig.HTTPOptions = a.gatewayHTTPOptions()

	resp, err := a.client.GenerateContent(ctx, modelID, genai.Text(prompt), imgConfig)
	if err != nil {
		recordSpanError(span, err)
		slog.Error("Gemini image generation failed", "model", modelID, "error", err)
		return nil, err
	}

	choices := make([]agent.ChatCompletionChoice, 0, 1)
	for _, candidate := range resp.Candidates {
		if candidate == nil || candidate.Content == nil {
			continue
		}
		for _, part := range candidate.Content.Parts {
			if part == nil || part.InlineData == nil || len(part.InlineData.Data) == 0 {
				continue
			}
			mimeType, ok := sanitizeGeneratedImageMIMEType(part.InlineData.MIMEType)
			if !ok {
				slog.Warn("Gemini image generation returned unsupported MIME type", "mimeType", part.InlineData.MIMEType)
				continue
			}

			b64 := base64.StdEncoding.EncodeToString(part.InlineData.Data)
			dataURI := fmt.Sprintf("data:%s;base64,%s", mimeType, b64)
			markdown := fmt.Sprintf("![Generated Image](%s)", dataURI)

			choices = append(choices, agent.ChatCompletionChoice{
				Message: agent.ChatCompletionMessage{
					Role:    agent.RoleAssistant,
					Content: markdown,
				},
			})
			break
		}
		if len(choices) > 0 {
			break
		}
	}

	if len(choices) == 0 {
		err := fmt.Errorf("no images were generated")
		recordSpanError(span, err)
		return nil, err
	}

	return &agent.ChatCompletion{
		Choices: choices,
	}, nil
}

func (a *GeminiAdapter) CreateChatCompletionStream(ctx context.Context, params agent.ChatCompletionCreateParams, onChunk func(agent.ChatCompletionChunk)) error {
	ctx, span := startModelSpan(ctx, "gen_ai.client.chat.completions.stream", "gemini", params.Model)
	defer span.End()

	if isGeminiImageGenerationModel(params.Model) {
		// Image generation doesn't support streaming, so we return the whole thing as one chunk
		resp, err := a.CreateChatCompletion(ctx, params)
		if err != nil {
			recordSpanError(span, err)
			return err
		}
		if resp == nil {
			err := fmt.Errorf("gemini image generation returned nil response")
			recordSpanError(span, err)
			return err
		}
		if len(resp.Choices) == 0 || onChunk == nil {
			return nil
		}
		onChunk(agent.ChatCompletionChunk{
			Choices: []agent.ChatCompletionChunkChoice{
				{
					Delta: agent.ChatCompletionChunkDelta{
						Content: resp.Choices[0].Message.Content,
					},
				},
			},
		})
		return nil
	}

	systemInstruction, contents := a.mapMessages(params.Messages)
	config := &genai.GenerateContentConfig{
		SystemInstruction: systemInstruction,
		Tools:             a.mapTools(params.Tools),
	}
	if params.Temperature != nil {
		temp := float32(*params.Temperature)
		config.Temperature = &temp
	}

	config.HTTPOptions = a.gatewayHTTPOptions()

	modelID := normalizeGeminiModelID(params.Model)
	return a.breaker.Execute(ctx, func() error {
		streamCtx, streamCancel := context.WithCancel(ctx)
		defer streamCancel()

		iter := a.client.GenerateContentStream(streamCtx, modelID, contents, config)
		toolCallState := newGeminiToolCallState()

		type chunkResult struct {
			resp *genai.GenerateContentResponse
			err  error
		}
		ch := make(chan chunkResult)

		go func() {
			defer close(ch)
			for resp, err := range iter {
				select {
				case ch <- chunkResult{resp: resp, err: err}:
				case <-streamCtx.Done():
					return
				}
				if err != nil {
					return
				}
			}
		}()

		for {
			chunkCtx, chunkCancel := context.WithTimeout(ctx, a.streamTimeout())
			select {
			case res, ok := <-ch:
				chunkCancel()
				if !ok {
					return nil
				}
				if res.err != nil {
					recordSpanError(span, res.err)
					slog.Error("Gemini streaming failed", "model", modelID, "error", res.err)
					return res.err
				}
				if onChunk != nil {
					onChunk(a.toCoreChunkWithState(res.resp, toolCallState))
				}
			case <-chunkCtx.Done():
				chunkCancel()
				streamCancel()
				recordSpanError(span, chunkCtx.Err())
				setSpanError(span, "stream chunk timeout")
				slog.Error("Gemini streaming chunk timeout", "model", modelID)
				return chunkCtx.Err()
			case <-ctx.Done():
				chunkCancel()
				streamCancel()
				return ctx.Err()
			}
		}
	})
}

func (a *GeminiAdapter) mapMessages(messages []agent.ChatCompletionMessage) (*genai.Content, []*genai.Content) {
	var systemParts []*genai.Part
	contents := make([]*genai.Content, 0, len(messages))
	toolNameByCallID := make(map[string]string)

	for _, m := range messages {
		if m.Role == agent.RoleAssistant {
			for _, tc := range m.ToolCalls {
				callID := strings.TrimSpace(tc.ID)
				name := strings.TrimSpace(tc.Function.Name)
				if callID != "" && name != "" {
					toolNameByCallID[callID] = name
				}
			}
		}

		if m.Role == agent.RoleSystem {
			systemParts = append(systemParts, a.mapContentParts(m)...)
			continue
		}

		if m.Role == agent.RoleTool {
			toolName := strings.TrimSpace(toolNameByCallID[m.ToolID])
			if toolName == "" {
				toolName = strings.TrimSpace(m.ToolID)
			}
			if toolName == "" {
				toolName = "tool_result"
			}
			contents = append(contents, genai.NewContentFromParts([]*genai.Part{
				{
					FunctionResponse: &genai.FunctionResponse{
						ID:       strings.TrimSpace(m.ToolID),
						Name:     toolName,
						Response: parseToolResponsePayload(m.Content),
					},
				},
			}, genai.Role("user")))
			continue
		}

		role := genai.Role("user")
		if m.Role == agent.RoleAssistant {
			role = genai.Role("model")
		}

		parts := a.mapContentParts(m)
		contents = append(contents, genai.NewContentFromParts(parts, role))
	}

	var systemInstruction *genai.Content
	if len(systemParts) > 0 {
		systemInstruction = genai.NewContentFromParts(systemParts, genai.Role("system"))
	}

	return systemInstruction, contents
}

func (a *GeminiAdapter) mapContentParts(m agent.ChatCompletionMessage) []*genai.Part {
	if len(m.ContentParts) == 0 {
		return []*genai.Part{genai.NewPartFromText(m.Content)}
	}

	var parts []*genai.Part
	for _, p := range m.ContentParts {
		switch p.Type {
		case agent.ContentPartText:
			parts = append(parts, genai.NewPartFromText(p.Text))
		case agent.ContentPartImageURL:
			if p.ImageURL == nil || strings.TrimSpace(p.ImageURL.URL) == "" {
				continue
			}
			if strings.HasPrefix(p.ImageURL.URL, "data:") {
				mime, data := parseDataURI(p.ImageURL.URL)
				parts = append(parts, genai.NewPartFromBytes(data, mime))
			} else {
				parts = append(parts, genai.NewPartFromURI(p.ImageURL.URL, inferImageMimeType(p.ImageURL.URL)))
			}
		case agent.ContentPartFileData:
			if p.FileData != nil {
				parts = append(parts, genai.NewPartFromURI(p.FileData.FileURI, p.FileData.MimeType))
			}
		case agent.ContentPartInputAudio:
			// Gemini supports audio via URI or inline bytes.
			// For now we treat it like an image part if base64 is provided.
			if p.InputAudio != nil {
				decoded, err := base64.StdEncoding.DecodeString(p.InputAudio.Data)
				if err == nil {
					parts = append(parts, genai.NewPartFromBytes(decoded, "audio/"+p.InputAudio.Format))
				} else {
					slog.Error("Failed to decode base64 audio", "error", err)
				}
			}
		}
	}
	return parts
}

func (a *GeminiAdapter) toCoreCompletion(resp *genai.GenerateContentResponse) *agent.ChatCompletion {
	choices := make([]agent.ChatCompletionChoice, 0, len(resp.Candidates))
	for _, c := range resp.Candidates {
		var content strings.Builder
		var tcs []agent.ToolCall
		if c.Content != nil {
			for _, p := range c.Content.Parts {
				if p.Text != "" {
					content.WriteString(p.Text)
				}
				if p.FunctionCall != nil {
					args, err := json.Marshal(p.FunctionCall.Args)
					if err != nil {
						slog.Error("Failed to marshal Gemini function call arguments", "error", err)
						args = []byte("{}")
					}
					tcs = append(tcs, agent.ToolCall{
						ID:   p.FunctionCall.ID,
						Type: "function",
						Function: agent.ToolCallFunction{
							Name:      p.FunctionCall.Name,
							Arguments: string(args),
						},
					})
				}
			}
		}
		choices = append(choices, agent.ChatCompletionChoice{
			Message: agent.ChatCompletionMessage{
				Role:      agent.RoleAssistant,
				Content:   content.String(),
				ToolCalls: tcs,
			},
		})
	}

	usage := agent.ChatCompletionUsage{}
	if resp.UsageMetadata != nil {
		usage.PromptTokens = int64(resp.UsageMetadata.PromptTokenCount)
		usage.CompletionTokens = int64(resp.UsageMetadata.CandidatesTokenCount)
		usage.TotalTokens = int64(resp.UsageMetadata.TotalTokenCount)
	}

	return &agent.ChatCompletion{
		Choices: choices,
		Usage:   usage,
	}
}

type geminiToolCallState struct {
	nextToolCallIndex int
	toolCallByID      map[string]int
}

func newGeminiToolCallState() *geminiToolCallState {
	return &geminiToolCallState{
		toolCallByID: make(map[string]int),
	}
}

func (s *geminiToolCallState) indexFor(callID string) int {
	callID = strings.TrimSpace(callID)
	if callID != "" {
		if idx, ok := s.toolCallByID[callID]; ok {
			return idx
		}
	}

	idx := s.nextToolCallIndex
	s.nextToolCallIndex++
	if callID != "" {
		s.toolCallByID[callID] = idx
	}
	return idx
}

func (a *GeminiAdapter) toCoreChunkWithState(resp *genai.GenerateContentResponse, state *geminiToolCallState) agent.ChatCompletionChunk {
	if state == nil {
		state = newGeminiToolCallState()
	}

	choices := make([]agent.ChatCompletionChunkChoice, 0, len(resp.Candidates))
	for _, c := range resp.Candidates {
		var delta strings.Builder
		var tcs []agent.ToolCall
		if c.Content != nil {
			for _, p := range c.Content.Parts {
				if p.Text != "" {
					delta.WriteString(p.Text)
				}
				if p.FunctionCall != nil {
					idx := state.indexFor(p.FunctionCall.ID)
					args, _ := json.Marshal(p.FunctionCall.Args)
					tcs = append(tcs, agent.ToolCall{
						Index: &idx,
						ID:    p.FunctionCall.ID,
						Type:  "function",
						Function: agent.ToolCallFunction{
							Name:      p.FunctionCall.Name,
							Arguments: string(args),
						},
					})
				}
			}
		}
		choices = append(choices, agent.ChatCompletionChunkChoice{
			Delta: agent.ChatCompletionChunkDelta{
				Content:   delta.String(),
				ToolCalls: tcs,
			},
		})
	}

	chunk := agent.ChatCompletionChunk{
		Choices: choices,
	}

	if resp.UsageMetadata != nil {
		chunk.Usage = &agent.ChatCompletionUsage{
			PromptTokens:     int64(resp.UsageMetadata.PromptTokenCount),
			CompletionTokens: int64(resp.UsageMetadata.CandidatesTokenCount),
			TotalTokens:      int64(resp.UsageMetadata.TotalTokenCount),
		}
	}

	return chunk
}

// UploadFile handles the specific Gemini File API upload logic.
func (a *GeminiAdapter) UploadFile(ctx context.Context, reader io.Reader, filename, mimeType string) (string, error) {
	ctx, span := tracer.Start(ctx, "gen_ai.client.file.upload", trace.WithAttributes(
		attribute.String("gen_ai.system", "gemini"),
		attribute.String("file.name", filename),
		attribute.String("file.mime_type", mimeType),
	))
	defer span.End()

	tempFile, err := os.CreateTemp("", "gemini-upload-*")
	if err != nil {
		recordSpanError(span, err)
		slog.Error("Failed to create temp file for upload", "filename", filename, "error", err)
		return "", err
	}
	defer func() { _ = os.Remove(tempFile.Name()) }()
	defer func() { _ = tempFile.Close() }()

	if _, err := io.Copy(tempFile, reader); err != nil {
		recordSpanError(span, err)
		slog.Error("Failed to copy to temp file", "filename", filename, "error", err)
		return "", err
	}

	// Rewind or re-open
	f, err := os.Open(tempFile.Name())
	if err != nil {
		recordSpanError(span, err)
		slog.Error("Failed to open temp file", "filename", filename, "error", err)
		return "", err
	}
	defer func() { _ = f.Close() }()

	resp, err := a.files.Upload(ctx, f, &genai.UploadFileConfig{
		DisplayName: filename,
		MIMEType:    mimeType,
		HTTPOptions: a.gatewayHTTPOptions(),
	})
	if err != nil {
		recordSpanError(span, err)
		slog.Error("Gemini file upload failed", "filename", filename, "mimeType", mimeType, "error", err)
		return "", err
	}

	// Wait for processing if it's a video
	if strings.HasPrefix(mimeType, "video/") {
		for i := 0; resp.State == "PROCESSING" && i < a.fileProcessingMaxRetries; i++ {
			select {
			case <-ctx.Done():
				err = fmt.Errorf("context cancelled while waiting for file processing: %w", ctx.Err())
				recordSpanError(span, err)
				slog.Error("Context cancelled while waiting for file processing", "filename", filename)
				return "", err
			case <-time.After(a.fileProcessingInterval):
			}
			resp, err = a.files.Get(ctx, resp.Name, &genai.GetFileConfig{
				HTTPOptions: a.gatewayHTTPOptions(),
			})
			if err != nil {
				recordSpanError(span, err)
				slog.Error("Failed to get file status during processing", "filename", filename, "error", err)
				return "", err
			}
		}
		if resp.State == "PROCESSING" {
			err = fmt.Errorf("file processing timed out after %d retries", a.fileProcessingMaxRetries)
			recordSpanError(span, err)
			slog.Error("File processing timed out", "filename", filename, "retries", a.fileProcessingMaxRetries)
			return "", err
		}
		if resp.State == "FAILED" {
			err = fmt.Errorf("file processing failed")
			recordSpanError(span, err)
			slog.Error("File processing failed", "filename", filename)
			return "", err
		}
	}

	return resp.URI, nil
}

// parseDataURI extracts the MIME type and decoded bytes from a data URI.
// Falls back to "image/jpeg" if the URI cannot be parsed.
func parseDataURI(uri string) (string, []byte) {
	// Format: data:<mime>;base64,<data>
	after, ok := strings.CutPrefix(uri, "data:")
	if !ok {
		return "image/jpeg", []byte(uri)
	}
	mimeEnd := strings.Index(after, ";")
	commaIdx := strings.Index(after, ",")
	if mimeEnd < 0 || commaIdx < 0 || commaIdx <= mimeEnd {
		return "image/jpeg", []byte(uri)
	}
	mime := after[:mimeEnd]
	if mime == "" {
		mime = "image/jpeg"
	}
	encoded := after[commaIdx+1:]
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		// Try raw encoding (no padding)
		decoded, err = base64.RawStdEncoding.DecodeString(encoded)
		if err != nil {
			return mime, []byte(encoded)
		}
	}
	return mime, decoded
}

func inferImageMimeType(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	pathValue := rawURL
	if err == nil && parsed.Path != "" {
		pathValue = parsed.Path
	}

	switch strings.ToLower(path.Ext(pathValue)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".bmp":
		return "image/bmp"
	case ".tif", ".tiff":
		return "image/tiff"
	case ".svg":
		return "image/svg+xml"
	case ".avif":
		return "image/avif"
	case ".heic":
		return "image/heic"
	case ".heif":
		return "image/heif"
	default:
		return "image/jpeg"
	}
}

func parseToolResponsePayload(content string) map[string]any {
	trimmed := strings.TrimSpace(content)
	if trimmed == "" {
		return map[string]any{"output": ""}
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
		return parsed
	}

	return map[string]any{"output": content}
}

func (a *GeminiAdapter) mapTools(tools []agent.ToolDefinition) []*genai.Tool {
	if len(tools) == 0 {
		return nil
	}

	var funcs []*genai.FunctionDeclaration
	for _, t := range tools {
		if t.Type != "function" {
			continue
		}

		funcs = append(funcs, &genai.FunctionDeclaration{
			Name:                 t.Function.Name,
			Description:          t.Function.Description,
			ParametersJsonSchema: t.Function.Parameters,
		})
	}

	if len(funcs) == 0 {
		return nil
	}

	return []*genai.Tool{
		{
			FunctionDeclarations: funcs,
		},
	}
}
