package pkg

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/tools"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestOpenAIAdapter(t *testing.T) {
	mm := new(MockOpenAIResponses)
	adapter := &OpenAIAdapter{
		defaultClient: mm,
		breaker:       circuitbreaker.New(circuitbreaker.Config{Name: "test", FailureThreshold: 5, IsTransient: isOpenAIRetryableError}),
		clients:       make(map[string]IOpenAIResponses),
	}

	t.Run("isOpenAIRetryableError", func(t *testing.T) {
		assert.True(t, isOpenAIRetryableError(fmt.Errorf("429")))
		assert.True(t, isOpenAIRetryableError(fmt.Errorf("502")))
		assert.True(t, isOpenAIRetryableError(fmt.Errorf("timeout")))
		assert.False(t, isOpenAIRetryableError(fmt.Errorf("400")))
		assert.False(t, isOpenAIRetryableError(nil))
	})

	t.Run("CreateChatCompletion retry path", func(t *testing.T) {
		mm.On("New", mock.Anything, mock.Anything, mock.Anything).Return((*responses.Response)(nil), fmt.Errorf("rate limit")).Once()
		mm.On("New", mock.Anything, mock.Anything, mock.Anything).Return(&responses.Response{ID: "r2"}, nil).Once()
		temperature := 0.1
		res, err := adapter.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "gpt-4", Temperature: &temperature, Tools: []agent.ToolDefinition{{Function: agent.FunctionDefinition{Name: "f"}}}})
		require.NoError(t, err)
		assert.Equal(t, "r2", res.ID)
	})

	t.Run("CreateChatCompletion distinguishes unset and zero temperature", func(t *testing.T) {
		mmTemp := new(MockOpenAIResponses)
		a := &OpenAIAdapter{
			defaultClient: mmTemp,
			breaker:       circuitbreaker.New(circuitbreaker.Config{Name: "openai-temperature", FailureThreshold: 5, IsTransient: isOpenAIRetryableError}),
			clients:       make(map[string]IOpenAIResponses),
		}

		mmTemp.On("New", mock.Anything, mock.MatchedBy(func(body responses.ResponseNewParams) bool {
			return !body.Temperature.Valid()
		}), mock.Anything).Return(&responses.Response{ID: "unset"}, nil).Once()
		zero := 0.0
		mmTemp.On("New", mock.Anything, mock.MatchedBy(func(body responses.ResponseNewParams) bool {
			return body.Temperature.Valid() && body.Temperature.Value == 0
		}), mock.Anything).Return(&responses.Response{ID: "zero"}, nil).Once()

		_, err := a.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "gpt-4"})
		require.NoError(t, err)
		_, err = a.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "gpt-4", Temperature: &zero})
		require.NoError(t, err)
	})

	t.Run("toResponsesNewParams forwards model-aware reasoning effort", func(t *testing.T) {
		params := adapter.toResponsesNewParams(agent.ChatCompletionCreateParams{
			Model:           "openai/gpt-5.6-sol",
			ReasoningEffort: "max",
		})
		encoded, err := json.Marshal(params)
		require.NoError(t, err)
		assert.Contains(t, string(encoded), `"reasoning":{"effort":"max"}`)
	})

	t.Run("CreateChatCompletion non-retryable error", func(t *testing.T) {
		mmError := new(MockOpenAIResponses)
		a := &OpenAIAdapter{
			defaultClient: mmError,
			breaker:       circuitbreaker.New(circuitbreaker.Config{Name: "openai-error", FailureThreshold: 5, IsTransient: isOpenAIRetryableError}),
			clients:       make(map[string]IOpenAIResponses),
			fileClients:   make(map[string]*openai.FileService),
		}
		mmError.On("New", mock.Anything, mock.Anything, mock.Anything).Return((*responses.Response)(nil), fmt.Errorf("bad request")).Once()

		res, err := a.CreateChatCompletion(context.Background(), agent.ChatCompletionCreateParams{Model: "gpt-4"})
		assert.Nil(t, res)
		assert.ErrorContains(t, err, "bad request")
	})

	t.Run("CreateChatCompletionStream Network", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte(`data: {"type":"response.output_text.delta","delta":"hi"}` + "\n\ndata: [DONE]\n\n"))
		}))
		defer server.Close()
		a := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "k", BaseURL: server.URL}})
		var content strings.Builder
		_ = a.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{Model: "gpt-4"}, func(chunk agent.ChatCompletionChunk) {
			if len(chunk.Choices) > 0 {
				content.WriteString(chunk.Choices[0].Delta.Content)
			}
		})
		assert.Equal(t, "hi", content.String())
	})

	t.Run("CreateChatCompletionStream uses placeholder auth when gateway key is missing", func(t *testing.T) {
		var authHeader string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte(`data: {"type":"response.output_text.delta","delta":"hi"}` + "\n\ndata: [DONE]\n\n"))
		}))
		defer server.Close()

		a := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{BaseURL: server.URL}})
		err := a.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{Model: "gpt-4"}, nil)
		require.NoError(t, err)
		assert.Equal(t, "Bearer missing", authHeader)
	})

	t.Run("CreateChatCompletionStream loop error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte(`data: {"type":"error","error":{"message":"fail"}}` + "\n\n"))
		}))
		defer server.Close()
		a := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "k", BaseURL: server.URL}})
		err := a.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{Model: "gpt-4"}, func(chunk agent.ChatCompletionChunk) {})
		assert.Error(t, err)
	})

	t.Run("toResponsesInput variants", func(t *testing.T) {
		msgs := []agent.ChatCompletionMessage{
			{Role: agent.RoleSystem, Content: "s"},
			{Role: agent.RoleUser, Content: "u"},
			{Role: agent.RoleAssistant, Content: "a", ToolCalls: []agent.ToolCall{{ID: "t1", Function: agent.ToolCallFunction{Name: "f"}}}},
			{Role: agent.RoleAssistant, ToolCalls: []agent.ToolCall{{ID: "t2", Function: agent.ToolCallFunction{Name: "g", Arguments: "{}"}}}},
			{Role: agent.RoleTool, Content: "r", ToolID: "t1"},
			{Role: "unknown", Content: "u"},
		}
		items := adapter.toResponsesInput(msgs)
		assert.Len(t, items, 7)
	})

	t.Run("mapResponsesMultimodalUserMessage exhaustive", func(t *testing.T) {
		msg := agent.ChatCompletionMessage{
			Role: agent.RoleUser,
			ContentParts: []agent.ContentPart{
				{Type: agent.ContentPartText, Text: "t"},
				{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "http://i", Detail: "low"}},
				{Type: agent.ContentPartImageURL, ImageURL: &agent.ImageURLPart{URL: "http://i2", Detail: "high"}},
				{Type: agent.ContentPartFileData, FileData: &agent.FileDataPart{FileURI: "gs://f"}},
				{Type: agent.ContentPartInputAudio, InputAudio: &agent.InputAudioPart{Data: "AAAA", Format: "mp3"}},
			},
		}
		items := adapter.mapResponsesMultimodalUserMessage(msg)
		assert.Len(t, items, 2)
	})

	t.Run("mapResponsesMultimodalUserMessage audio errors", func(t *testing.T) {
		msg := agent.ChatCompletionMessage{
			Role: agent.RoleUser,
			ContentParts: []agent.ContentPart{
				{Type: agent.ContentPartImageURL},
				{Type: agent.ContentPartFileData},
				{Type: agent.ContentPartInputAudio},
				{Type: agent.ContentPartInputAudio, InputAudio: &agent.InputAudioPart{Data: "", Format: "mp3"}},
				{Type: agent.ContentPartInputAudio, InputAudio: &agent.InputAudioPart{Data: "A", Format: "invalid"}},
			},
		}
		items := adapter.mapResponsesMultimodalUserMessage(msg)
		assert.Empty(t, items)
	})

	t.Run("mapResponsesMultimodalUserMessage wav audio", func(t *testing.T) {
		items := adapter.mapResponsesMultimodalUserMessage(agent.ChatCompletionMessage{
			Role: agent.RoleUser,
			ContentParts: []agent.ContentPart{
				{Type: agent.ContentPartInputAudio, InputAudio: &agent.InputAudioPart{Data: " QUFB ", Format: " WAV "}},
			},
		})
		assert.Len(t, items, 1)
	})

	t.Run("toResponsesTool with params", func(t *testing.T) {
		tools := []agent.ToolDefinition{
			{Function: agent.FunctionDefinition{Name: "f1", Parameters: map[string]any{"type": "object"}}},
			{Function: agent.FunctionDefinition{Name: "f2"}},
		}
		res := adapter.toResponsesTool(tools)
		assert.Len(t, res, 2)
	})

	t.Run("toResponsesTool preserves typed tool parameters", func(t *testing.T) {
		defs := []agent.ToolDefinition{
			{Function: agent.FunctionDefinition{Name: "computer_use", Parameters: tools.ToolParameters{
				Type:       "object",
				Properties: map[string]any{"action": map[string]any{"type": "string"}},
				Required:   []string{"action"},
			}}},
		}
		res := adapter.toResponsesTool(defs)
		assert.Len(t, res, 1)
		params := res[0].OfFunction.Parameters
		assert.Equal(t, "object", params["type"])
		assert.Equal(t, []any{"action"}, params["required"])
		assert.Contains(t, params["properties"], "action")
	})

	t.Run("toResponsesTool omits nil required fields", func(t *testing.T) {
		defs := []agent.ToolDefinition{
			{Function: agent.FunctionDefinition{Name: "search_web", Parameters: tools.ToolParameters{
				Type:       "object",
				Properties: map[string]any{},
			}}},
			{Function: agent.FunctionDefinition{Name: "nested", Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"item": map[string]any{
						"type":     "object",
						"required": nil,
					},
				},
				"required": nil,
			}}},
		}
		res := adapter.toResponsesTool(defs)
		require.Len(t, res, 2)
		assert.NotContains(t, res[0].OfFunction.Parameters, "required")
		assert.NotContains(t, res[1].OfFunction.Parameters, "required")
		properties, ok := res[1].OfFunction.Parameters["properties"].(map[string]any)
		require.True(t, ok)
		item, ok := properties["item"].(map[string]any)
		require.True(t, ok)
		assert.NotContains(t, item, "required")
	})

	t.Run("fromResponsesEvent register/reasoning/usage", func(t *testing.T) {
		state := newResponsesStreamState()
		chunk0, ok0 := adapter.fromResponsesEvent(responses.ResponseStreamEventUnion{Type: "response.output_text.delta", Delta: "hello"}, state)
		assert.True(t, ok0)
		assert.Equal(t, "hello", chunk0.Choices[0].Delta.Content)

		// reasoning
		ev1 := responses.ResponseStreamEventUnion{Type: "response.reasoning_summary_text.delta", Delta: "t"}
		chunk1, _ := adapter.fromResponsesEvent(ev1, state)
		assert.Equal(t, "t", chunk1.Choices[0].Delta.Reasoning)

		// register function call
		ev2 := responses.ResponseStreamEventUnion{Type: "response.output_item.added", Item: responses.ResponseOutputItemUnion{Type: "function_call", ID: "fc1", CallID: "c1", Name: "f1"}}
		chunk2, _ := adapter.fromResponsesEvent(ev2, state)
		assert.Equal(t, "f1", chunk2.Choices[0].Delta.ToolCalls[0].Function.Name)

		// delta byItemID
		ev3 := responses.ResponseStreamEventUnion{Type: "response.function_call_arguments.delta", ItemID: "fc1", Delta: "{}"}
		chunk3, _ := adapter.fromResponsesEvent(ev3, state)
		assert.Equal(t, "{}", chunk3.Choices[0].Delta.ToolCalls[0].Function.Arguments)

		// byItemID new
		ev4 := responses.ResponseStreamEventUnion{Type: "response.function_call_arguments.delta", ItemID: "new", Delta: "{}"}
		chunk4, _ := adapter.fromResponsesEvent(ev4, state)
		assert.Equal(t, 1, *chunk4.Choices[0].Delta.ToolCalls[0].Index)

		// usage
		ev5 := responses.ResponseStreamEventUnion{Type: "response.completed", Response: responses.Response{Usage: responses.ResponseUsage{TotalTokens: 10}}}
		chunk5, _ := adapter.fromResponsesEvent(ev5, state)
		assert.Equal(t, int64(10), chunk5.Usage.TotalTokens)
	})

	t.Run("fromResponsesEvent ignored events", func(t *testing.T) {
		state := newResponsesStreamState()
		events := []responses.ResponseStreamEventUnion{
			{Type: "response.output_text.delta"},
			{Type: "response.function_call_arguments.delta"},
			{Type: "response.output_item.added", Item: responses.ResponseOutputItemUnion{Type: "message"}},
			{Type: "response.reasoning_summary_text.delta"},
			{Type: "response.unknown"},
		}
		for _, ev := range events {
			chunk, ok := adapter.fromResponsesEvent(ev, state)
			assert.False(t, ok)
			assert.Empty(t, chunk)
		}
	})

	t.Run("fromResponsesCompletion", func(t *testing.T) {
		raw := `{"id":"r1","output":[{"type":"message","content":[{"type":"output_text","text":"hi"},{"type":"refusal","refusal":"no"}]},{"type":"function_call","call_id":"c1","name":"f1","arguments":"{}"},{"type":"reasoning","summary":[{"type":"summary_text","text":"think"},{"type":"summary_text","text":"more"}]}]}`
		var resp responses.Response
		_ = json.Unmarshal([]byte(raw), &resp)
		res := adapter.fromResponsesCompletion(&resp)
		assert.Equal(t, "hi\nno", res.Choices[0].Message.Content)
		assert.Equal(t, "think\nmore", res.Choices[0].Message.Reasoning)
		assert.Len(t, res.Choices[0].Message.ToolCalls, 1)
	})

	t.Run("formatResponseArguments variants", func(t *testing.T) {
		var stringArgs responses.ResponseOutputItemUnionArguments
		require.NoError(t, json.Unmarshal([]byte(`"{\"city\":\"Austin\"}"`), &stringArgs))
		assert.JSONEq(t, `{"city":"Austin"}`, formatResponseArguments(stringArgs))

		var structuredArgs responses.ResponseOutputItemUnionArguments
		require.NoError(t, json.Unmarshal([]byte(`{"query":"docs","filters":{"public":true}}`), &structuredArgs))
		assert.JSONEq(t, `{"query":"docs","filters":{"public":true}}`, formatResponseArguments(structuredArgs))

		assert.Equal(t, `{}`, formatResponseArguments(responses.ResponseOutputItemUnionArguments{}))
	})

	t.Run("model-specific clients are cached", func(t *testing.T) {
		cfg := config.Config{
			Gateway: config.GatewayConfig{BaseURL: "http://g"},
			Models:  config.ModelsConfig{Options: []config.ModelOption{{ID: "m1", BaseURL: "http://m1"}}},
		}
		a := NewOpenAIAdapter(cfg)
		assert.Equal(t, "http://m1", a.customBaseURLForModel("m1"))
		assert.Empty(t, a.customBaseURLForModel("other"))

		c1 := a.getClient("m1")
		assert.NotNil(t, c1)
		c2 := a.getClient("m1")
		assert.Equal(t, c1, c2)
	})

	t.Run("UploadFile routes model-specific base URL", func(t *testing.T) {
		var defaultFiles atomic.Int32
		var customFiles atomic.Int32

		defaultServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.Contains(r.URL.Path, "/files") {
				defaultFiles.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"file-default","object":"file","bytes":3,"created_at":1,"filename":"x.txt","purpose":"user_data"}`))
				return
			}
			http.Error(w, "unexpected path", http.StatusNotFound)
		}))
		defer defaultServer.Close()

		customServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.Contains(r.URL.Path, "/files") {
				customFiles.Add(1)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"id":"file-custom","object":"file","bytes":3,"created_at":1,"filename":"x.txt","purpose":"user_data"}`))
				return
			}
			http.Error(w, "unexpected path", http.StatusNotFound)
		}))
		defer customServer.Close()

		cfg := config.Config{
			Gateway: config.GatewayConfig{
				APIKey:  "k",
				BaseURL: defaultServer.URL,
			},
			Models: config.ModelsConfig{
				Options: []config.ModelOption{
					{ID: "custom-model", BaseURL: customServer.URL},
				},
			},
		}
		a := NewOpenAIAdapter(cfg)

		customCtx := WithUploadModel(context.Background(), "custom-model")
		id, err := a.UploadFile(customCtx, strings.NewReader("abc"), "x.txt", "text/plain")
		require.NoError(t, err)
		assert.Equal(t, "file-custom", id)
		assert.Equal(t, int32(1), customFiles.Load())
		assert.Equal(t, int32(0), defaultFiles.Load())

		defaultID, err := a.UploadFile(context.Background(), strings.NewReader("abc"), "x.txt", "text/plain")
		require.NoError(t, err)
		assert.Equal(t, "file-default", defaultID)
		assert.Equal(t, int32(1), defaultFiles.Load())
	})

	t.Run("UploadFile returns service error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, `{"error":{"message":"upload rejected"}}`, http.StatusBadRequest)
		}))
		defer server.Close()

		a := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "k", BaseURL: server.URL}})
		id, err := a.UploadFile(context.Background(), strings.NewReader("abc"), "x.txt", "text/plain")
		assert.Empty(t, id)
		assert.Error(t, err)
	})

	t.Run("register existing update", func(t *testing.T) {
		state := newResponsesStreamState()
		state.register("i1", "c1", "n1")
		state.register("i1", "c2", "n2")
		s := state.byItemID("i1")
		assert.Equal(t, "c2", s.CallID)
	})

	t.Run("fromResponsesEvent function call continuity", func(t *testing.T) {
		state := newResponsesStreamState()

		// Delta can arrive before function_call metadata.
		ev1 := responses.ResponseStreamEventUnion{Type: "response.function_call_arguments.delta", ItemID: "fc-out-of-order", Delta: `{"x":`}
		chunk1, ok1 := adapter.fromResponsesEvent(ev1, state)
		assert.True(t, ok1)
		assert.Equal(t, 0, *chunk1.Choices[0].Delta.ToolCalls[0].Index)
		assert.Empty(t, chunk1.Choices[0].Delta.ToolCalls[0].ID)
		assert.Empty(t, chunk1.Choices[0].Delta.ToolCalls[0].Function.Name)
		assert.Equal(t, `{"x":`, chunk1.Choices[0].Delta.ToolCalls[0].Function.Arguments)

		// Metadata for the same item should preserve the index and fill missing fields.
		ev2 := responses.ResponseStreamEventUnion{
			Type: "response.output_item.added",
			Item: responses.ResponseOutputItemUnion{Type: "function_call", ID: "fc-out-of-order", CallID: "call-1", Name: "lookup"},
		}
		chunk2, ok2 := adapter.fromResponsesEvent(ev2, state)
		assert.True(t, ok2)
		assert.Equal(t, 0, *chunk2.Choices[0].Delta.ToolCalls[0].Index)
		assert.Equal(t, "call-1", chunk2.Choices[0].Delta.ToolCalls[0].ID)
		assert.Equal(t, "lookup", chunk2.Choices[0].Delta.ToolCalls[0].Function.Name)

		// Follow-up deltas should continue using the same call metadata and index.
		ev3 := responses.ResponseStreamEventUnion{Type: "response.function_call_arguments.delta", ItemID: "fc-out-of-order", Delta: `"y"}`}
		chunk3, ok3 := adapter.fromResponsesEvent(ev3, state)
		assert.True(t, ok3)
		assert.Equal(t, 0, *chunk3.Choices[0].Delta.ToolCalls[0].Index)
		assert.Equal(t, "call-1", chunk3.Choices[0].Delta.ToolCalls[0].ID)
		assert.Equal(t, "lookup", chunk3.Choices[0].Delta.ToolCalls[0].Function.Name)

		// Next function call should receive the next index.
		ev4 := responses.ResponseStreamEventUnion{
			Type: "response.output_item.added",
			Item: responses.ResponseOutputItemUnion{Type: "function_call", ID: "fc-next", CallID: "call-2", Name: "search"},
		}
		chunk4, ok4 := adapter.fromResponsesEvent(ev4, state)
		assert.True(t, ok4)
		assert.Equal(t, 1, *chunk4.Choices[0].Delta.ToolCalls[0].Index)
		assert.Equal(t, "call-2", chunk4.Choices[0].Delta.ToolCalls[0].ID)
		assert.Equal(t, "search", chunk4.Choices[0].Delta.ToolCalls[0].Function.Name)
	})
}

func TestOpenAIAdapter_GetClient_ConcurrentAccess(t *testing.T) {
	cfg := config.Config{
		Gateway: config.GatewayConfig{BaseURL: "http://gateway"},
		Models: config.ModelsConfig{
			Options: []config.ModelOption{
				{ID: "custom-model", BaseURL: "http://custom-endpoint"},
			},
		},
	}
	a := NewOpenAIAdapter(cfg)

	const goroutines = 20
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for range goroutines {
		go func() {
			defer wg.Done()
			// All goroutines request the same custom model to maximise
			// the chance of a concurrent map write collision.
			client := a.getClient("custom-model")
			assert.NotNil(t, client)
		}()
	}
	wg.Wait()
}

var benchmarkOpenAIClient IOpenAIResponses

func BenchmarkOpenAIGetClientCustomBaseURL(b *testing.B) {
	const modelCount = 1000
	options := make([]config.ModelOption, 0, modelCount)
	for i := range modelCount {
		options = append(options, config.ModelOption{
			ID:      fmt.Sprintf("model-%d", i),
			BaseURL: fmt.Sprintf("https://models.example/%d", i),
		})
	}

	targetURL := "https://models.example/999"
	cachedClient := new(MockOpenAIResponses)
	adapter := &OpenAIAdapter{
		cfg:                  config.Config{Models: config.ModelsConfig{Options: options}},
		defaultClient:        new(MockOpenAIResponses),
		clients:              map[string]IOpenAIResponses{targetURL: cachedClient},
		customBaseURLByModel: buildOpenAICustomBaseURLByModel(options),
	}

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		benchmarkOpenAIClient = adapter.getClient("model-999")
	}
}
