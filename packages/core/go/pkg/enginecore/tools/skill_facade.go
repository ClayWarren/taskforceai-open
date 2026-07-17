package tools

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/skill"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

func toolSkill(ctx protocol.ToolContext, args map[string]any) ToolResult {
	state := toolutil.NewResult(args)
	name := getString(args, "name")
	if name == "" {
		return toolutil.InvalidArgs("skill", args, "missing name")
	}
	body, err := skill.Load(ctx.Cwd, name)
	if err != nil {
		state.Status = "error"
		state.Error = "Error: " + err.Error()
		if available := skill.FormatAvailable(skill.Discover(ctx.Cwd)); available != "" {
			state.Error += "\n\n" + available
		}
		return state
	}
	state.Title = name
	state.TitleSet = true
	state.Output = "<skill_content name=\"" + name + "\">\n" + body + "\n</skill_content>"
	return state
}
