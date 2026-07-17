package pkg

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	coreengine "github.com/TaskForceAI/core/pkg/engine"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/trace"
)

type errLLMStream[T any] struct {
	err    error
	closed atomic.Bool
}

func (s *errLLMStream[T]) Next() bool   { return false }
func (s *errLLMStream[T]) Current() T   { var zero T; return zero }
func (s *errLLMStream[T]) Err() error   { return s.err }
func (s *errLLMStream[T]) Close() error { s.closed.Store(true); return nil }

type blockingLLMStream[T any] struct {
	unblock chan struct{}
	closed  atomic.Bool
	once    sync.Once
}

func (s *blockingLLMStream[T]) Next() bool {
	<-s.unblock
	return false
}
func (s *blockingLLMStream[T]) Current() T { var zero T; return zero }
func (s *blockingLLMStream[T]) Err() error { return nil }
func (s *blockingLLMStream[T]) Close() error {
	s.once.Do(func() {
		s.closed.Store(true)
		close(s.unblock)
	})
	return nil
}

// finiteLLMStream yields a fixed set of events and then completes cleanly.
type finiteLLMStream[T any] struct {
	events  []T
	index   int
	current T
	closed  atomic.Bool
}

func (s *finiteLLMStream[T]) Next() bool {
	if s.index >= len(s.events) {
		return false
	}
	s.current = s.events[s.index]
	s.index++
	return true
}
func (s *finiteLLMStream[T]) Current() T   { return s.current }
func (s *finiteLLMStream[T]) Err() error   { return nil }
func (s *finiteLLMStream[T]) Close() error { s.closed.Store(true); return nil }

// gatedLLMStream blocks in Next until its gate channel is closed, then yields a
// single event. It lets a test hold the reader goroutine back until the
// consumer loop has already exited.
type gatedLLMStream[T any] struct {
	gate     chan struct{}
	event    T
	served   bool
	closedCh chan struct{}
	once     sync.Once
}

func (s *gatedLLMStream[T]) Next() bool {
	<-s.gate
	if s.served {
		return false
	}
	s.served = true
	return true
}
func (s *gatedLLMStream[T]) Current() T { return s.event }
func (s *gatedLLMStream[T]) Err() error { return nil }
func (s *gatedLLMStream[T]) Close() error {
	s.once.Do(func() { close(s.closedCh) })
	return nil
}

func TestAnthropicCacheControlParamNil(t *testing.T) {
	// A nil cache control returns the default ephemeral param without panicking.
	_ = anthropicCacheControlParam(nil)
}

func TestConsumeLLMEventStreamNilCancelAndFiniteStream(t *testing.T) {
	span := trace.SpanFromContext(context.Background())
	stream := &finiteLLMStream[string]{events: []string{"a", "b"}}

	var handled []string
	// A nil cancelStream must be tolerated (replaced with a no-op internally),
	// and every event should be delivered before a clean completion.
	err := consumeLLMEventStream(context.Background(), span, stream, nil, time.Second,
		"model", "timeout", "stream failed", func(event string) {
			handled = append(handled, event)
		})
	require.NoError(t, err)
	assert.Equal(t, []string{"a", "b"}, handled)
	assert.True(t, stream.closed.Load())
}

func TestConsumeLLMEventStreamNilCancelContextDoneInvokesNoop(t *testing.T) {
	span := trace.SpanFromContext(context.Background())
	blocking := &blockingLLMStream[string]{unblock: make(chan struct{})}

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()

	// A nil cancelStream must be tolerated when the parent context is canceled;
	// the internal no-op cancel func is invoked on the ctx.Done path.
	err := consumeLLMEventStream(ctx, span, blocking, nil, time.Hour,
		"model", "timeout", "stream failed", nil)
	require.ErrorIs(t, err, context.Canceled)

	// Unblock the reader goroutine so it can observe the canceled context and
	// exit cleanly (goleak asserts no leaked goroutines).
	_ = blocking.Close()
}

func TestConsumeLLMEventStreamReaderStopsWhenConsumerGone(t *testing.T) {
	span := trace.SpanFromContext(context.Background())
	stream := &gatedLLMStream[string]{
		gate:     make(chan struct{}),
		event:    "late",
		closedCh: make(chan struct{}),
	}
	ctx, cancel := context.WithCancel(context.Background())

	// Run the consumer while the reader goroutine is parked in Next (gate is
	// still open). A long timeout guarantees the timeout branch never fires.
	done := make(chan error, 1)
	go func() {
		done <- consumeLLMEventStream(ctx, span, stream, func() {}, time.Hour,
			"model", "timeout", "stream failed", nil)
	}()

	// Cancel so the consumer exits via ctx.Done and stops reading results.
	cancel()
	require.ErrorIs(t, <-done, context.Canceled)

	// Only now release the reader: it produces an event, but the consumer is
	// gone, so the send is abandoned on ctx.Done and the reader returns. This
	// deterministically exercises the reader's cancellation cleanup path.
	close(stream.gate)
	select {
	case <-stream.closedCh:
	case <-time.After(time.Second):
		t.Fatal("reader goroutine did not exit after consumer cancellation")
	}
}

func TestSendLLMStreamResultAbandonsOnCanceledContext(t *testing.T) {
	results := make(chan llmStreamResult[string]) // unbuffered, no reader
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if sendLLMStreamResult(ctx, results, llmStreamResult[string]{done: true}) {
		t.Fatal("expected send to be abandoned when context is canceled")
	}

	// With a reader available the send succeeds.
	ready := make(chan llmStreamResult[string], 1)
	if !sendLLMStreamResult(context.Background(), ready, llmStreamResult[string]{event: "x"}) {
		t.Fatal("expected buffered send to succeed")
	}
	assert.Equal(t, "x", (<-ready).event)
}

func TestAnthropicHelperEdges(t *testing.T) {
	mime, encoded, ok := parseDataURIBase64("image/png;base64,QUFB")
	assert.Empty(t, mime)
	assert.Empty(t, encoded)
	assert.False(t, ok)

	_, _, ok = parseDataURIBase64("data:image/png;base64")
	assert.False(t, ok)

	mime, encoded, ok = parseDataURIBase64("data:image/png;base64,QQ")
	assert.True(t, ok)
	assert.Equal(t, "image/png", mime)
	assert.Equal(t, "QQ==", encoded)

	_, encoded, ok = parseDataURIBase64("data:image/png;base64,QUF")
	assert.True(t, ok)
	assert.Equal(t, "QUF=", encoded)

	_, _, ok = parseDataURIBase64("data:image/png;base64,Q")
	assert.False(t, ok)

	assert.Empty(t, anthropicToolInputSchema(nil).Properties)
	assert.Equal(t, []string{"prompt"}, anthropicRequiredFields([]string{"prompt"}))
	assert.Nil(t, anthropicRequiredFields(123))
}

func TestNormalizeToolParametersEdges(t *testing.T) {
	assert.Empty(t, normalizeToolParameters(nil))
	assert.Empty(t, normalizeToolParameters(make(chan int)))
	assert.Empty(t, normalizeToolParameters("not object"))
	assert.Empty(t, normalizeToolParameters(json.RawMessage("null")))
	assert.Empty(t, normalizeToolParameters(map[string]any{"properties": "not an object"}))
	assert.Equal(t, map[string]any{
		"items": []any{"value", map[string]any{}},
	}, normalizeToolParameters(map[string]any{
		"items": []any{nil, "value", map[string]any{"nullable": nil}},
	}))

	assert.Equal(t, map[string]any{
		"type": "object",
		"properties": map[string]any{
			"required": map[string]any{"type": "string"},
		},
		"required": []any{"required"},
	}, normalizeToolParameters(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"required": map[string]any{"type": "string"},
		},
		"required": []string{"required"},
	}))
}

func TestOpenAIHelperEdges(t *testing.T) {
	assert.Nil(t, buildOpenAICustomBaseURLByModel(nil))
	assert.Nil(t, buildOpenAICustomBaseURLByModel([]config.ModelOption{
		{ID: "", BaseURL: "http://missing-id"},
		{ID: "missing-base"},
	}))
	assert.Equal(t, map[string]string{"m": "http://first"}, buildOpenAICustomBaseURLByModel([]config.ModelOption{
		{ID: "m", BaseURL: "http://first"},
		{ID: "m", BaseURL: "http://second"},
	}))
	assert.Empty(t, normalizeBaseURL(""))

	adapter := &OpenAIAdapter{
		cfg: config.Config{Models: config.ModelsConfig{Options: []config.ModelOption{
			{ID: "fallback", BaseURL: "http://fallback"},
		}}},
		customBaseURLByModel: buildOpenAICustomBaseURLByModel([]config.ModelOption{
			{ID: "fallback", BaseURL: "http://fallback"},
		}),
	}
	assert.Equal(t, "http://fallback", adapter.customBaseURLForModel("fallback"))
	assert.Empty(t, adapter.customBaseURLForModel("missing"))

	_ = NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{
		APIKey:         "key",
		DefaultHeaders: map[string]string{"x-custom": "value"},
	}})
}

func TestOpenAIGetFileServiceUsesCachedCustomClient(t *testing.T) {
	cfg := config.Config{
		Gateway: config.GatewayConfig{APIKey: "key", BaseURL: "http://default"},
		Models: config.ModelsConfig{Options: []config.ModelOption{{
			ID:      "custom",
			BaseURL: "http://custom",
		}}},
	}
	adapter := NewOpenAIAdapter(cfg)
	first := adapter.getFileService("custom")
	second := adapter.getFileService("custom")
	assert.Equal(t, first, second)
}

func TestOpenAIToResponsesInputMultimodalAndAudioMarshalError(t *testing.T) {
	adapter := &OpenAIAdapter{}
	items := adapter.toResponsesInput([]agent.ChatCompletionMessage{{
		Role: agent.RoleUser,
		ContentParts: []agent.ContentPart{{
			Type: agent.ContentPartText,
			Text: "hello",
		}},
	}})
	assert.Len(t, items, 1)

	previous := marshalResponseInputAudio
	marshalResponseInputAudio = func(any) ([]byte, error) {
		return nil, errors.New("audio marshal failed")
	}
	t.Cleanup(func() {
		marshalResponseInputAudio = previous
	})

	items = adapter.mapResponsesMultimodalUserMessage(agent.ChatCompletionMessage{
		Role: agent.RoleUser,
		ContentParts: []agent.ContentPart{{
			Type:       agent.ContentPartInputAudio,
			InputAudio: &agent.InputAudioPart{Data: "QUFB", Format: "mp3"},
		}},
	})
	assert.Empty(t, items)
}

func TestOpenAIStreamRequestOptionsAndVideoErrorPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"type":"response.output_text.delta","delta":"ok"}` + "\n\ndata: [DONE]\n\n"))
	}))
	defer server.Close()

	adapter := NewOpenAIAdapter(config.Config{Gateway: config.GatewayConfig{APIKey: "key", BaseURL: server.URL}})
	var content strings.Builder
	temperature := 0.2
	err := adapter.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{
		Model:       "gpt-4",
		Temperature: &temperature,
		Tools: []agent.ToolDefinition{{
			Function: agent.FunctionDefinition{Name: "lookup"},
		}},
	}, func(chunk agent.ChatCompletionChunk) {
		if len(chunk.Choices) > 0 {
			content.WriteString(chunk.Choices[0].Delta.Content)
		}
	})
	require.NoError(t, err)
	assert.Equal(t, "ok", content.String())

	err = adapter.CreateChatCompletionStream(context.Background(), agent.ChatCompletionCreateParams{
		Model: coreengine.VideoGenerationModelID,
	}, nil)
	require.ErrorContains(t, err, "no user prompt")
}

func TestResilienceAndTelemetryEdges(t *testing.T) {
	span := trace.SpanFromContext(context.Background())
	recordSpanError(span, nil)

	breaker := circuitbreaker.New(circuitbreaker.Config{
		Name:             "llm-nil-completion",
		FailureThreshold: 5,
		IsTransient:      func(error) bool { return false },
	})
	completion, err := runCompletionWithResilience(
		context.Background(),
		span,
		breaker,
		func(error) bool { return false },
		"test-model",
		"completion failed",
		"completion was nil",
		func(context.Context) (*agent.ChatCompletion, error) {
			return nil, nil
		},
	)
	assert.Nil(t, completion)
	require.ErrorContains(t, err, "completion was nil")

	streamErr := errors.New("stream failed")
	errStream := &errLLMStream[string]{err: streamErr}
	ctx, cancel := context.WithCancel(context.Background())
	err = consumeLLMEventStream(ctx, span, errStream, cancel, time.Second, "model", "timeout", "stream failed", nil)
	require.ErrorIs(t, err, streamErr)
	assert.True(t, errStream.closed.Load())

	blocking := &blockingLLMStream[string]{unblock: make(chan struct{})}
	ctx, cancel = context.WithCancel(context.Background())
	err = consumeLLMEventStream(ctx, span, blocking, func() {
		cancel()
		_ = blocking.Close()
	}, time.Millisecond, "model", "timeout", "stream failed", nil)
	require.Error(t, err)
	assert.True(t, blocking.closed.Load())
}
