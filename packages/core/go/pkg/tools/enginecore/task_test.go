package tools

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

func TestToolTask(t *testing.T) {
	ctx := protocol.ToolContext{}

	t.Run("task success", func(t *testing.T) {
		args := map[string]any{
			"description":   "test task",
			"prompt":        "do something",
			"subagent_type": "researcher",
		}
		res := toolTask(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "session_id:")
		assert.Equal(t, "test task", res.Title)
	})

	t.Run("task missing args", func(t *testing.T) {
		args := map[string]any{}
		res := toolTask(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "invalid arguments")
	})
}
