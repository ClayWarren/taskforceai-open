package tools

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

type ToolResult = protocol.ToolResult

func NewToolResult(args map[string]any) ToolResult {
	return toolutil.NewResult(args)
}

func errorResult(args map[string]any, msg string) ToolResult {
	return toolutil.ErrorResult(args, msg)
}

func ensureContext(ctx protocol.ToolContext) protocol.ToolContext {
	return toolutil.EnsureContext(ctx)
}

func checkContext(ctx protocol.ToolContext) error {
	return toolutil.CheckContext(ctx)
}
