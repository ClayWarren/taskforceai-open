package tools

import (
	"net/url"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

func getString(args map[string]any, key string) string {
	if args == nil {
		return ""
	}
	if v, ok := args[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
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
	if ctx.Permission == nil {
		return nil
	}
	return ctx.Permission.Ask(protocol.PermissionRequest{
		Permission: permission,
		Patterns:   permissionPatterns(metadata),
		Always:     []string{"*"},
		Metadata:   metadata,
	})
}

func permissionPatterns(metadata map[string]any) []string {
	if path := metadataString(metadata, "filePath"); path != "" {
		return []string{path}
	}
	if path := metadataString(metadata, "path"); path != "" {
		return []string{path}
	}
	if pattern := metadataString(metadata, "pattern"); pattern != "" {
		return []string{pattern}
	}

	rawURL := metadataString(metadata, "url")
	if rawURL == "" {
		return nil
	}

	patterns := []string{rawURL}
	if parsed, err := url.Parse(rawURL); err == nil {
		if host := parsed.Hostname(); host != "" {
			patterns = append(patterns, host)
		}
	}

	return patterns
}

func metadataString(metadata map[string]any, key string) string {
	raw, ok := metadata[key]
	if !ok {
		return ""
	}

	value, ok := raw.(string)
	if !ok || value == "" {
		return ""
	}

	return value
}
