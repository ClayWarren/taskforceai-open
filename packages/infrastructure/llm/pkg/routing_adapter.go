package pkg

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
)

// Provider defines the interface for LLM providers.
type Provider interface {
	agent.ILLMClient
}

// FileProvider extends the LLM client with file upload capabilities.
type FileProvider interface {
	Provider
	agent.IFileUploader
}

// RoutingAdapter delegates calls to the appropriate provider based on the model ID.
type RoutingAdapter struct {
	openai                        FileProvider
	gemini                        FileProvider
	anthropic                     Provider
	geminiInitErr                 error
	defaultModel                  string
	routeGeminiTextThroughGateway bool
}

func NewRoutingAdapter(ctx context.Context, cfg config.Config) (*RoutingAdapter, error) {
	oa := NewOpenAIAdapter(cfg)
	aa := NewAnthropicAdapter(cfg)

	ra := &RoutingAdapter{
		openai:                        oa,
		anthropic:                     aa,
		defaultModel:                  cfg.Gateway.Model,
		routeGeminiTextThroughGateway: isAIGatewayBaseURL(cfg.Gateway.BaseURL),
	}

	ga, err := NewGeminiAdapter(ctx, cfg)
	if err != nil {
		ra.geminiInitErr = err
		slog.Warn("Gemini adapter unavailable; google/* models will fail", "error", err)
		return ra, nil
	}
	ra.gemini = ga
	return ra, nil
}

type uploadModelContextKey struct{}

// WithUploadModel adds the selected model ID to the context so UploadFile can route correctly.
func WithUploadModel(ctx context.Context, modelID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, uploadModelContextKey{}, strings.TrimSpace(modelID))
}

func uploadModelFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	modelID, _ := ctx.Value(uploadModelContextKey{}).(string)
	return strings.TrimSpace(modelID)
}

func isAnthropicModel(modelID string) bool {
	return strings.HasPrefix(modelID, "anthropic/")
}

func isGeminiModel(modelID string) bool {
	return strings.HasPrefix(modelID, "google/")
}

func hasNativeGeminiFileParts(messages []agent.ChatCompletionMessage) bool {
	for _, message := range messages {
		for _, part := range message.ContentParts {
			if part.Type == agent.ContentPartFileData {
				return true
			}
		}
	}
	return false
}

func (a *RoutingAdapter) shouldRouteGeminiTextThroughGateway(params agent.ChatCompletionCreateParams) bool {
	return a.routeGeminiTextThroughGateway &&
		isGeminiModel(params.Model) &&
		!isGeminiImageGenerationModel(params.Model) &&
		!hasNativeGeminiFileParts(params.Messages)
}

func (a *RoutingAdapter) resolveUploadModel(ctx context.Context) string {
	if modelID := uploadModelFromContext(ctx); modelID != "" {
		return modelID
	}
	return strings.TrimSpace(a.defaultModel)
}

func (a *RoutingAdapter) geminiUnavailableError() error {
	if a.geminiInitErr != nil {
		return fmt.Errorf("gemini provider unavailable: %w", a.geminiInitErr)
	}
	return fmt.Errorf("gemini provider unavailable")
}

func (a *RoutingAdapter) CreateChatCompletion(ctx context.Context, params agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	if isAnthropicModel(params.Model) {
		return a.anthropic.CreateChatCompletion(ctx, params)
	}
	if a.shouldRouteGeminiTextThroughGateway(params) {
		return a.openai.CreateChatCompletion(ctx, params)
	}
	if isGeminiModel(params.Model) {
		if a.gemini == nil {
			return nil, a.geminiUnavailableError()
		}
		return a.gemini.CreateChatCompletion(ctx, params)
	}
	return a.openai.CreateChatCompletion(ctx, params)
}

func (a *RoutingAdapter) CreateChatCompletionStream(ctx context.Context, params agent.ChatCompletionCreateParams, onChunk func(agent.ChatCompletionChunk)) error {
	if isAnthropicModel(params.Model) {
		return a.anthropic.CreateChatCompletionStream(ctx, params, onChunk)
	}
	if a.shouldRouteGeminiTextThroughGateway(params) {
		return a.openai.CreateChatCompletionStream(ctx, params, onChunk)
	}
	if isGeminiModel(params.Model) {
		if a.gemini == nil {
			return a.geminiUnavailableError()
		}
		return a.gemini.CreateChatCompletionStream(ctx, params, onChunk)
	}
	return a.openai.CreateChatCompletionStream(ctx, params, onChunk)
}

// UploadFile implements agent.IFileUploader by delegating to the appropriate provider.
func (a *RoutingAdapter) UploadFile(ctx context.Context, reader io.Reader, filename, mimeType string) (string, error) {
	modelID := a.resolveUploadModel(ctx)
	switch {
	case isAnthropicModel(modelID):
		return "", fmt.Errorf("anthropic provider does not support native file upload")
	case isGeminiModel(modelID):
		if a.gemini == nil {
			return "", a.geminiUnavailableError()
		}
		return a.gemini.UploadFile(ctx, reader, filename, mimeType)
	default:
		return a.openai.UploadFile(WithUploadModel(ctx, modelID), reader, filename, mimeType)
	}
}
