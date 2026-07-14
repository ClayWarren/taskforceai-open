package pkg

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/tools"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	anthropic "github.com/anthropics/anthropic-sdk-go"
	anthro_ssestream "github.com/anthropics/anthropic-sdk-go/packages/ssestream"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// --- Anthropic Tests ---

var benchmarkAnthropicContentParts []anthropic.ContentBlockParamUnion
var benchmarkAnthropicTools []anthropic.ToolUnionParam

func TestAnthropicAdapter(t *testing.T) {
	mm := new(MockAnthropicMessages)
	adapter := &AnthropicAdapter{
		client:  mm,
		breaker: circuitbreaker.New(circuitbreaker.Config{Name: "test", FailureThreshold: 5, IsTransient: isAnthropicRetryableError}),
	}

	t.Run("isAnthropicRetryableError", func(t *testing.T) {
		assert.True(t, isAnthropicRetryableError(fmt.Errorf("overloaded")))
		assert.False(t, isAnthropicRetryableError(nil))
	})

	t.Run("buildMessageParams normalizes anthropic model prefix", func(t *testing.T) {
		params := adapter.buildMessageParams(agent.ChatCompletionCreateParams{
			Model:    "anthropic/claude-fable-5",
			Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "hello"}},
		})
		assert.Equal(t, anthropic.Model("claude-fable-5"), params.Model)
	})

	t.Run("buildMessageParams preserves gateway model prefix", func(t *testing.T) {
		gatewayAdapter := &AnthropicAdapter{
			cfg: config.Config{Gateway: config.GatewayConfig{BaseURL: "https://ai-gateway.vercel.sh/v1"}},
		}
		params := gatewayAdapter.buildMessageParams(agent.ChatCompletionCreateParams{
			Model:    "anthropic/claude-fable-5",
			Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "hello"}},
		})
		assert.Equal(t, anthropic.Model("anthropic/claude-fable-5"), params.Model)
	})

	t.Run("buildMessageParams enables adaptive thinking with effort", func(t *testing.T) {
		params := adapter.buildMessageParams(agent.ChatCompletionCreateParams{
			Model:           "anthropic/claude-sonnet-5",
			ReasoningEffort: "xhigh",
			Messages:        []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "hello"}},
		})
		encoded, err := json.Marshal(params)
		require.NoError(t, err)
		assert.Contains(t, string(encoded), `"effort":"xhigh"`)
		assert.Contains(t, string(encoded), `"thinking":{"type":"adaptive"}`)
	})

	t.Run("normalizeAnthropicBaseURL strips trailing v1", func(t *testing.T) {
		assert.Equal(t, "https://ai-gateway.vercel.sh", normalizeAnthropicBaseURL("https://ai-gateway.vercel.sh/v1/"))
		assert.Equal(t, "https://proxy.example/api", normalizeAnthropicBaseURL("https://proxy.example/api"))
	})

	t.Run("buildMessageParams includes tools", func(t *testing.T) {
		params := adapter.buildMessageParams(agent.ChatCompletionCreateParams{
			Model:    "anthropic/claude-fable-5",
			Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "hello"}},
			Tools: []agent.ToolDefinition{{
				Function: agent.FunctionDefinition{
					Name:        "lookup",
					Description: "Lookup a record",
					Parameters: map[string]any{
						"properties": map[string]any{"id": map[string]any{"type": "string"}},
						"required":   []any{"id"},
					},
				},
			}},
		})
		assert.Len(t, params.Tools, 1)
		assert.Equal(t, "lookup", params.Tools[0].OfTool.Name)
	})

	t.Run("CreateChatCompletion success", func(t *testing.T) {
		mm.On("New", mock.Anything, mock.Anything, mock.Anything).Return(&anthropic.Message{ID: "m1", Role: "assistant", Content: []anthropic.ContentBlockUnion{{Type: "text", Text: "hi"}}}, nil).Once()
		temperature := 0.5
		res, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "c1", Temperature: &temperature, Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "u"}}})
		require.NoError(t, err)
		assert.Equal(t, "m1", res.ID)
	})

	t.Run("buildMessageParams distinguishes unset and zero temperature", func(t *testing.T) {
		unset := adapter.buildMessageParams(agent.ChatCompletionCreateParams{
			Model:    "anthropic/claude-fable-5",
			Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "hello"}},
		})
		assert.False(t, unset.Temperature.Valid())

		zero := 0.0
		withZero := adapter.buildMessageParams(agent.ChatCompletionCreateParams{
			Model:       "anthropic/claude-fable-5",
			Messages:    []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "hello"}},
			Temperature: &zero,
		})
		assert.True(t, withZero.Temperature.Valid())
		assert.Equal(t, 0.0, withZero.Temperature.Value)
	})

	t.Run("CreateChatCompletion non-retryable error", func(t *testing.T) {
		mmError := new(MockAnthropicMessages)
		a := &AnthropicAdapter{
			client:  mmError,
			breaker: circuitbreaker.New(circuitbreaker.Config{Name: "anthropic-error", FailureThreshold: 5, IsTransient: isAnthropicRetryableError}),
		}
		mmError.On("New", mock.Anything, mock.Anything, mock.Anything).Return((*anthropic.Message)(nil), fmt.Errorf("bad request")).Once()

		res, err := a.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "anthropic/claude-fable-5"})
		assert.Nil(t, res)
		assert.ErrorContains(t, err, "bad request")
	})

	t.Run("CreateChatCompletionStream Network", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte(`event: content_block_delta` + "\n" + `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}` + "\n\n"))
		}))
		defer server.Close()
		a := NewAnthropicAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "k", BaseURL: server.URL}})
		var content strings.Builder
		_ = a.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{Model: "c1"}, func(chunk agent.ChatCompletionChunk) {
			if len(chunk.Choices) > 0 {
				content.WriteString(chunk.Choices[0].Delta.Content)
			}
		})
		assert.Equal(t, "hi", content.String())
	})

	t.Run("CreateChatCompletion strips v1 base path for gateway-compatible Anthropic SDK", func(t *testing.T) {
		var requestPath string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requestPath = r.URL.Path
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"msg_1","type":"message","role":"assistant","model":"anthropic/claude-fable-5","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":1}}`))
		}))
		defer server.Close()

		a := NewAnthropicAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "k", BaseURL: server.URL + "/v1"}})
		res, err := a.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{
			Model:    "anthropic/claude-fable-5",
			Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "u"}},
		})

		require.NoError(t, err)
		require.NotNil(t, res)
		assert.Equal(t, "/v1/messages", requestPath)
	})

	t.Run("CreateChatCompletionStream error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()
		a := NewAnthropicAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "k", BaseURL: server.URL}})
		err := a.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{Model: "c1"}, func(chunk agent.ChatCompletionChunk) {})
		assert.Error(t, err)
	})

	t.Run("CreateChatCompletionStream returns on cancellation without closing blocked Next", func(t *testing.T) {
		decoder := newBlockingAnthropicDecoder()
		stream := anthro_ssestream.NewStream[anthropic.MessageStreamEventUnion](decoder, nil)
		t.Cleanup(func() { _ = stream.Close() })

		mmCancel := new(MockAnthropicMessages)
		a := &AnthropicAdapter{
			client:  mmCancel,
			breaker: circuitbreaker.New(circuitbreaker.Config{Name: "test", FailureThreshold: 5, IsTransient: isAnthropicRetryableError}),
		}
		mmCancel.On("NewStreaming", mock.Anything, mock.Anything, mock.Anything).Return(stream).Once()

		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		defer cancel()

		err := a.CreateChatCompletionStream(ctx, agent.ChatCompletionCreateParams{
			Model:    "anthropic/claude-fable-5",
			Messages: []agent.ChatCompletionMessage{{Role: agent.RoleUser, Content: "hi"}},
		}, nil)
		require.Error(t, err)
		assert.Equal(t, int32(0), decoder.closeCalls.Load())
	})

	t.Run("mapMessages exhaustive", func(t *testing.T) {
		msgs := []agent.ChatCompletionMessage{
			{Role: agent.RoleSystem, Content: "s", CacheControl: &agent.CacheControl{Type: "e"}},
			{Role: agent.RoleUser, Content: "u", CacheControl: &agent.CacheControl{Type: "e"}},
			{Role: agent.RoleUser, ContentParts: []agent.ContentPart{{Type: agent.ContentPartText, Text: "p"}}},
			{Role: agent.RoleTool, ToolID: "t1", Content: "r"},
			{Role: agent.RoleAssistant, Content: "a", ToolCalls: []agent.ToolCall{{ID: "t2", Function: agent.ToolCallFunction{Name: "f", Arguments: `{"k":"v"}`}}}},
		}
		sys, contents := adapter.mapMessages(msgs)
		assert.Len(t, sys, 1)
		assert.Len(t, contents, 4)
	})

	t.Run("mapMessages applies cache TTL across supported blocks", func(t *testing.T) {
		cache := &agent.CacheControl{Type: "ephemeral", TTL: "1h"}
		sys, contents := adapter.mapMessages([]agent.ChatCompletionMessage{
			{Role: agent.RoleSystem, Content: "system", CacheControl: cache},
			{Role: agent.RoleUser, ContentParts: []agent.ContentPart{
				{Type: agent.ContentPartText, Text: "look"},
				{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "https://example.com/image.png"}},
			}, CacheControl: cache},
			{Role: agent.RoleAssistant, Content: "assistant", CacheControl: cache},
			{Role: agent.RoleTool, ToolID: "tool-1", Content: "tool result", CacheControl: cache},
		})

		require.Len(t, sys, 1)
		assert.Equal(t, anthropic.CacheControlEphemeralTTLTTL1h, sys[0].CacheControl.TTL)
		require.Len(t, contents, 3)
		for _, msg := range contents {
			for _, block := range msg.Content {
				target := block.GetCacheControl()
				require.NotNil(t, target)
				assert.Equal(t, anthropic.CacheControlEphemeralTTLTTL1h, target.TTL)
			}
		}
	})

	t.Run("mapMessages skips empty text blocks", func(t *testing.T) {
		sys, contents := adapter.mapMessages([]agent.ChatCompletionMessage{
			{Role: agent.RoleSystem, Content: "  "},
			{Role: agent.RoleUser, Content: ""},
			{Role: agent.RoleUser, ContentParts: []agent.ContentPart{{Type: agent.ContentPartText, Text: "  "}}},
			{Role: agent.RoleAssistant, Reasoning: "thinking only"},
			{Role: agent.RoleTool, ToolID: "tool-1", Content: ""},
		})
		assert.Empty(t, sys)
		assert.Empty(t, contents)
	})

	t.Run("mapMessages assistant without tool calls", func(t *testing.T) {
		_, contents := adapter.mapMessages([]agent.ChatCompletionMessage{{Role: agent.RoleAssistant, Content: "plain answer"}})
		assert.Len(t, contents, 1)
		assert.Equal(t, "plain answer", contents[0].Content[0].OfText.Text)
	})

	t.Run("mapMessages assistant tool call with string arguments", func(t *testing.T) {
		_, contents := adapter.mapMessages([]agent.ChatCompletionMessage{{
			Role: agent.RoleAssistant,
			ToolCalls: []agent.ToolCall{{
				ID:       "call-string",
				Function: agent.ToolCallFunction{Name: "lookup", Arguments: "not-json"},
			}},
		}})
		assert.Len(t, contents, 1)
		assert.Len(t, contents[0].Content, 1)
	})

	t.Run("mapMessages with ContentParts", func(t *testing.T) {
		msgs := []agent.ChatCompletionMessage{
			{Role: agent.RoleUser, ContentParts: []agent.ContentPart{
				{Type: agent.ContentPartText, Text: "t"},
				{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "data:image/png;base64,QUFB"}},
				{Type: agent.ContentPartImageURL},
			}},
		}
		_, contents := adapter.mapMessages(msgs)
		assert.Len(t, contents, 1)
	})

	t.Run("mapContentParts skips malformed data URI images", func(t *testing.T) {
		blocks := adapter.mapContentParts([]agent.ContentPart{
			{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "data:image/png;base64,%%%%"}},
			{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "data:text/plain;base64,QUFB"}},
			{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "data:image/png,QUFB"}},
			{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "data:image/png;base64,QUFB"}},
		})
		assert.Len(t, blocks, 1)
	})

	t.Run("mapTools schema varieties", func(t *testing.T) {
		tools := []agent.ToolDefinition{
			{Function: agent.FunctionDefinition{Name: "f1", Parameters: map[string]any{
				"properties":           map[string]any{"p1": map[string]any{"type": "string"}},
				"required":             []any{"p1"},
				"additionalProperties": false,
			}}},
			{Function: agent.FunctionDefinition{Name: "f2", Parameters: map[string]any{
				"required": []string{"p2"},
			}}},
		}
		res := adapter.mapTools(tools)
		assert.Len(t, res, 2)
		assert.Equal(t, []string{"p1"}, res[0].OfTool.InputSchema.Required)
		schemaRaw, err := json.Marshal(res[0].OfTool.InputSchema)
		require.NoError(t, err)
		var schema map[string]any
		err = json.Unmarshal(schemaRaw, &schema)
		require.NoError(t, err)
		additionalProps, ok := schema["additionalProperties"].(bool)
		assert.True(t, ok)
		assert.False(t, additionalProps)
	})

	t.Run("mapTools preserves typed tool parameters", func(t *testing.T) {
		defs := []agent.ToolDefinition{
			{Function: agent.FunctionDefinition{Name: "computer_use", Parameters: tools.ToolParameters{
				Type:       "object",
				Properties: map[string]any{"action": map[string]any{"type": "string"}},
				Required:   []string{"action"},
			}}},
		}
		res := adapter.mapTools(defs)
		assert.Len(t, res, 1)
		assert.Equal(t, []string{"action"}, res[0].OfTool.InputSchema.Required)
		assert.Contains(t, res[0].OfTool.InputSchema.Properties, "action")
	})

	t.Run("fromStreamEvent variants", func(t *testing.T) {
		pending := make(map[int64]pendingTool)
		// start tool
		raw1 := `{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"f1"}}`
		var ev1 anthropic.MessageStreamEventUnion
		_ = json.Unmarshal([]byte(raw1), &ev1)
		chunk1, _ := adapter.fromStreamEvent(ev1, pending)
		assert.Equal(t, "f1", chunk1.Choices[0].Delta.ToolCalls[0].Function.Name)

		// delta tool
		raw2 := `{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}`
		var ev2 anthropic.MessageStreamEventUnion
		_ = json.Unmarshal([]byte(raw2), &ev2)
		chunk2, _ := adapter.fromStreamEvent(ev2, pending)
		assert.Equal(t, "{}", chunk2.Choices[0].Delta.ToolCalls[0].Function.Arguments)

		// thinking
		raw3 := `{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"think"}}`
		var ev3 anthropic.MessageStreamEventUnion
		_ = json.Unmarshal([]byte(raw3), &ev3)
		chunk3, _ := adapter.fromStreamEvent(ev3, pending)
		assert.Equal(t, "think", chunk3.Choices[0].Delta.Reasoning)

		// usage
		raw4 := `{"type":"message_delta","usage":{"input_tokens":5,"output_tokens":10,"cache_read_input_tokens":2}}`
		var ev4 anthropic.MessageStreamEventUnion
		_ = json.Unmarshal([]byte(raw4), &ev4)
		chunk4, _ := adapter.fromStreamEvent(ev4, pending)
		assert.Equal(t, int64(5), chunk4.Usage.PromptTokens)
		assert.Equal(t, int64(10), chunk4.Usage.CompletionTokens)
		assert.Equal(t, int64(15), chunk4.Usage.TotalTokens)
		assert.Equal(t, int64(2), chunk4.Usage.CachedTokens)
	})

	t.Run("fromStreamEvent ignored events", func(t *testing.T) {
		pending := map[int64]pendingTool{1: {id: "t1", name: "lookup"}}
		rawEvents := []string{
			`{"type":"content_block_start","index":0,"content_block":{"type":"text","text":"hello"}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":""}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}`,
			`{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":""}}`,
			`{"type":"content_block_stop","index":1}`,
			`{"type":"message_start"}`,
		}
		for _, raw := range rawEvents {
			var ev anthropic.MessageStreamEventUnion
			_ = json.Unmarshal([]byte(raw), &ev)
			chunk, ok := adapter.fromStreamEvent(ev, pending)
			assert.False(t, ok)
			assert.Empty(t, chunk)
		}
		assert.NotContains(t, pending, int64(1))
	})

	t.Run("mapContentParts coverage", func(t *testing.T) {
		parts := []agent.ContentPart{
			{Type: agent.ContentPartText, Text: "hi"},
			{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "http://test"}},
			{Type: agent.ContentPartInputAudio},
		}
		res := adapter.mapContentParts(parts)
		assert.Len(t, res, 2)
	})

	t.Run("toCoreCompletion content varieties", func(t *testing.T) {
		resp := &anthropic.Message{
			Content: []anthropic.ContentBlockUnion{
				{Type: "text", Text: "h"},
				{Type: "thinking", Thinking: "t"},
				{Type: "tool_use", ID: "t1", Name: "f", Input: json.RawMessage("{}")},
			},
		}
		res := adapter.toCoreCompletion(resp)
		assert.Equal(t, "h", res.Choices[0].Message.Content)
		assert.Equal(t, "t", res.Choices[0].Message.Reasoning)
	})

	t.Run("toCoreCompletion joins repeated text and thinking blocks", func(t *testing.T) {
		resp := &anthropic.Message{
			Content: []anthropic.ContentBlockUnion{
				{Type: "text", Text: "first"},
				{Type: "text", Text: ""},
				{Type: "text", Text: "second"},
				{Type: "thinking", Thinking: "one"},
				{Type: "thinking", Thinking: "two"},
			},
		}
		res := adapter.toCoreCompletion(resp)
		assert.Equal(t, "first\nsecond", res.Choices[0].Message.Content)
		assert.Equal(t, "one\ntwo", res.Choices[0].Message.Reasoning)
	})
}

func BenchmarkAnthropicMapContentPartsDataURI(b *testing.B) {
	adapter := &AnthropicAdapter{}
	dataURI := "data:image/png;base64," + strings.Repeat("QUJD", 64*1024)
	parts := []agent.ContentPart{
		{Type: agent.ContentPartText, Text: "describe this image"},
		{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: dataURI}},
	}

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		benchmarkAnthropicContentParts = adapter.mapContentParts(parts)
	}
}

func BenchmarkAnthropicMapToolsStandardSchemas(b *testing.B) {
	adapter := &AnthropicAdapter{}
	tools := make([]agent.ToolDefinition, 0, 64)
	for i := range 64 {
		tools = append(tools, agent.ToolDefinition{
			Type: "function",
			Function: agent.FunctionDefinition{
				Name:        fmt.Sprintf("tool_%d", i),
				Description: "lookup information",
				Parameters: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"query": map[string]any{"type": "string"},
					},
					"required": []string{"query"},
				},
			},
		})
	}

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		benchmarkAnthropicTools = adapter.mapTools(tools)
	}
}
