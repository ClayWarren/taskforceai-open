package tools

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/filesystem"
)

func toolRead(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return filesystem.ExecuteRead(ctx, args)
}

func toolWrite(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return filesystem.ExecuteWrite(ctx, args)
}

func toolEdit(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return filesystem.ExecuteEdit(ctx, args)
}

func toolGlob(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return filesystem.ExecuteGlob(ctx, args)
}

func toolGrep(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return filesystem.ExecuteGrep(ctx, args)
}
