package tools

import "github.com/TaskForceAI/core/pkg/enginecore/protocol"

// Exported wrappers for use by the ITool adapter layer.

func runExportedTool(ctx protocol.ToolContext, args map[string]any, handler toolHandler) ToolResult {
	ctx = ensureContext(ctx)
	if err := checkContext(ctx); err != nil {
		return errorResult(args, "Error: "+err.Error())
	}
	return handler(ctx, args)
}

func ToolRead(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolRead)
}
func ToolWrite(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolWrite)
}
func ToolEdit(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolEdit)
}
func ToolGlob(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolGlob)
}
func ToolGrep(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolGrep)
}
func ToolCreateSpreadsheet(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolCreateSpreadsheet)
}
func ToolCreateDocument(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolCreateDocument)
}
func ToolCreatePresentation(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolCreatePresentation)
}
func ToolCreateArchive(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolCreateArchive)
}
func ToolCreateCSV(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolCreateCSV)
}
func ToolCreatePDF(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolCreatePDF)
}
func ToolCreateChart(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolCreateChart)
}
func ToolCreateSite(ctx protocol.ToolContext, args map[string]any) ToolResult {
	return runExportedTool(ctx, args, toolCreateSite)
}
