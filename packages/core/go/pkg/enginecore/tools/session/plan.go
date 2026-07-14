package session

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

func ExecutePlanEnter(_ protocol.ToolContext, _ map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(map[string]any{})
	state.Status = "error"
	state.Error = "Error: The user dismissed this question"
	return state
}

func ExecutePlanExit(_ protocol.ToolContext, _ map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(map[string]any{})
	state.Status = "error"
	state.Error = "Error: The user dismissed this question"
	return state
}
