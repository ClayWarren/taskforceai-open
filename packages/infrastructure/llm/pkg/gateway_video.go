package pkg

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	coreengine "github.com/TaskForceAI/core/pkg/engine"
)

const (
	defaultGatewayVideoGenerationURL   = "https://ai-gateway.vercel.sh/v3/ai/video-model"
	gatewayVideoProtocolVersion        = "0.0.1"
	defaultGatewayVideoGenerationRatio = "16:9"
	defaultGatewayVideoResolution      = "1280x720"
	defaultGatewayVideoDuration        = 10
	minGatewayVideoDuration            = 1
	maxGatewayVideoDuration            = 15
	defaultGatewayVideoPollTimeoutMs   = 600000
)

var gatewayVideoDurationPattern = regexp.MustCompile(`(?i)\b(\d{1,2})\s*(?:-| )?(?:s|sec|secs|second|seconds)\b`)

var (
	marshalGatewayVideoRequest = json.Marshal
	doGatewayVideoRequest      = func(req *http.Request) (*http.Response, error) {
		return (&http.Client{Timeout: 11 * time.Minute}).Do(req)
	}
)

type gatewayVideoRequest struct {
	Prompt          any            `json:"prompt"`
	N               int            `json:"n,omitempty"`
	AspectRatio     string         `json:"aspectRatio,omitempty"`
	Resolution      string         `json:"resolution,omitempty"`
	Duration        int            `json:"duration,omitempty"`
	ProviderOptions map[string]any `json:"providerOptions,omitempty"`
}

type gatewayVideoPromptData struct {
	Image string `json:"image"`
	Text  string `json:"text,omitempty"`
}

type gatewayVideoPromptInput struct {
	Text     string
	ImageURL string
}

type gatewayVideoEvent struct {
	Type             string             `json:"type"`
	Videos           []gatewayVideoData `json:"videos,omitempty"`
	Warnings         []any              `json:"warnings,omitempty"`
	ProviderMetadata map[string]any     `json:"providerMetadata,omitempty"`
	Message          string             `json:"message,omitempty"`
	ErrorType        string             `json:"errorType,omitempty"`
	StatusCode       int                `json:"statusCode,omitempty"`
	Param            any                `json:"param,omitempty"`
}

type gatewayVideoData struct {
	Type      string `json:"type"`
	URL       string `json:"url,omitempty"`
	Data      string `json:"data,omitempty"`
	MediaType string `json:"mediaType,omitempty"`
}

type gatewayErrorEnvelope struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

func gatewayStatusError(operation string, statusCode int, body []byte) error {
	message := strings.TrimSpace(string(body))
	var envelope gatewayErrorEnvelope
	if err := json.Unmarshal(body, &envelope); err == nil && strings.TrimSpace(envelope.Error.Message) != "" {
		message = strings.TrimSpace(envelope.Error.Message)
		if errorType := strings.TrimSpace(envelope.Error.Type); errorType != "" {
			message = fmt.Sprintf("%s (%s)", message, errorType)
		}
	}
	if message == "" {
		message = http.StatusText(statusCode)
	}
	return fmt.Errorf("%s failed with status %d: %s", operation, statusCode, message)
}

func isGatewayVideoGenerationModel(modelID string) bool {
	return strings.EqualFold(strings.TrimSpace(modelID), coreengine.VideoGenerationModelID)
}

func gatewayVideoEndpoint(baseURL string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" || strings.Contains(base, "api.openai.com") {
		return defaultGatewayVideoGenerationURL
	}
	if strings.HasSuffix(base, "/video-model") {
		return base
	}
	if strings.HasSuffix(base, "/v3/ai") {
		return base + "/video-model"
	}
	if before, ok := strings.CutSuffix(base, "/v1"); ok {
		return before + "/v3/ai/video-model"
	}
	return base + "/video-model"
}

func gatewayVideoAuth(cfgAPIKey string) (token string, method string) {
	if strings.TrimSpace(cfgAPIKey) != "" {
		return strings.TrimSpace(cfgAPIKey), "api-key"
	}
	if token := strings.TrimSpace(os.Getenv("AI_GATEWAY_API_KEY")); token != "" {
		return token, "api-key"
	}
	if token := strings.TrimSpace(os.Getenv("VERCEL_OIDC_TOKEN")); token != "" {
		return token, "oidc"
	}
	return "", ""
}

func gatewayVideoPromptInputFromParams(params agent.ChatCompletionCreateParams) gatewayVideoPromptInput {
	for _, v := range slices.Backward(params.Messages) {
		if v.Role == agent.RoleUser {
			input := gatewayVideoPromptInput{Text: strings.TrimSpace(v.TextContent())}
			for _, part := range v.ContentParts {
				if part.Type == agent.ContentPartImageURL && part.ImageURL != nil {
					input.ImageURL = strings.TrimSpace(part.ImageURL.URL)
					if input.ImageURL != "" {
						break
					}
				}
			}
			return input
		}
	}
	return gatewayVideoPromptInput{}
}

func gatewayVideoPromptText(params agent.ChatCompletionCreateParams) string {
	return gatewayVideoPromptInputFromParams(params).Text
}

func gatewayVideoPromptPayload(params agent.ChatCompletionCreateParams) (gatewayVideoPromptInput, any, error) {
	input := gatewayVideoPromptInputFromParams(params)
	if input.Text == "" {
		return input, nil, fmt.Errorf("no user prompt found for video generation")
	}
	if input.ImageURL == "" {
		return input, nil, fmt.Errorf("grok imagine video 1.5 requires an image attachment as the start frame")
	}
	return input, gatewayVideoPromptData{Image: input.ImageURL, Text: input.Text}, nil
}

func gatewayVideoPrompt(params agent.ChatCompletionCreateParams) string {
	return gatewayVideoPromptText(params)
}

func gatewayVideoStartFrame(params agent.ChatCompletionCreateParams) string {
	return gatewayVideoPromptInputFromParams(params).ImageURL
}

func gatewayVideoDuration(prompt string) int {
	duration := defaultGatewayVideoDuration
	if match := gatewayVideoDurationPattern.FindStringSubmatch(prompt); len(match) == 2 {
		if parsed, err := strconv.Atoi(match[1]); err == nil {
			duration = parsed
		}
	}
	if duration < minGatewayVideoDuration {
		return minGatewayVideoDuration
	}
	if duration > maxGatewayVideoDuration {
		return maxGatewayVideoDuration
	}
	return duration
}

func (a *OpenAIAdapter) createGatewayVideoCompletion(ctx context.Context, params agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	input, promptPayload, err := gatewayVideoPromptPayload(params)
	if err != nil {
		return nil, err
	}

	token, authMethod := gatewayVideoAuth(a.cfg.Gateway.APIKey)
	if token == "" {
		return nil, fmt.Errorf("AI Gateway credentials are required for video generation")
	}

	payload := gatewayVideoRequest{
		Prompt:      promptPayload,
		N:           1,
		AspectRatio: defaultGatewayVideoGenerationRatio,
		Resolution:  defaultGatewayVideoResolution,
		Duration:    gatewayVideoDuration(input.Text),
		ProviderOptions: map[string]any{
			"xai": map[string]any{
				"pollTimeoutMs": defaultGatewayVideoPollTimeoutMs,
			},
		},
	}
	body, err := marshalGatewayVideoRequest(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal video generation request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gatewayVideoEndpoint(a.cfg.Gateway.BaseURL), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create video generation request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("ai-gateway-protocol-version", gatewayVideoProtocolVersion)
	req.Header.Set("ai-gateway-auth-method", authMethod)
	req.Header.Set("ai-video-model-specification-version", "3")
	req.Header.Set("ai-model-id", params.Model)
	for key, value := range a.cfg.Gateway.DefaultHeaders {
		req.Header.Set(key, value)
	}

	resp, err := doGatewayVideoRequest(req)
	if err != nil {
		return nil, fmt.Errorf("video generation request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errorBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, gatewayStatusError("video generation", resp.StatusCode, errorBody)
	}

	event, err := readGatewayVideoEvent(resp.Body)
	if err != nil {
		return nil, err
	}
	if event.Type == "error" {
		if event.Message == "" {
			event.Message = "video generation failed"
		}
		return nil, fmt.Errorf("video generation failed: %s", event.Message)
	}
	// readGatewayVideoEvent only ever returns "result" or "error" events, and
	// the "error" case is handled above, so event.Type is always "result" here.

	content, err := gatewayVideoMarkdown(event.Videos)
	if err != nil {
		return nil, err
	}

	return &agent.ChatCompletion{
		ID: "gateway-video",
		Choices: []agent.ChatCompletionChoice{{
			Message: agent.ChatCompletionMessage{
				Role:    agent.RoleAssistant,
				Content: content,
			},
		}},
	}, nil
}

func readGatewayVideoEvent(r io.Reader) (*gatewayVideoEvent, error) {
	reader := bufio.NewReader(r)
	for {
		line, err := reader.ReadString('\n')
		if err != nil && len(line) == 0 {
			if err == io.EOF {
				return nil, fmt.Errorf("video generation stream ended without a result")
			}
			return nil, fmt.Errorf("read video generation stream: %w", err)
		}

		line = strings.TrimSpace(line)
		if after, ok := strings.CutPrefix(line, "data:"); ok {
			data := strings.TrimSpace(after)
			if data == "" || data == "[DONE]" {
				continue
			}
			var event gatewayVideoEvent
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				return nil, fmt.Errorf("parse video generation event: %w", err)
			}
			switch event.Type {
			case "result", "error":
				return &event, nil
			default:
				continue
			}
		}

		if err == io.EOF {
			return nil, fmt.Errorf("video generation stream ended without a result")
		}
	}
}

func gatewayVideoMarkdown(videos []gatewayVideoData) (string, error) {
	if len(videos) == 0 {
		return "", fmt.Errorf("video generation returned no videos")
	}
	video := videos[0]
	mediaType := strings.TrimSpace(video.MediaType)
	if mediaType == "" {
		mediaType = "video/mp4"
	}

	switch video.Type {
	case "url":
		if strings.TrimSpace(video.URL) == "" {
			return "", fmt.Errorf("video generation returned an empty video URL")
		}
		escapedURL := html.EscapeString(video.URL)
		escapedMediaType := html.EscapeString(mediaType)
		return fmt.Sprintf(
			"<video controls preload=\"metadata\" playsinline><source src=\"%s\" type=\"%s\">Download the generated video below.</video>\n\n[Download generated video](%s)",
			escapedURL,
			escapedMediaType,
			video.URL,
		), nil
	case "base64":
		if strings.TrimSpace(video.Data) == "" {
			return "", fmt.Errorf("video generation returned empty video data")
		}
		dataURI := fmt.Sprintf("data:%s;base64,%s", mediaType, video.Data)
		return fmt.Sprintf(
			"<video controls preload=\"metadata\" playsinline><source src=\"%s\" type=\"%s\">Generated video.</video>",
			html.EscapeString(dataURI),
			html.EscapeString(mediaType),
		), nil
	default:
		return "", fmt.Errorf("video generation returned unsupported video type %q", video.Type)
	}
}
