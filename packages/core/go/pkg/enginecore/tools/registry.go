package tools

import (
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/permissionpolicy"
	"github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"
)

func getString(args map[string]any, key string) string {
	return toolutil.GetString(args, key)
}

type toolHandler func(protocol.ToolContext, map[string]any) ToolResult

type toolRegistration struct {
	Permission string
	Metadata   func(map[string]any) map[string]any
	Handler    toolHandler
}

var toolRegistry = map[string]toolRegistration{
	"read":                editTool("read", toolRead),
	"write":               editTool("edit", toolWrite),
	"edit":                editTool("edit", toolEdit),
	"apply_patch":         editTool("edit", toolApplyPatch),
	"glob":                {Permission: "glob", Metadata: globMetadata, Handler: toolGlob},
	"grep":                grepTool(toolGrep),
	"codesearch":          grepTool(toolGrep),
	"question":            {Handler: toolQuestion},
	"task":                {Handler: toolTask},
	"todowrite":           {Handler: toolTodoWrite},
	"todoread":            {Handler: toolTodoRead},
	"webfetch":            {Permission: "net", Metadata: urlMetadata, Handler: toolWebFetch},
	"create_spreadsheet":  editTool("edit", toolCreateSpreadsheet),
	"create_document":     editTool("edit", toolCreateDocument),
	"create_presentation": editTool("edit", toolCreatePresentation),
	"create_archive":      editTool("edit", toolCreateArchive),
	"create_csv":          editTool("edit", toolCreateCSV),
	"create_pdf":          editTool("edit", toolCreatePDF),
	"create_chart":        editTool("edit", toolCreateChart),
	"create_site":         editTool("edit", toolCreateSite),
	"skill":               {Handler: toolSkill},
	"plan_enter":          {Handler: toolPlanEnter},
	"plan_exit":           {Handler: toolPlanExit},
	"invalid":             {Handler: toolInvalid},
}

func editTool(permission string, handler toolHandler) toolRegistration {
	return toolRegistration{Permission: permission, Metadata: filePathMetadata, Handler: handler}
}

func grepTool(handler toolHandler) toolRegistration {
	return toolRegistration{Permission: "grep", Metadata: grepMetadata, Handler: handler}
}

func ExecuteTool(ctx protocol.ToolContext, name string, args map[string]any) ToolResult {
	ctx = ensureContext(ctx)
	if err := checkContext(ctx); err != nil {
		return errorResult(args, "Error: "+err.Error())
	}

	entry, ok := toolRegistry[name]
	if !ok {
		return errorResult(args, "Error: tool not found: "+name)
	}
	if name == "codesearch" {
		args = normalizeCodeSearchArgs(args)
	}
	// Plan mode: every tool in the "edit" bucket is denied while active.
	// Gating here, at the single dispatch point, covers write/edit/
	// apply_patch/create_* without any per-tool changes.
	if ctx.Plan != nil && ctx.Plan.IsActive() && entry.Permission == "edit" {
		return errorResult(args, "Error: plan mode is active - "+name+" is disabled until plan_exit is called")
	}
	if entry.Permission != "" {
		if err := ask(ctx, entry.Permission, entry.Metadata(args)); err != nil {
			return errorResult(args, "Error: "+err.Error())
		}
	}
	return entry.Handler(ctx, args)
}

func normalizeCodeSearchArgs(args map[string]any) map[string]any {
	if getString(args, "pattern") != "" {
		return args
	}
	pattern := getString(args, "query")
	if pattern == "" {
		return args
	}
	args["pattern"] = pattern
	return args
}

func filePathMetadata(args map[string]any) map[string]any {
	return map[string]any{"filePath": getString(args, "filePath")}
}

func globMetadata(args map[string]any) map[string]any {
	return map[string]any{"pattern": getString(args, "pattern"), "path": getString(args, "path")}
}

func grepMetadata(args map[string]any) map[string]any {
	return map[string]any{"pattern": getString(args, "pattern"), "path": getString(args, "path")}
}

func urlMetadata(args map[string]any) map[string]any {
	return map[string]any{"url": getString(args, "url")}
}

func ask(ctx protocol.ToolContext, permission string, metadata map[string]any) error {
	return permissionpolicy.Ask(ctx, permission, metadata)
}
