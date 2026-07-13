package tools

import "github.com/TaskForceAI/core/pkg/enginecore/protocol"

func toolInvalid(_ protocol.ToolContext, _ map[string]any) ToolResult {
	state := NewToolResult(map[string]any{})
	state.Status = "error"
	state.Error = "Error: invalid tool call"
	return state
}
