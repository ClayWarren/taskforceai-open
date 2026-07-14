package tools

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

func TestRunExportedToolCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	result := runExportedTool(protocol.ToolContext{Ctx: ctx}, map[string]any{"x": "y"}, func(protocol.ToolContext, map[string]any) ToolResult {
		t.Fatal("handler should not run for canceled context")
		return ToolResult{}
	})

	assert.Equal(t, "error", result.Status)
	assert.Contains(t, result.Error, context.Canceled.Error())
}
