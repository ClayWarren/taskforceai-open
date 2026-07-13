package tools

import (
	"context"
	"strings"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/util"
)

type ToolResult struct {
	Status      string
	Input       map[string]any
	Output      string
	Title       string
	TitleSet    bool
	Metadata    map[string]any
	Attachments []map[string]any
	Error       string
}

func NewToolResult(args map[string]any) ToolResult {
	if args == nil {
		args = map[string]any{}
	}
	return ToolResult{
		Status: "completed",
		Input:  args,
	}
}

func errorResult(args map[string]any, msg string) ToolResult {
	res := NewToolResult(args)
	res.Status = "error"
	res.Error = msg
	return res
}

func invalidArgs(tool string, args map[string]any, details ...string) ToolResult {
	msg := "Error: " + tool + ": invalid arguments"
	if len(details) > 0 {
		msg += " (" + strings.Join(details, ", ") + ")"
	}
	return errorResult(args, msg)
}

func ensureContext(ctx protocol.ToolContext) protocol.ToolContext {
	if ctx.Ctx == nil {
		ctx.Ctx = context.Background()
	}
	if strings.TrimSpace(ctx.Cwd) == "" {
		ctx.Cwd = util.Worktree()
	}
	if ctx.ReadFiles == nil {
		ctx.ReadFiles = map[string]bool{}
	}
	return ctx
}

func checkContext(ctx protocol.ToolContext) error {
	return ctx.Ctx.Err()
}
