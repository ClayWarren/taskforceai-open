package core

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOpenAIEventMapper(t *testing.T) {
	m := OpenAIEventMapper{}

	t.Run("TextDelta", func(t *testing.T) {
		ev := m.TextDelta("hello")
		assert.Equal(t, LLMText, ev.Type)
		assert.Equal(t, "hello", ev.Text)
	})

	t.Run("ToolCall", func(t *testing.T) {
		args := map[string]any{"key": "val"}
		ev := m.ToolCall("mytool", args)
		assert.Equal(t, LLMToolCall, ev.Type)
		assert.Equal(t, "mytool", ev.ToolName)
		assert.Equal(t, args, ev.ToolArgs)
	})

	t.Run("ToolError", func(t *testing.T) {
		err := fmt.Errorf("fail")
		ev := m.ToolError("mytool", nil, err)
		assert.Equal(t, LLMToolError, ev.Type)
		assert.Equal(t, err, ev.Err)
	})

	t.Run("Finish", func(t *testing.T) {
		usage := &Usage{InputTokens: 10}
		meta := map[string]any{"m": "v"}
		ev := m.Finish(usage, "stop", meta)
		assert.Equal(t, LLMFinishStep, ev.Type)
		assert.Equal(t, usage, ev.Usage)
		assert.Equal(t, "stop", ev.FinishReason)
		assert.Equal(t, meta, ev.Metadata)
	})
}
