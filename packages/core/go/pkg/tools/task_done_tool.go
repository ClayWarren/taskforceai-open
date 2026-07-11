package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

type TaskDoneArgs struct {
	TaskSummary       string `json:"task_summary" validate:"required"`
	CompletionMessage string `json:"completion_message" validate:"required"`
}

func CreateTaskDoneTool() ITool {
	params := ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"task_summary": map[string]any{
				"type":        "string",
				"description": "Brief summary of what was accomplished",
			},
			"completion_message": map[string]any{
				"type":        "string",
				"description": "Message to show the user indicating the task is complete",
			},
		},
		Required: []string{"task_summary", "completion_message"},
	}

	return NewBaseTool(
		"mark_task_complete",
		"REQUIRED: Call this tool when the user's original request has been fully satisfied and you have provided a complete answer. This signals task completion and exits the agent loop.",
		params,
		func(ctx context.Context, args string) (ToolResult, error) {
			var input TaskDoneArgs
			if err := json.Unmarshal([]byte(args), &input); err != nil {
				return nil, err
			}
			if err := util.ValidateStruct(&input); err != nil {
				return nil, fmt.Errorf("invalid arguments: %w", err)
			}
			return ToolResult{
				"status":             "completed",
				"task_summary":       input.TaskSummary,
				"completion_message": input.CompletionMessage,
				"timestamp":          time.Now().Format(time.RFC3339),
			}, nil
		},
	)
}
