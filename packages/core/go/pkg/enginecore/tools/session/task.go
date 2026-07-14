package session

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

func ExecuteTask(_ protocol.ToolContext, args map[string]any) protocol.ToolResult {
	state := toolutil.NewResult(args)
	parsed, missing := parseTaskArgs(args)
	if len(missing) > 0 {
		return toolutil.InvalidArgs("task", args, missing...)
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
