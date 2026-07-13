package tools

import "github.com/TaskForceAI/core/pkg/enginecore/protocol"

func toolTask(_ protocol.ToolContext, args map[string]any) ToolResult {
	state := NewToolResult(args)
	parsed, missing := parseTaskArgs(args)
	if len(missing) > 0 {
		return invalidArgs("task", args, missing...)
	}
	_ = parsed.prompt
	_ = parsed.subagent
	sessionID := "ses_<id>"
	state.Output = "done\n\n<task_metadata>\nsession_id: " + sessionID + "\n</task_metadata>"
	state.Title = parsed.description
	state.TitleSet = true
	state.Metadata = map[string]any{
		"summary": []map[string]any{
			{
				"tool": "task",
				"state": map[string]any{
					"status": "error",
				},
			},
		},
		"sessionId": sessionID,
		"model": map[string]any{
			"providerID": protocol.DefaultProviderID,
			"modelID":    protocol.DefaultQualifiedModelID,
		},
		"truncated": false,
	}
	return state
}
