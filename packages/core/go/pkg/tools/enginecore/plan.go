package tools

import "github.com/TaskForceAI/core/pkg/enginecore/protocol"

func toolPlanEnter(_ protocol.ToolContext, _ map[string]any) ToolResult {
	state := NewToolResult(map[string]any{})
	state.Status = "error"
	state.Error = "Error: The user dismissed this question"
	return state
}

func toolPlanExit(_ protocol.ToolContext, _ map[string]any) ToolResult {
	state := NewToolResult(map[string]any{})
	state.Status = "error"
	state.Error = "Error: The user dismissed this question"
	return state
}
