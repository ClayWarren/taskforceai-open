package pkg

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	corechat "github.com/TaskForceAI/core/pkg/chat"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/upstream"
	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/packages/ssestream"
)

func isAnthropicRetryableError(err error) bool {
	return upstream.IsTransientError(err, "overloaded")
}

type IAnthropicMessages interface {
	New(ctx context.Context, body anthropic.MessageNewParams, opts ...option.RequestOption) (res *anthropic.Message, err error)
	NewStreaming(ctx context.Context, body anthropic.MessageNewParams, opts ...option.RequestOption) *ssestream.Stream[anthropic.MessageStreamEventUnion]
}

type AnthropicAdapter struct {
	cfg     config.Config
	client  IAnthropicMessages
	breaker *circuitbreaker.CircuitBreaker
}

var (
	anthropicBreakerOnce sync.Once
	anthropicBreaker     *circuitbreaker.CircuitBreaker
)

func getAnthropicCircuitBreaker() *circuitbreaker.CircuitBreaker {
	anthropicBreakerOnce.Do(func() {
		anthropicBreaker = upstream.NewCircuitBreaker("llm_anthropic", 30*time.Second, isAnthropicRetryableError)
	})
	return anthropicBreaker
}

func normalizeAnthropicModelID(modelID string) string {
	return strings.TrimPrefix(modelID, "anthropic/")
}

func normalizeAnthropicBaseURL(baseURL string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if before, ok := strings.CutSuffix(baseURL, "/v1"); ok {
		return before
	}
	return baseURL
}

func normalizeAnthropicRequestModelID(baseURL string, modelID string) string {
	modelID = strings.TrimSpace(modelID)
	if isAIGatewayBaseURL(baseURL) {
		return modelID
	}
	return normalizeAnthropicModelID(modelID)
}

func NewAnthropicAdapter(cfg config.Config) *AnthropicAdapter {
	apiKey := cfg.Gateway.APIKey
	if apiKey == "" {
		apiKey = os.Getenv("ANTHROPIC_API_KEY")
	}

	opts := []option.RequestOption{
		option.WithAPIKey(apiKey),
	}

	if baseURL := normalizeAnthropicBaseURL(cfg.Gateway.BaseURL); baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
	}

	client := anthropic.NewClient(opts...)
	return &AnthropicAdapter{
		cfg:     cfg,
		client:  &client.Messages,
		breaker: getAnthropicCircuitBreaker(),
	}
}

func (a *AnthropicAdapter) CreateChatCompletion(ctx context.Context, params agent.ChatCompletionCreateParams) (*agent.ChatCompletion, error) {
	ctx, span := startModelSpan(ctx, "gen_ai.client.chat.completions", "anthropic", params.Model)
	defer span.End()

	msgParams := a.buildMessageParams(params)

	return runCompletionWithResilience(
		ctx,
		span,
		a.breaker,
		isAnthropicRetryableError,
		params.Model,
		"Anthropic chat completion failed (with resilience)",
		"anthropic chat completion returned nil response",
		func(retryCtx context.Context) (*agent.ChatCompletion, error) {
			resp, err := a.client.New(retryCtx, msgParams)
			if err != nil {
				return nil, err
			}
			return a.toCoreCompletion(resp), nil
		},
	)
}

func (a *AnthropicAdapter) CreateChatCompletionStream(ctx context.Context, params agent.ChatCompletionCreateParams, onChunk func(agent.ChatCompletionChunk)) error {
	ctx, span := startModelSpan(ctx, "gen_ai.client.chat.completions.stream", "anthropic", params.Model)
	defer span.End()

	msgParams := a.buildMessageParams(params)

	pending := make(map[int64]pendingTool)
	return a.breaker.Execute(ctx, func() error {
		streamCtx, streamCancel := context.WithCancel(ctx)
		stream := a.client.NewStreaming(streamCtx, msgParams)
		return consumeLLMEventStream(streamCtx, span, stream, streamCancel, defaultStreamChunkTimeout, params.Model, "Anthropic streaming chunk timeout", "Anthropic streaming failed", func(event anthropic.MessageStreamEventUnion) {
			if chunk, ok := a.fromStreamEvent(event, pending); ok && onChunk != nil {
				onChunk(chunk)
			}
		})
	})
}

type pendingTool struct {
	id   string
	name string
}

func (a *AnthropicAdapter) fromStreamEvent(event anthropic.MessageStreamEventUnion, pending map[int64]pendingTool) (agent.ChatCompletionChunk, bool) {
	switch event.Type {
	case "content_block_start":
		cbse := event.AsContentBlockStart()
		if cbse.ContentBlock.Type == "tool_use" {
			pending[cbse.Index] = pendingTool{
				id:   cbse.ContentBlock.ID,
				name: cbse.ContentBlock.Name,
			}
			// Emit header chunk so consumers can register the tool call by index/id/name
			idx := int(cbse.Index)
			return agent.ChatCompletionChunk{
				Choices: []agent.ChatCompletionChunkChoice{
					{
						Delta: agent.ChatCompletionChunkDelta{
							ToolCalls: []agent.ToolCall{
								{
									Index: &idx,
									ID:    cbse.ContentBlock.ID,
									Type:  "function",
									Function: agent.ToolCallFunction{
										Name: cbse.ContentBlock.Name,
									},
								},
							},
						},
					},
				},
			}, true
		}

	case "content_block_delta":
		cbde := event.AsContentBlockDelta()
		switch cbde.Delta.Type {
		case "text_delta":
			if cbde.Delta.Text != "" {
				return agent.ChatCompletionChunk{
					Choices: []agent.ChatCompletionChunkChoice{
						{
							Delta: agent.ChatCompletionChunkDelta{
								Content: cbde.Delta.Text,
							},
						},
					},
				}, true
			}
		case "input_json_delta":
			if pt, ok := pending[cbde.Index]; ok {
				idx := int(cbde.Index)
				return agent.ChatCompletionChunk{
					Choices: []agent.ChatCompletionChunkChoice{
						{
							Delta: agent.ChatCompletionChunkDelta{
								ToolCalls: []agent.ToolCall{
									{
										Index: &idx,
										ID:    pt.id,
										Type:  "function",
										Function: agent.ToolCallFunction{
											Arguments: cbde.Delta.PartialJSON,
										},
									},
								},
							},
						},
					},
				}, true
			}
		case "thinking_delta":
			if cbde.Delta.Thinking != "" {
				return agent.ChatCompletionChunk{
					Choices: []agent.ChatCompletionChunkChoice{
						{
							Delta: agent.ChatCompletionChunkDelta{
								Reasoning: cbde.Delta.Thinking,
							},
						},
					},
				}, true
			}
		}

	case "content_block_stop":
		cbse := event.AsContentBlockStop()
		delete(pending, cbse.Index)

	case "message_delta":
		mde := event.AsMessageDelta()
		usage := agent.ChatCompletionUsage{
			PromptTokens:     mde.Usage.InputTokens,
			CompletionTokens: mde.Usage.OutputTokens,
			TotalTokens:      mde.Usage.InputTokens + mde.Usage.OutputTokens,
			CachedTokens:     mde.Usage.CacheReadInputTokens,
		}
		return agent.ChatCompletionChunk{
			Usage: &usage,
		}, true
	}
	return agent.ChatCompletionChunk{}, false
}

func (a *AnthropicAdapter) buildMessageParams(params agent.ChatCompletionCreateParams) anthropic.MessageNewParams {
	system, messages := a.mapMessages(params.Messages)
	p := anthropic.MessageNewParams{
		Model:     normalizeAnthropicRequestModelID(a.cfg.Gateway.BaseURL, params.Model),
		MaxTokens: 8192,
		Messages:  messages,
		System:    system,
	}
	if params.Temperature != nil {
		p.Temperature = anthropic.Float(*params.Temperature)
	}
	if effort := corechat.EffectiveReasoningEffort(params.Model, params.ReasoningEffort); effort != "" {
		p.OutputConfig = anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffort(effort),
		}
		p.Thinking = anthropic.ThinkingConfigParamUnion{
			OfAdaptive: &anthropic.ThinkingConfigAdaptiveParam{},
		}
	}
	if len(params.Tools) > 0 {
		p.Tools = a.mapTools(params.Tools)
	}
	return p
}

// mapMessages converts core messages to Anthropic SDK types.
// System messages are extracted as TextBlockParam slices; all others become MessageParam.
func (a *AnthropicAdapter) mapMessages(messages []agent.ChatCompletionMessage) ([]anthropic.TextBlockParam, []anthropic.MessageParam) {
	var system []anthropic.TextBlockParam
	var msgParams []anthropic.MessageParam

	for _, m := range messages {
		switch m.Role {
		case agent.RoleSystem:
			if strings.TrimSpace(m.Content) == "" {
				continue
			}
			block := anthropic.TextBlockParam{Text: m.Content}
			if m.CacheControl != nil {
				block.CacheControl = anthropicCacheControlParam(m.CacheControl)
			}
			system = append(system, block)

		case agent.RoleUser:
			if len(m.ContentParts) > 0 {
				blocks := a.mapContentParts(m.ContentParts)
				applyCacheControlToBlocks(blocks, m.CacheControl)
				if len(blocks) > 0 {
					msgParams = append(msgParams, anthropic.NewUserMessage(blocks...))
				}
			} else {
				if strings.TrimSpace(m.Content) == "" {
					continue
				}
				block := anthropic.NewTextBlock(m.Content)
				if m.CacheControl != nil && block.OfText != nil {
					block.OfText.CacheControl = anthropicCacheControlParam(m.CacheControl)
				}
				msgParams = append(msgParams, anthropic.NewUserMessage(block))
			}

		case agent.RoleTool:
			if strings.TrimSpace(m.Content) == "" {
				continue
			}
			block := anthropic.NewToolResultBlock(m.ToolID, m.Content, false)
			applyCacheControlToBlocks([]anthropic.ContentBlockParamUnion{block}, m.CacheControl)
			msgParams = append(msgParams, anthropic.NewUserMessage(block))

		case agent.RoleAssistant:
			if msg, ok := a.mapAssistantMessage(m); ok {
				msgParams = append(msgParams, msg)
			}
		}
	}

	return system, msgParams
}

func (a *AnthropicAdapter) mapAssistantMessage(m agent.ChatCompletionMessage) (anthropic.MessageParam, bool) {
	if len(m.ToolCalls) == 0 {
		if strings.TrimSpace(m.Content) == "" {
			return anthropic.MessageParam{}, false
		}
		block := anthropic.NewTextBlock(m.Content)
		applyCacheControlToBlocks([]anthropic.ContentBlockParamUnion{block}, m.CacheControl)
		return anthropic.NewAssistantMessage(block), true
	}

	var blocks []anthropic.ContentBlockParamUnion
	if strings.TrimSpace(m.Content) != "" {
		blocks = append(blocks, anthropic.NewTextBlock(m.Content))
	}
	for _, tc := range m.ToolCalls {
		var input any
		if tc.Function.Arguments != "" {
			var parsed any
			if err := json.Unmarshal([]byte(tc.Function.Arguments), &parsed); err == nil {
				input = parsed
			} else {
				input = tc.Function.Arguments
			}
		}
		blocks = append(blocks, anthropic.NewToolUseBlock(tc.ID, input, tc.Function.Name))
	}
	applyCacheControlToBlocks(blocks, m.CacheControl)
	// Reaching here implies len(m.ToolCalls) > 0, so the loop above always
	// appends at least one block; blocks is therefore never empty.
	return anthropic.NewAssistantMessage(blocks...), true
}

func (a *AnthropicAdapter) mapContentParts(parts []agent.ContentPart) []anthropic.ContentBlockParamUnion {
	var blocks []anthropic.ContentBlockParamUnion
	for _, p := range parts {
		switch p.Type {
		case agent.ContentPartText:
			if strings.TrimSpace(p.Text) != "" {
				blocks = append(blocks, anthropic.NewTextBlock(p.Text))
			}
		case agent.ContentPartImageURL:
			if p.ImageURL == nil {
				continue
			}
			url := p.ImageURL.URL
			if strings.HasPrefix(url, "data:") {
				mime, encoded, ok := parseDataURIBase64(url)
				if !ok {
					continue
				}
				blocks = append(blocks, anthropic.NewImageBlockBase64(mime, encoded))
			} else {
				blocks = append(blocks, anthropic.NewImageBlock(anthropic.URLImageSourceParam{URL: url}))
			}
		case agent.ContentPartInputAudio, agent.ContentPartFileData:
			// Not yet supported by Anthropic adapter
		}
	}
	return blocks
}

func anthropicCacheControlParam(cacheControl *agent.CacheControl) anthropic.CacheControlEphemeralParam {
	param := anthropic.NewCacheControlEphemeralParam()
	if cacheControl == nil {
		return param
	}
	switch strings.TrimSpace(cacheControl.TTL) {
	case "1h":
		param.TTL = anthropic.CacheControlEphemeralTTLTTL1h
	case "5m", "":
		param.TTL = anthropic.CacheControlEphemeralTTLTTL5m
	}
	return param
}

func applyCacheControlToBlocks(blocks []anthropic.ContentBlockParamUnion, cacheControl *agent.CacheControl) {
	if cacheControl == nil {
		return
	}
	cacheParam := anthropicCacheControlParam(cacheControl)
	for i := range blocks {
		if target := blocks[i].GetCacheControl(); target != nil {
			*target = cacheParam
		}
	}
}

func parseDataURIBase64(uri string) (string, string, bool) {
	after, ok := strings.CutPrefix(uri, "data:")
	if !ok {
		return "", "", false
	}

	metadata, encoded, ok := strings.Cut(after, ",")
	if !ok {
		return "", "", false
	}

	mime, encoding, _ := strings.Cut(metadata, ";")
	if mime == "" || !strings.HasPrefix(strings.ToLower(mime), "image/") {
		return "", "", false
	}
	if !strings.EqualFold(encoding, "base64") {
		return "", "", false
	}

	normalized := encoded
	switch len(encoded) % 4 {
	case 0:
	case 2:
		normalized = encoded + "=="
	case 3:
		normalized = encoded + "="
	default:
		return "", "", false
	}
	if _, err := base64.StdEncoding.DecodeString(normalized); err != nil {
		return "", "", false
	}
	return mime, normalized, true
}

func (a *AnthropicAdapter) mapTools(tools []agent.ToolDefinition) []anthropic.ToolUnionParam {
	result := make([]anthropic.ToolUnionParam, 0, len(tools))
	for _, t := range tools {
		toolParam := anthropic.ToolParam{
			Name:        t.Function.Name,
			InputSchema: anthropicToolInputSchema(t.Function.Parameters),
		}
		if t.Function.Description != "" {
			toolParam.Description = anthropic.String(t.Function.Description)
		}

		result = append(result, anthropic.ToolUnionParam{OfTool: &toolParam})
	}
	return result
}

func anthropicToolInputSchema(parameters any) anthropic.ToolInputSchemaParam {
	schema := anthropic.ToolInputSchemaParam{}
	params := normalizeToolParameters(parameters)
	if len(params) == 0 {
		return schema
	}

	if properties, ok := params["properties"]; ok {
		schema.Properties = properties
	}
	schema.Required = anthropicRequiredFields(params["required"])
	if extraFields := anthropicToolExtraFields(params); len(extraFields) > 0 {
		schema.ExtraFields = extraFields
	}
	return schema
}

func anthropicRequiredFields(raw any) []string {
	switch req := raw.(type) {
	case []string:
		return req
	case []any:
		strs := make([]string, 0, len(req))
		for _, r := range req {
			if s, ok := r.(string); ok {
				strs = append(strs, s)
			}
		}
		return strs
	default:
		return nil
	}
}

func anthropicToolExtraFields(params map[string]any) map[string]any {
	var extraFields map[string]any
	for key, value := range params {
		switch key {
		case "type", "properties", "required":
			continue
		default:
			if extraFields == nil {
				extraFields = make(map[string]any)
			}
			extraFields[key] = value
		}
	}
	return extraFields
}

func (a *AnthropicAdapter) toCoreCompletion(resp *anthropic.Message) *agent.ChatCompletion {
	msg := agent.ChatCompletionMessage{
		Role: agent.RoleAssistant,
	}

	var toolCalls []agent.ToolCall
	for _, block := range resp.Content {
		switch block.Type {
		case "text":
			msg.Content = appendTextWithSeparator(msg.Content, block.Text)
		case "thinking":
			msg.Reasoning = appendTextWithSeparator(msg.Reasoning, block.Thinking)
		case "tool_use":
			toolCalls = append(toolCalls, agent.ToolCall{
				ID:   block.ID,
				Type: "function",
				Function: agent.ToolCallFunction{
					Name:      block.Name,
					Arguments: string(block.Input),
				},
			})
		}
	}

	if len(toolCalls) > 0 {
		msg.ToolCalls = toolCalls
	}

	usage := agent.ChatCompletionUsage{
		PromptTokens:     resp.Usage.InputTokens,
		CompletionTokens: resp.Usage.OutputTokens,
		TotalTokens:      resp.Usage.InputTokens + resp.Usage.OutputTokens,
		CachedTokens:     resp.Usage.CacheReadInputTokens,
	}

	return &agent.ChatCompletion{
		ID: resp.ID,
		Choices: []agent.ChatCompletionChoice{
			{Message: msg},
		},
		Usage: usage,
	}
}

func appendTextWithSeparator(dst string, piece string) string {
	if piece == "" {
		return dst
	}
	if dst == "" {
		return piece
	}
	return dst + "\n" + piece
}
