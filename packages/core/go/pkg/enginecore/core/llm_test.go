package core

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type scriptedLLMStream struct {
	events []LLMEvent
	err    error
	index  int
}

func (s *scriptedLLMStream) Next() (LLMEvent, bool, error) {
	if s.err != nil {
		return LLMEvent{}, false, s.err
	}
	if s.index >= len(s.events) {
		return LLMEvent{}, false, nil
	}
	ev := s.events[s.index]
	s.index++
	return ev, true, nil
}

func TestLLMStreamAdapterNext(t *testing.T) {
	usage := &Usage{InputTokens: 10}
	stream := &scriptedLLMStream{events: []LLMEvent{
		{Type: LLMStart},
		{Type: LLMText, Text: "hello"},
		{Type: LLMToolCall, ToolName: "read", ToolArgs: map[string]any{"filePath": "a.txt"}},
		{Type: LLMToolResult, ToolName: "read", ToolState: map[string]any{"status": "completed"}},
		{Type: LLMToolError, ToolName: "write", ToolArgs: map[string]any{"filePath": "b.txt"}, Err: errors.New("denied")},
		{Type: LLMFinishStep, Usage: usage, FinishReason: "stop", Metadata: map[string]any{"provider": "test"}},
		{Type: LLMFinishStep},
		{Type: LLMStreamError, Err: errors.New("stream failed")},
		{Type: LLMEventType("unknown")},
	}}
	adapter := NewLLMStreamAdapter(stream)

	ev, ok, err := adapter.Next()
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, EventStart, ev.Type)

	ev, _, _ = adapter.Next()
	assert.Equal(t, EventText, ev.Type)
	assert.Equal(t, "hello", ev.Text)

	ev, _, _ = adapter.Next()
	assert.Equal(t, EventTool, ev.Type)
	assert.Equal(t, "read", ev.Tool.Name)

	ev, _, _ = adapter.Next()
	assert.Equal(t, "completed", ev.ToolState["status"])

	ev, _, _ = adapter.Next()
	assert.Equal(t, "error", ev.ToolState["status"])
	assert.Equal(t, "Error: denied", ev.ToolState["error"])

	ev, _, _ = adapter.Next()
	assert.Equal(t, EventFinishStep, ev.Type)
	assert.Equal(t, usage, ev.FinishStep.Usage)
	assert.Equal(t, "stop", ev.FinishStep.FinishReason)

	ev, _, _ = adapter.Next()
	assert.Equal(t, EventFinishStep, ev.Type)
	assert.Nil(t, ev.FinishStep)

	ev, _, _ = adapter.Next()
	assert.Equal(t, EventError, ev.Type)
	require.EqualError(t, ev.Err, "stream failed")

	ev, ok, err = adapter.Next()
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, Event{}, ev)

	_, ok, err = adapter.Next()
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestLLMStreamAdapterErrorAndMessage(t *testing.T) {
	adapter := NewLLMStreamAdapter(&scriptedLLMStream{err: errors.New("boom")})
	_, ok, err := adapter.Next()
	assert.False(t, ok)
	require.ErrorContains(t, err, "llm stream: boom")
	assert.Equal(t, "Error: unknown error", errorMessage(nil))
}
