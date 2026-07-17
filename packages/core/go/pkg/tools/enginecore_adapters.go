package tools

import (
	"context"
	"encoding/json"
	"path"
	"strings"

	"github.com/TaskForceAI/core/internal/runtimevalue"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	ectools "github.com/TaskForceAI/core/pkg/enginecore/tools"
	enginecoreutil "github.com/TaskForceAI/core/pkg/enginecore/util"
)

// GeneratedFileArtifactRequest describes generated-file metadata that needs
// concrete filesystem inspection outside core.
type GeneratedFileArtifactRequest struct {
	Cwd          string
	Filepath     string
	ToolName     string
	MimeType     string
	IncludeImage bool
}

// GeneratedFileArtifact is metadata attached to generated-file tool results.
type GeneratedFileArtifact struct {
	Filename    string
	Filepath    string
	MimeType    string
	Bytes       int64
	LocalPath   string
	ImageBase64 string
}

// EngineCoreToolRuntime supplies runtime filesystem details to the core tool adapter.
type EngineCoreToolRuntime interface {
	NewGeneratedFileWorkspace() string
	ResolveGeneratedFileArtifact(GeneratedFileArtifactRequest) (GeneratedFileArtifact, bool)
}

type emptyEngineCoreToolRuntime struct{}

func (emptyEngineCoreToolRuntime) NewGeneratedFileWorkspace() string {
	return ""
}

func (emptyEngineCoreToolRuntime) ResolveGeneratedFileArtifact(GeneratedFileArtifactRequest) (GeneratedFileArtifact, bool) {
	return GeneratedFileArtifact{}, false
}

var engineCoreToolRuntimes = runtimevalue.New[EngineCoreToolRuntime](emptyEngineCoreToolRuntime{})

// SetEngineCoreToolRuntime installs the outer runtime used by enginecore tool adapters.
func SetEngineCoreToolRuntime(runtime EngineCoreToolRuntime) func() {
	return engineCoreToolRuntimes.Set(runtime)
}

func currentEngineCoreToolRuntime() EngineCoreToolRuntime {
	return engineCoreToolRuntimes.Current()
}

// EngineCoreTool adapts an enginecore tool function to the ITool interface.
type EngineCoreTool struct {
	base    BaseTool
	toolCtx *protocol.ToolContext
	exec    func(protocol.ToolContext, map[string]any) ectools.ToolResult
}

func newEngineCoreTool(
	name, description string,
	parameters ToolParameters,
	toolCtx *protocol.ToolContext,
	exec func(protocol.ToolContext, map[string]any) ectools.ToolResult,
) *EngineCoreTool {
	return &EngineCoreTool{
		base:    BaseTool{name: name, description: description, parameters: parameters},
		toolCtx: toolCtx,
		exec:    exec,
	}
}

func (t *EngineCoreTool) Name() string               { return t.base.Name() }
func (t *EngineCoreTool) Description() string        { return t.base.Description() }
func (t *EngineCoreTool) Parameters() ToolParameters { return t.base.Parameters() }
func (t *EngineCoreTool) ToGatewaySchema() any       { return t.base.ToGatewaySchema() }

func (t *EngineCoreTool) Execute(ctx context.Context, args string) (ToolResult, error) {
	parsed, parseErr := parseJSONArgs(args)
	if parseErr != "" {
		return ToolResult{"error": parseErr, "success": false}, nil
	}
	execCtx := buildExecutionContext(t.toolCtx, ctx)
	r := t.exec(execCtx, parsed)
	out := convertResult(r)
	augmentGeneratedFileResult(out, t.Name(), execCtx.Cwd)
	return out, nil
}

func parseJSONArgs(args string) (map[string]any, string) {
	var parsed map[string]any
	if err := json.Unmarshal([]byte(args), &parsed); err != nil {
		return nil, "invalid JSON arguments: " + err.Error()
	}
	return parsed, ""
}

func convertResult(r ectools.ToolResult) ToolResult {
	out := ToolResult{}
	if r.Error != "" {
		out["error"] = r.Error
	}
	if r.Output != "" {
		out["content"] = r.Output
	}
	if r.Title != "" {
		out["title"] = r.Title
	}
	if r.Metadata != nil {
		out["metadata"] = r.Metadata
	}
	if r.Attachments != nil {
		out["attachments"] = r.Attachments
	}
	out["success"] = r.Status != "error"
	return out
}

func augmentGeneratedFileResult(result ToolResult, toolName string, cwd string) {
	if result == nil || result["success"] != true || !isGeneratedFileTool(toolName) {
		return
	}
	filePath := generatedFilePathFromResult(result)
	if filePath == "" {
		return
	}
	mimeType := generatedFileMimeType(filePath)
	artifact, ok := currentEngineCoreToolRuntime().ResolveGeneratedFileArtifact(GeneratedFileArtifactRequest{
		Cwd:          cwd,
		Filepath:     filePath,
		ToolName:     toolName,
		MimeType:     mimeType,
		IncludeImage: toolName == "create_chart" && mimeType == "image/png",
	})
	if !ok {
		return
	}
	if artifact.Filename == "" {
		artifact.Filename = generatedFileBase(filePath)
	}
	if artifact.Filepath == "" {
		artifact.Filepath = filePath
	}
	if artifact.MimeType == "" {
		artifact.MimeType = mimeType
	}
	file := map[string]any{
		"filename":   artifact.Filename,
		"filepath":   artifact.Filepath,
		"mime_type":  artifact.MimeType,
		"bytes":      artifact.Bytes,
		"local_path": artifact.LocalPath,
	}
	result["generated_file"] = file
	metadata, ok := result["metadata"].(map[string]any)
	if !ok || metadata == nil {
		metadata = map[string]any{}
		result["metadata"] = metadata
	}
	metadata["generated_file"] = file
	if _, ok := metadata["filepath"]; !ok {
		metadata["filepath"] = filePath
	}

	if artifact.ImageBase64 != "" {
		result["image_base64"] = artifact.ImageBase64
	}
}

func isGeneratedFileTool(toolName string) bool {
	switch toolName {
	case "create_spreadsheet", "create_document", "create_presentation", "create_archive", "create_csv", "create_pdf", "create_chart", "create_site":
		return true
	default:
		return false
	}
}

func generatedFilePathFromResult(result ToolResult) string {
	if metadata, ok := result["metadata"].(map[string]any); ok {
		for _, key := range []string{"filepath", "filePath"} {
			if value, ok := metadata[key].(string); ok {
				if clean := cleanGeneratedFilePath(value); clean != "" {
					return clean
				}
			}
		}
	}
	if title, ok := result["title"].(string); ok {
		return cleanGeneratedFilePath(title)
	}
	return ""
}

func cleanGeneratedFilePath(value string) string {
	if value == "" || value != strings.TrimSpace(value) || strings.ContainsRune(value, 0) {
		return ""
	}
	normalized := strings.ReplaceAll(value, "\\", "/")
	if strings.HasPrefix(normalized, "/") {
		return ""
	}
	clean := path.Clean(normalized)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return ""
	}
	return clean
}

func generatedFileMimeType(filePath string) string {
	switch strings.ToLower(path.Ext(strings.ReplaceAll(filePath, "\\", "/"))) {
	case ".csv":
		return "text/csv"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".html", ".htm":
		return "text/html"
	case ".pdf":
		return "application/pdf"
	case ".png":
		return "image/png"
	case ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case ".svg":
		return "image/svg+xml"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".zip":
		return "application/zip"
	default:
		return "application/octet-stream"
	}
}

func generatedFileBase(filePath string) string {
	return path.Base(strings.ReplaceAll(filePath, "\\", "/"))
}

func buildExecutionContext(base *protocol.ToolContext, callCtx context.Context) protocol.ToolContext {
	var out protocol.ToolContext
	if base != nil {
		out = *base
	}
	if callCtx != nil {
		out.Ctx = callCtx
	} else if out.Ctx == nil {
		out.Ctx = context.Background()
	}
	if out.Cwd == "" {
		out.Cwd = enginecoreutil.Worktree()
	}
	if out.ReadFiles == nil {
		out.ReadFiles = map[string]bool{}
	} else {
		readFiles := make(map[string]bool, len(out.ReadFiles))
		for path, read := range out.ReadFiles {
			readFiles[path] = read
		}
		out.ReadFiles = readFiles
	}
	return out
}

// NewEngineCoreToolContext creates a shared ToolContext for all enginecore adapters.
func NewEngineCoreToolContext() *protocol.ToolContext {
	return &protocol.ToolContext{
		Ctx:       context.Background(),
		Cwd:       enginecoreutil.Worktree(),
		ReadFiles: map[string]bool{},
	}
}

// NewEngineCoreGeneratedFileToolContext creates a sandboxed local workspace for
// generated artifacts in environments where broad local file tools are disabled.
func NewEngineCoreGeneratedFileToolContext() *protocol.ToolContext {
	dir := currentEngineCoreToolRuntime().NewGeneratedFileWorkspace()
	if dir == "" {
		dir = enginecoreutil.Worktree()
	}
	return &protocol.ToolContext{
		Ctx:       context.Background(),
		Cwd:       dir,
		ReadFiles: map[string]bool{},
	}
}

func CreateEngineCoreReadTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"read", "Read the contents of a file from the file system.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"filePath": map[string]any{
					"type":        "string",
					"description": "The file path to read (relative to working directory)",
				},
				"offset": map[string]any{
					"type":        "integer",
					"description": "Line offset to start reading from (0-based)",
				},
				"limit": map[string]any{
					"type":        "integer",
					"description": "Maximum number of lines to read (default 2000)",
				},
			},
			Required: []string{"filePath"},
		}, toolCtx, ectools.ToolRead)
}

func CreateEngineCoreWriteTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"write", "Create a new file or overwrite an existing file with new content.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"filePath": map[string]any{
					"type":        "string",
					"description": "The file path to write to (relative to working directory)",
				},
				"content": map[string]any{
					"type":        "string",
					"description": "The content to write to the file",
				},
			},
			Required: []string{"filePath", "content"},
		}, toolCtx, ectools.ToolWrite)
}

func CreateEngineCoreSpreadsheetTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"create_spreadsheet", "Create a downloadable Excel .xlsx spreadsheet file with one or more sheets and rows. Use when the user asks for an Excel, XLSX, spreadsheet, or workbook file.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"filePath": map[string]any{
					"type":        "string",
					"description": "The .xlsx file path to create (relative to working directory)",
				},
				"sheets": map[string]any{
					"type":        "array",
					"description": "Sheets to create. Each sheet has a name and rows array.",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"name": map[string]any{"type": "string"},
							"rows": map[string]any{
								"type":        "array",
								"description": "Rows of cell values.",
								"items":       map[string]any{"type": "array", "items": map[string]any{}},
							},
						},
					},
				},
			},
			Required: []string{"filePath", "sheets"},
		}, toolCtx, ectools.ToolCreateSpreadsheet)
}

func sectionedFileParameters(fileDescription, sectionsDescription, titleDescription string) ToolParameters {
	return ToolParameters{
		Type: "object",
		Properties: map[string]any{
			"filePath": map[string]any{"type": "string", "description": fileDescription},
			"title":    map[string]any{"type": "string", "description": titleDescription},
			"sections": map[string]any{
				"type":        "array",
				"description": sectionsDescription,
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"heading": map[string]any{"type": "string"},
						"content": map[string]any{"type": "string"},
					},
				},
			},
		},
		Required: []string{"filePath", "sections"},
	}
}

func CreateEngineCoreDocumentTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"create_document", "Create a downloadable Word .docx document with a title and sections. Use when the user asks for a Word, DOCX, or document file.",
		sectionedFileParameters("The .docx file path to create (relative to working directory)", "Document sections with heading and content.", "Optional document title"),
		toolCtx, ectools.ToolCreateDocument,
	)
}

func CreateEngineCorePresentationTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"create_presentation", "Create a downloadable PowerPoint .pptx presentation with title and body slides. Use when the user asks for PowerPoint, PPTX, slides, or a presentation file.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"filePath": map[string]any{
					"type":        "string",
					"description": "The .pptx file path to create (relative to working directory)",
				},
				"slides": map[string]any{
					"type":        "array",
					"description": "Slides with title and body text.",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"title": map[string]any{"type": "string"},
							"body":  map[string]any{"type": "string"},
						},
					},
				},
			},
			Required: []string{"filePath", "slides"},
		}, toolCtx, ectools.ToolCreatePresentation)
}

func CreateEngineCoreArchiveTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"create_archive", "Create a downloadable ZIP archive containing files from the working directory. Use when the user asks for a zip file, archive, or bundled files.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"filePath": map[string]any{
					"type":        "string",
					"description": "The .zip file path to create (relative to working directory)",
				},
				"files": map[string]any{
					"type":        "array",
					"description": "File paths to include in the archive.",
					"items":       map[string]any{"type": "string"},
				},
			},
			Required: []string{"filePath", "files"},
		}, toolCtx, ectools.ToolCreateArchive)
}

func CreateEngineCoreCSVTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"create_csv", "Create a downloadable CSV file from rows of values. Use when the user asks for CSV, tabular data as a file, or a lightweight spreadsheet export.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"filePath": map[string]any{
					"type":        "string",
					"description": "The .csv file path to create (relative to working directory)",
				},
				"rows": map[string]any{
					"type":        "array",
					"description": "Rows of cell values. Output is streamed and capped to prevent oversized files.",
					"maxItems":    ectools.MaxCSVRows,
					"items": map[string]any{
						"type":     "array",
						"maxItems": ectools.MaxCSVColumns,
						"items":    map[string]any{},
					},
				},
			},
			Required: []string{"filePath", "rows"},
		}, toolCtx, ectools.ToolCreateCSV)
}

func CreateEngineCorePDFTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"create_pdf", "Create a downloadable PDF file with a title and sections. Use when the user asks for a PDF report, printable document, or .pdf file.",
		sectionedFileParameters("The .pdf file path to create (relative to working directory)", "PDF sections with heading and content.", "Optional PDF title"),
		toolCtx, ectools.ToolCreatePDF,
	)
}

func CreateEngineCoreChartTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"create_chart", "Create a downloadable PNG or SVG chart file from labeled numeric data. Use when the user asks for a chart, graph, PNG chart image, or SVG chart file.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"filePath": map[string]any{
					"type":        "string",
					"description": "The .png or .svg file path to create (relative to working directory)",
				},
				"type": map[string]any{
					"type":        "string",
					"enum":        []string{"bar", "pie"},
					"description": "Chart type. Defaults to bar when omitted or unrecognized.",
				},
				"title": map[string]any{
					"type":        "string",
					"description": "Optional chart title",
				},
				"data": map[string]any{
					"type":        "array",
					"description": "Labeled numeric values to plot.",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"label": map[string]any{"type": "string"},
							"value": map[string]any{"type": "number"},
						},
						"required": []string{"label", "value"},
					},
				},
			},
			Required: []string{"filePath", "data"},
		}, toolCtx, ectools.ToolCreateChart)
}

func CreateEngineCoreSiteTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"create_site", "Create a downloadable, previewable HTML site or lightweight app. Use when the user asks for an interactive website, dashboard, planner, review workspace, project board, gallery, or lightweight tool.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"filePath": map[string]any{
					"type":        "string",
					"description": "The .html or .htm file path to create (relative to working directory)",
				},
				"title": map[string]any{
					"type":        "string",
					"description": "Optional site title",
				},
				"html": map[string]any{
					"type":        "string",
					"description": "Complete standalone HTML document, including CSS and JavaScript needed for the interactive site.",
				},
			},
			Required: []string{"filePath", "html"},
		}, toolCtx, ectools.ToolCreateSite)
}

func CreateEngineCoreEditTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"edit", "Edit a file by replacing an exact string match with new content.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"filePath": map[string]any{
					"type":        "string",
					"description": "The file path to edit (relative to working directory)",
				},
				"oldString": map[string]any{
					"type":        "string",
					"description": "The exact string to find and replace",
				},
				"newString": map[string]any{
					"type":        "string",
					"description": "The replacement string",
				},
			},
			Required: []string{"filePath", "oldString", "newString"},
		}, toolCtx, ectools.ToolEdit)
}

func CreateEngineCoreApplyPatchTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"apply_patch", "Apply a multi-file patch (add, delete, update, or rename files) in a single call using the Begin/End Patch envelope format.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"patch": map[string]any{
					"type":        "string",
					"description": "The full patch text, wrapped in *** Begin Patch / *** End Patch.",
				},
			},
			Required: []string{"patch"},
		}, toolCtx, ectools.ToolApplyPatch)
}

func CreateEngineCoreGlobTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"glob", "Find files matching a glob pattern.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"pattern": map[string]any{
					"type":        "string",
					"description": "The glob pattern to match files against",
				},
				"path": map[string]any{
					"type":        "string",
					"description": "Directory to search in (relative to working directory)",
				},
			},
			Required: []string{"pattern"},
		}, toolCtx, ectools.ToolGlob)
}

func CreateEngineCoreGrepTool(toolCtx *protocol.ToolContext) ITool {
	return newEngineCoreTool(
		"grep", "Search file contents using a regular expression pattern.", ToolParameters{
			Type: "object",
			Properties: map[string]any{
				"pattern": map[string]any{
					"type":        "string",
					"description": "The regular expression pattern to search for",
				},
				"path": map[string]any{
					"type":        "string",
					"description": "Directory to search in (relative to working directory)",
				},
				"include": map[string]any{
					"type":        "string",
					"description": "Glob pattern to filter which files to search",
				},
			},
			Required: []string{"pattern"},
		}, toolCtx, ectools.ToolGrep)
}
