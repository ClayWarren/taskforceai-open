package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/enginecore/skill"
	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
)

type skillToolArgs struct {
	Name string `json:"name"`
}

// CreateSkillTool loads a named SKILL.md skill (discovered under the
// project's .taskforceai/skills directory) and returns its instructions for
// injection into the conversation. Mirrors opencode's dump-the-file
// simplicity rather than codex's catalog/budget protocol.
func CreateSkillTool(workdir func() string) ITool {
	if workdir == nil {
		workdir = enginecoreutil.Worktree
	}
	params := ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"name": map[string]any{
				"type":        "string",
				"description": "The skill name, matching one listed in the system prompt",
			},
		},
		Required: []string{"name"},
	}
	return NewBaseTool(
		"skill",
		"Load a specialized skill when the task at hand matches one of the skills listed in the system prompt.",
		params,
		func(ctx context.Context, args string) (ToolResult, error) {
			var input skillToolArgs
			if err := json.Unmarshal([]byte(args), &input); err != nil {
				return nil, fmt.Errorf("invalid JSON arguments: %w", err)
			}
			cwd := workdir()
			body, err := skill.Load(cwd, input.Name)
			if err != nil {
				msg := err.Error()
				if available := skill.FormatAvailable(skill.Discover(cwd)); available != "" {
					msg += "\n\n" + available
				}
				return ToolResult{"success": false, "error": msg}, nil
			}
			name := strings.TrimSpace(input.Name)
			return ToolResult{
				"success": true,
				"title":   name,
				"content": "<skill_content name=\"" + name + "\">\n" + body + "\n</skill_content>",
			}, nil
		},
	)
}
