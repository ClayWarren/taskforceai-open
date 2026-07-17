package session

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

// ExecutePlanEnter switches the session into plan mode: a read-only phase
// where every tool in the "edit" permission bucket is denied at dispatch
// until plan_exit is called. The gate itself lives in registry.go's
// ExecuteTool, so no individual tool needs plan-mode awareness.
func ExecutePlanEnter(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	if ctx.Plan == nil {
		state.Status = "error"
		state.Error = "Error: plan mode is not available in this session"
		return state
	}
	if ctx.Plan.IsActive() {
		state.Output = "Plan mode is already active."
		return state
	}
	ctx.Plan.Enter()
	state.Title = "Entered plan mode"
	state.TitleSet = true
	state.Output = "Plan mode is now active. You are in a READ-ONLY phase: " +
		"file edits, writes, and other mutating tools are disabled until you call plan_exit. " +
		"Explore, analyze, and present your plan; call plan_exit when you are ready to implement."
	return state
}

// ExecutePlanExit leaves plan mode, restoring normal tool access.
func ExecutePlanExit(ctx protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	if ctx.Plan == nil {
		state.Status = "error"
		state.Error = "Error: plan mode is not available in this session"
		return state
	}
	if !ctx.Plan.IsActive() {
		state.Output = "Plan mode was not active."
		return state
	}
	ctx.Plan.Exit()
	state.Title = "Exited plan mode"
	state.TitleSet = true
	state.Output = "Plan mode is now off. Mutating tools are available again - proceed with the implementation."
	return state
}
