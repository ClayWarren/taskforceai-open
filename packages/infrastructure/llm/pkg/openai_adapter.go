package pkg

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	corechat "github.com/TaskForceAI/core/pkg/chat"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/upstream"
	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/packages/ssestream"
	"github.com/openai/openai-go/v3/responses"
	openaishared "github.com/openai/openai-go/v3/shared"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

func isOpenAIRetryableError(err error) bool {
	return upstream.IsTransientError(err)
}

type IOpenAIResponses interface {
	New(ctx context.Context, body responses.ResponseNewParams, opts ...option.RequestOption) (res *responses.Response, err error)
	NewStreaming(ctx context.Context, body responses.ResponseNewParams, opts ...option.RequestOption) (stream *ssestream.Stream[responses.ResponseStreamEventUnion])
}

type OpenAIAdapter struct {
	cfg                  config.Config
	defaultClient        IOpenAIResponses
	mu                   sync.Mutex
	clients              map[string]IOpenAIResponses
	fileClients          map[string]*openai.FileService
	customBaseURLByModel map[string]string
	breaker              *circuitbreaker.CircuitBreaker
	clientFactory        func(baseURL string) *openai.Client
	files                *openai.FileService
}

const defaultOpenAIBaseURL = "https://api.openai.com/v1/"
const missingOpenAIAPIKey = "missing"

var (
	openAIBreakersMu sync.Mutex
	openAIBreakers   = make(map[string]*circuitbreaker.CircuitBreaker)
)

var marshalResponseInputAudio = json.Marshal

func getOpenAICircuitBreaker(baseURL string) *circuitbreaker.CircuitBreaker {
	key := normalizeBaseURL(strings.TrimSpace(baseURL))
	if key == "" {
		key = defaultOpenAIBaseURL
	}

	openAIBreakersMu.Lock()
	defer openAIBreakersMu.Unlock()
	if breaker, ok := openAIBreakers[key]; ok {
		return breaker
	}
	breaker := upstream.NewCircuitBreaker("llm_openai", 30*time.Second, isOpenAIRetryableError)
	openAIBreakers[key] = breaker
	return breaker
}

func NewOpenAIAdapter(cfg config.Config) *OpenAIAdapter {
	a := &OpenAIAdapter{
		cfg:                  cfg,
		clients:              make(map[string]IOpenAIResponses),
		fileClients:          make(map[string]*openai.FileService),
		customBaseURLByModel: buildOpenAICustomBaseURLByModel(cfg.Models.Options),
		breaker:              getOpenAICircuitBreaker(cfg.Gateway.BaseURL),
	}
	a.clientFactory = a.createClient
	client := a.clientFactory(cfg.Gateway.BaseURL)
	a.defaultClient = &client.Responses
	a.files = &client.Files
	return a
}

func buildOpenAICustomBaseURLByModel(options []config.ModelOption) map[string]string {
	if len(options) == 0 {
		return nil
	}

	baseURLByModel := make(map[string]string)
	for _, opt := range options {
		if opt.ID == "" || opt.BaseURL == "" {
			continue
		}
		if _, exists := baseURLByModel[opt.ID]; exists {
			continue
		}
		baseURLByModel[opt.ID] = opt.BaseURL
	}
	if len(baseURLByModel) == 0 {
		return nil
	}
	return baseURLByModel
}

func normalizeBaseURL(baseURL string) string {
	if baseURL == "" {
		return ""
	}
	if !strings.HasSuffix(baseURL, "/") {
		baseURL += "/"
	}
	return baseURL
}

func (a *OpenAIAdapter) createClient(baseURL string) *openai.Client {
	apiKey := strings.TrimSpace(a.cfg.Gateway.APIKey)
	if apiKey == "" {
		apiKey = missingOpenAIAPIKey
	}
	opts := []option.RequestOption{option.WithAPIKey(apiKey)}

	baseURL = normalizeBaseURL(baseURL)
	if baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
	}

	// Add default headers from config
	for k, v := range a.cfg.Gateway.DefaultHeaders {
		opts = append(opts, option.WithHeader(k, v))
	}

	client := openai.NewClient(opts...)
	return &client
}

func (a *OpenAIAdapter) customBaseURLForModel(modelID string) string {
	return a.customBaseURLByModel[modelID]
}

func (a *OpenAIAdapter) circuitBreakerForModel(modelID string) *circuitbreaker.CircuitBreaker {
	if customBaseURL := a.customBaseURLForModel(modelID); customBaseURL != "" {
		return getOpenAICircuitBreaker(customBaseURL)
	}
	return a.breaker
}

func (a *OpenAIAdapter) getClient(modelID string) IOpenAIResponses {
	customBaseURL := a.customBaseURLForModel(modelID)
	if customBaseURL == "" {
		return a.defaultClient
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	if client, ok := a.clients[customBaseURL]; ok {
		return client
	}

	client := &a.clientFactory(customBaseURL).Responses
	a.clients[customBaseURL] = client
	return client
}

func (a *OpenAIAdapter) getFileService(modelID string) *openai.FileService {
	customBaseURL := a.customBaseURLForModel(modelID)
	if customBaseURL == "" {
		return a.files
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	if filesClient, ok := a.fileClients[customBaseURL]; ok {
		return filesClient
	}

	client := a.clientFactory(customBaseURL)
	filesClient := &client.Files
	a.fileClients[customBaseURL] = filesClient
	return filesClient
}

// UploadFile handles the specific OpenAI Files API upload logic.
func (a *OpenAIAdapter) UploadFile(ctx context.Context, reader io.Reader, filename, mimeType string) (string, error) {
	ctx, span := tracer.Start(ctx, "gen_ai.client.file.upload", trace.WithAttributes(
		attribute.String("gen_ai.system", "openai"),
		attribute.String("file.name", filename),
		attribute.String("file.mime_type", mimeType),
	))
	defer span.End()

	modelID := uploadModelFromContext(ctx)
	fileService := a.getFileService(modelID)

	resp, err := fileService.New(ctx, openai.FileNewParams{
		File:    reader,
		Purpose: openai.FilePurposeUserData,
	})

	if err != nil {
		recordSpanError(span, err)
		slog.Error("OpenAI file upload failed", "filename", filename, "mimeType", mimeType, "error", err)
		return "", err
	}

	slog.Info("OpenAI file uploaded", "filename", filename, "fileID", resp.ID)
	return resp.ID, nil
}

func (a *OpenAIAdapter) CreateChatCompletion(ctx context.Context, params agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	ctx, span := startModelSpan(ctx, "gen_ai.client.chat.completions", "openai", params.Model)
	defer span.End()

	if isGatewayVideoGenerationModel(params.Model) {
		completion, err := a.createGatewayVideoCompletion(ctx, params)
		if err != nil {
			recordSpanError(span, err)
			slog.Error("AI Gateway video generation failed", "model", params.Model, "error", err)
			return nil, err
		}
		return completion, nil
	}

	client := a.getClient(params.Model)
	breaker := a.circuitBreakerForModel(params.Model)
	responseParams := a.toResponsesNewParams(params)

	return runCompletionWithResilience(
		ctx,
		span,
		breaker,
		isOpenAIRetryableError,
		params.Model,
		"OpenAI chat completion failed (with resilience)",
		"openai chat completion returned nil response",
		func(retryCtx context.Context) (*agent.ChatCompletion, error) {
			resp, err := client.New(retryCtx, responseParams)
			if err != nil {
				return nil, err
			}
			return a.fromResponsesCompletion(resp), nil
		},
	)
}

func (a *OpenAIAdapter) CreateChatCompletionStream(ctx context.Context, params agent.ChatCompletionCreateParams, onChunk func(agent.ChatCompletionChunk)) error {
	ctx, span := startModelSpan(ctx, "gen_ai.client.chat.completions.stream", "openai", params.Model)
	defer span.End()

	if isGatewayVideoGenerationModel(params.Model) {
		completion, err := a.createGatewayVideoCompletion(ctx, params)
		if err != nil {
			recordSpanError(span, err)
			slog.Error("AI Gateway video generation failed", "model", params.Model, "error", err)
			return err
		}
		if onChunk != nil && len(completion.Choices) > 0 {
			onChunk(agent.ChatCompletionChunk{Choices: []agent.ChatCompletionChunkChoice{{
				Delta: agent.ChatCompletionChunkDelta{Content: completion.Choices[0].Message.Content},
			}}})
		}
		return nil
	}

	client := a.getClient(params.Model)
	breaker := a.circuitBreakerForModel(params.Model)
	responseParams := a.toResponsesNewParams(params)

	return breaker.Execute(ctx, func() error {
		streamCtx, streamCancel := context.WithCancel(ctx)
		stream := client.NewStreaming(streamCtx, responseParams)

		state := newResponsesStreamState()
		return consumeLLMEventStream(streamCtx, span, stream, streamCancel, defaultStreamChunkTimeout, params.Model, "OpenAI streaming chunk timeout", "OpenAI streaming failed", func(event responses.ResponseStreamEventUnion) {
			if chunk, ok := a.fromResponsesEvent(event, state); ok && onChunk != nil {
				onChunk(chunk)
			}
		})
	})
}

func (a *OpenAIAdapter) toResponsesNewParams(params agent.ChatCompletionCreateParams) responses.ResponseNewParams {
	responseParams := responses.ResponseNewParams{
		Model: params.Model,
		Input: responses.ResponseNewParamsInputUnion{
			OfInputItemList: a.toResponsesInput(params.Messages),
		},
	}
	if params.Temperature != nil {
		responseParams.Temperature = openai.Float(*params.Temperature)
	}
	if effort := corechat.EffectiveReasoningEffort(params.Model, params.ReasoningEffort); effort != "" {
		responseParams.Reasoning = openaishared.ReasoningParam{
			Effort: openaishared.ReasoningEffort(effort),
		}
	}
	if len(params.Tools) > 0 {
		responseParams.Tools = a.toResponsesTool(params.Tools)
	}
	return responseParams
}

func (a *OpenAIAdapter) toResponsesInput(messages []agent.ChatCompletionMessage) responses.ResponseInputParam {
	items := make(responses.ResponseInputParam, 0, len(messages))
	for _, m := range messages {
		switch m.Role {
		case agent.RoleSystem:
			items = append(items, responses.ResponseInputItemUnionParam{
				OfMessage: &responses.EasyInputMessageParam{
					Role: responses.EasyInputMessageRoleSystem,
					Content: responses.EasyInputMessageContentUnionParam{
						OfString: openai.String(m.Content),
					},
				},
			})
		case agent.RoleUser:
			if len(m.ContentParts) > 0 {
				items = append(items, a.mapResponsesMultimodalUserMessage(m)...)
				continue
			}
			items = append(items, responses.ResponseInputItemUnionParam{
				OfMessage: &responses.EasyInputMessageParam{
					Role: responses.EasyInputMessageRoleUser,
					Content: responses.EasyInputMessageContentUnionParam{
						OfString: openai.String(m.Content),
					},
				},
			})
		case agent.RoleAssistant:
			if m.Content != "" {
				items = append(items, responses.ResponseInputItemUnionParam{
					OfMessage: &responses.EasyInputMessageParam{
						Role: responses.EasyInputMessageRoleAssistant,
						Content: responses.EasyInputMessageContentUnionParam{
							OfString: openai.String(m.Content),
						},
					},
				})
			}
			for _, tc := range m.ToolCalls {
				items = append(items, responses.ResponseInputItemUnionParam{
					OfFunctionCall: &responses.ResponseFunctionToolCallParam{
						Arguments: tc.Function.Arguments,
						CallID:    tc.ID,
						Name:      tc.Function.Name,
					},
				})
			}
		case agent.RoleTool:
			items = append(items, responses.ResponseInputItemUnionParam{
				OfFunctionCallOutput: &responses.ResponseInputItemFunctionCallOutputParam{
					CallID: m.ToolID,
					Output: responses.ResponseInputItemFunctionCallOutputOutputUnionParam{
						OfString: openai.String(m.Content),
					},
				},
			})
		default:
			items = append(items, responses.ResponseInputItemUnionParam{
				OfMessage: &responses.EasyInputMessageParam{
					Role: responses.EasyInputMessageRoleUser,
					Content: responses.EasyInputMessageContentUnionParam{
						OfString: openai.String(m.Content),
					},
				},
			})
		}
	}
	return items
}

func (a *OpenAIAdapter) mapResponsesMultimodalUserMessage(m agent.ChatCompletionMessage) []responses.ResponseInputItemUnionParam {
	items := make([]responses.ResponseInputItemUnionParam, 0, len(m.ContentParts)+1)
	content := make(responses.ResponseInputMessageContentListParam, 0, len(m.ContentParts))

	flushContent := func() {
		if len(content) == 0 {
			return
		}
		items = append(items, responses.ResponseInputItemUnionParam{
			OfMessage: &responses.EasyInputMessageParam{
				Role: responses.EasyInputMessageRoleUser,
				Content: responses.EasyInputMessageContentUnionParam{
					OfInputItemContentList: content,
				},
			},
		})
		content = make(responses.ResponseInputMessageContentListParam, 0, len(m.ContentParts))
	}

	for _, p := range m.ContentParts {
		switch p.Type {
		case agent.ContentPartText:
			content = append(content, responses.ResponseInputContentUnionParam{
				OfInputText: &responses.ResponseInputTextParam{
					Text: p.Text,
				},
			})
		case agent.ContentPartImageURL:
			if p.ImageURL != nil && p.ImageURL.URL != "" {
				detail := responses.ResponseInputImageDetailAuto
				switch p.ImageURL.Detail {
				case string(responses.ResponseInputImageDetailLow):
					detail = responses.ResponseInputImageDetailLow
				case string(responses.ResponseInputImageDetailHigh):
					detail = responses.ResponseInputImageDetailHigh
				}
				content = append(content, responses.ResponseInputContentUnionParam{
					OfInputImage: &responses.ResponseInputImageParam{
						Detail:   detail,
						ImageURL: openai.String(p.ImageURL.URL),
					},
				})
			}
		case agent.ContentPartFileData:
			if p.FileData != nil && p.FileData.FileURI != "" {
				// OpenAI native files are referenced by file-ID in file_id field.
				content = append(content, responses.ResponseInputContentUnionParam{
					OfInputFile: &responses.ResponseInputFileParam{
						FileID: openai.String(p.FileData.FileURI),
					},
				})
			}
		case agent.ContentPartInputAudio:
			if p.InputAudio == nil {
				slog.Warn("audio content part ignored: missing payload")
				continue
			}
			audioData := strings.TrimSpace(p.InputAudio.Data)
			audioFormat := strings.ToLower(strings.TrimSpace(p.InputAudio.Format))
			if audioData == "" {
				slog.Warn("audio content part ignored: empty audio data")
				continue
			}
			if audioFormat != "mp3" && audioFormat != "wav" {
				slog.Warn("audio content part ignored: unsupported format", "format", p.InputAudio.Format)
				continue
			}

			rawAudioItem, err := marshalResponseInputAudio(responses.ResponseInputAudioParam{
				InputAudio: responses.ResponseInputAudioInputAudioParam{
					Data:   audioData,
					Format: audioFormat,
				},
			})
			if err != nil {
				slog.Warn("audio content part ignored: failed to marshal audio item", "error", err)
				continue
			}

			flushContent()
			items = append(items, param.Override[responses.ResponseInputItemUnionParam](json.RawMessage(rawAudioItem)))
		}
	}

	flushContent()
	return items
}

func (a *OpenAIAdapter) toResponsesTool(tools []agent.ToolDefinition) []responses.ToolUnionParam {
	respTools := make([]responses.ToolUnionParam, 0, len(tools))
	for _, t := range tools {
		params := normalizeToolParameters(t.Function.Parameters)
		respTools = append(respTools, responses.ToolUnionParam{
			OfFunction: &responses.FunctionToolParam{
				Name:        t.Function.Name,
				Description: openai.String(t.Function.Description),
				Parameters:  params,
			},
		})
	}
	return respTools
}

func (a *OpenAIAdapter) fromResponsesCompletion(resp *responses.Response) *agent.ChatCompletion {
	message := agent.ChatCompletionMessage{
		Role: agent.RoleAssistant,
	}

	for _, output := range resp.Output {
		switch output.Type {
		case "message":
			for _, content := range output.Content {
				switch content.Type {
				case "output_text":
					message.Content = appendTextWithSeparator(message.Content, content.Text)
				case "refusal":
					message.Content = appendTextWithSeparator(message.Content, content.Refusal)
				}
			}
		case "function_call":
			message.ToolCalls = append(message.ToolCalls, agent.ToolCall{
				ID:   output.CallID,
				Type: "function",
				Function: agent.ToolCallFunction{
					Name:      output.Name,
					Arguments: formatResponseArguments(output.Arguments),
				},
			})
		case "reasoning":
			for _, summary := range output.Summary {
				message.Reasoning = appendTextWithSeparator(message.Reasoning, summary.Text)
			}
		}
	}

	return &agent.ChatCompletion{
		ID: resp.ID,
		Choices: []agent.ChatCompletionChoice{
			{
				Message: message,
			},
		},
		Usage: mapResponsesUsage(resp.Usage),
	}
}

func formatResponseArguments(arguments responses.ResponseOutputItemUnionArguments) string {
	if arguments.JSON.OfString.Valid() {
		return arguments.OfString
	}
	if arguments.JSON.OfResponseToolSearchCallArguments.Valid() {
		encoded, err := json.Marshal(arguments.OfResponseToolSearchCallArguments)
		if err == nil {
			return string(encoded)
		}
	}
	return "{}"
}

type responsesToolCallState struct {
	Index  int
	CallID string
	Name   string
}

type responsesStreamState struct {
	nextToolCallIndex int
	toolCallByItemID  map[string]responsesToolCallState
}

func newResponsesStreamState() *responsesStreamState {
	return &responsesStreamState{
		toolCallByItemID: make(map[string]responsesToolCallState),
	}
}

func (s *responsesStreamState) register(itemID string, callID string, name string) responsesToolCallState {
	existing, ok := s.toolCallByItemID[itemID]
	if itemID != "" && ok {
		if callID != "" {
			existing.CallID = callID
		}
		if name != "" {
			existing.Name = name
		}
		s.toolCallByItemID[itemID] = existing
		return existing
	}

	state := responsesToolCallState{
		Index:  s.nextToolCallIndex,
		CallID: callID,
		Name:   name,
	}
	s.nextToolCallIndex++

	if itemID != "" {
		s.toolCallByItemID[itemID] = state
	}
	return state
}

func (s *responsesStreamState) byItemID(itemID string) responsesToolCallState {
	if existing, ok := s.toolCallByItemID[itemID]; ok {
		return existing
	}
	return s.register(itemID, "", "")
}

func mapResponsesUsage(usage responses.ResponseUsage) agent.ChatCompletionUsage {
	return agent.ChatCompletionUsage{
		PromptTokens:     usage.InputTokens,
		CompletionTokens: usage.OutputTokens,
		TotalTokens:      usage.TotalTokens,
		CachedTokens:     usage.InputTokensDetails.CachedTokens,
	}
}

func (a *OpenAIAdapter) fromResponsesEvent(event responses.ResponseStreamEventUnion, state *responsesStreamState) (agent.ChatCompletionChunk, bool) {
	switch event.Type {
	case "response.output_text.delta":
		if event.Delta == "" {
			return agent.ChatCompletionChunk{}, false
		}
		return agent.ChatCompletionChunk{
			Choices: []agent.ChatCompletionChunkChoice{
				{
					Delta: agent.ChatCompletionChunkDelta{
						Content: event.Delta,
					},
				},
			},
		}, true
	case "response.function_call_arguments.delta":
		if event.Delta == "" {
			return agent.ChatCompletionChunk{}, false
		}
		callState := state.byItemID(event.ItemID)
		idx := callState.Index
		return agent.ChatCompletionChunk{
			Choices: []agent.ChatCompletionChunkChoice{
				{
					Delta: agent.ChatCompletionChunkDelta{
						ToolCalls: []agent.ToolCall{
							{
								Index: &idx,
								ID:    callState.CallID,
								Type:  "function",
								Function: agent.ToolCallFunction{
									Name:      callState.Name,
									Arguments: event.Delta,
								},
							},
						},
					},
				},
			},
		}, true
	case "response.output_item.added":
		if event.Item.Type != "function_call" {
			return agent.ChatCompletionChunk{}, false
		}
		callState := state.register(event.Item.ID, event.Item.CallID, event.Item.Name)
		idx := callState.Index
		return agent.ChatCompletionChunk{
			Choices: []agent.ChatCompletionChunkChoice{
				{
					Delta: agent.ChatCompletionChunkDelta{
						ToolCalls: []agent.ToolCall{
							{
								Index: &idx,
								ID:    callState.CallID,
								Type:  "function",
								Function: agent.ToolCallFunction{
									Name: callState.Name,
								},
							},
						},
					},
				},
			},
		}, true
	case "response.reasoning_summary_text.delta":
		if event.Delta == "" {
			return agent.ChatCompletionChunk{}, false
		}
		return agent.ChatCompletionChunk{
			Choices: []agent.ChatCompletionChunkChoice{
				{
					Delta: agent.ChatCompletionChunkDelta{
						Reasoning: event.Delta,
					},
				},
			},
		}, true
	case "response.completed":
		usage := mapResponsesUsage(event.Response.Usage)
		return agent.ChatCompletionChunk{
			Usage: &usage,
		}, true
	default:
		return agent.ChatCompletionChunk{}, false
	}
}
