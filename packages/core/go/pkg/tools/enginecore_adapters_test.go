package tools

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	ectools "github.com/TaskForceAI/core/pkg/enginecore/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type adapterChartWriter struct{}

func (adapterChartWriter) WriteChart(_ context.Context, request ectools.ChartWriteRequest) error {
	if err := os.MkdirAll(filepath.Dir(request.Path), 0o750); err != nil {
		return err
	}
	return os.WriteFile(request.Path, request.Content, 0o600)
}

type fakeEngineCoreToolRuntime struct {
	workspace string
	artifact  GeneratedFileArtifact
	ok        bool
	requests  []GeneratedFileArtifactRequest
	resolve   func(GeneratedFileArtifactRequest) (GeneratedFileArtifact, bool)
}

func (r *fakeEngineCoreToolRuntime) NewGeneratedFileWorkspace() string {
	return r.workspace
}

func (r *fakeEngineCoreToolRuntime) ResolveGeneratedFileArtifact(request GeneratedFileArtifactRequest) (GeneratedFileArtifact, bool) {
	r.requests = append(r.requests, request)
	if r.resolve != nil {
		return r.resolve(request)
	}
	return r.artifact, r.ok
}

func useEngineCoreToolRuntime(t *testing.T, runtime EngineCoreToolRuntime) {
	t.Helper()
	restore := SetEngineCoreToolRuntime(runtime)
	t.Cleanup(restore)
}

func TestEngineCoreAdapters(t *testing.T) {
	ctx := NewEngineCoreToolContext()
	assert.NotEmpty(t, ctx.Cwd)
	assert.NotNil(t, ctx.Ctx)

	tools := []ITool{
		CreateEngineCoreReadTool(ctx),
		CreateEngineCoreWriteTool(ctx),
		CreateEngineCoreEditTool(ctx),
		CreateEngineCoreApplyPatchTool(ctx),
		CreateEngineCoreGlobTool(ctx),
		CreateEngineCoreGrepTool(ctx),
	}

	for _, tool := range tools {
		assert.NotEmpty(t, tool.Name())
		assert.NotEmpty(t, tool.Description())
		assert.NotNil(t, tool.Parameters())

		schema := tool.ToGatewaySchema()
		assert.NotNil(t, schema)

		res, err := tool.Execute(context.Background(), "invalid-json")
		require.NoError(t, err)
		success, ok := res["success"].(bool)
		assert.True(t, ok)
		assert.False(t, success)
		errStr, errOk := res["error"].(string)
		assert.True(t, errOk)
		assert.Contains(t, errStr, "invalid JSON")
	}
}

func TestEngineCoreAdapters_GlobExecute_DoesNotPanicWithDefaultContext(t *testing.T) {
	registry := DiscoverTools(config.Config{}, nil, nil, nil, true)
	globTool, ok := registry.Get("glob")
	assert.True(t, ok)

	res, err := globTool.Execute(context.Background(), `{"pattern":"*.go","path":"pkg/tools"}`)
	require.NoError(t, err)
	_, hasSuccess := res["success"].(bool)
	assert.True(t, hasSuccess)
}

func TestDiscoverTools_GeneratedFileToolWorksWithoutLocalFileTools(t *testing.T) {
	restoreChartWriter := ectools.SetChartWriter(adapterChartWriter{})
	t.Cleanup(restoreChartWriter)
	workspace := t.TempDir()
	useEngineCoreToolRuntime(t, &fakeEngineCoreToolRuntime{
		workspace: workspace,
		resolve: func(request GeneratedFileArtifactRequest) (GeneratedFileArtifact, bool) {
			fullPath := filepath.Join(request.Cwd, request.Filepath)
			info, err := os.Stat(fullPath)
			if err != nil || info.IsDir() {
				return GeneratedFileArtifact{}, false
			}
			artifact := GeneratedFileArtifact{
				Filename:  filepath.Base(request.Filepath),
				Filepath:  request.Filepath,
				MimeType:  request.MimeType,
				Bytes:     info.Size(),
				LocalPath: fullPath,
			}
			if request.IncludeImage {
				data, err := os.ReadFile(fullPath)
				if err == nil {
					artifact.ImageBase64 = base64.StdEncoding.EncodeToString(data)
				}
			}
			return artifact, true
		},
	})

	registry := DiscoverTools(config.Config{}, nil, nil, nil, false)
	chartTool, ok := registry.Get("create_chart")
	assert.True(t, ok)

	res, err := chartTool.Execute(context.Background(), `{"filePath":"adapter-chart.png","type":"bar","data":[{"label":"A","value":1},{"label":"B","value":2}]}`)
	require.NoError(t, err)
	assert.Equal(t, true, res["success"])
	assert.Equal(t, "adapter-chart.png", res["title"])
	generatedFile, ok := res["generated_file"].(map[string]any)
	assert.True(t, ok)
	assert.Equal(t, "adapter-chart.png", generatedFile["filename"])
	assert.Equal(t, "image/png", generatedFile["mime_type"])
	assert.NotEmpty(t, res["image_base64"])
	localPath, ok := generatedFile["local_path"].(string)
	require.True(t, ok)
	assert.FileExists(t, localPath)
	assert.Contains(t, localPath, workspace)
}

func TestEngineCoreToolAugmentsGeneratedFileFromMetadataPath(t *testing.T) {
	dir := t.TempDir()
	filePath := "exports/report.xlsx"
	fullPath := filepath.Join(dir, "resolved", "report.xlsx")
	runtime := &fakeEngineCoreToolRuntime{
		artifact: GeneratedFileArtifact{
			Filename:  "report.xlsx",
			Filepath:  filePath,
			MimeType:  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			Bytes:     int64(len("xlsx bytes")),
			LocalPath: fullPath,
		},
		ok: true,
	}
	useEngineCoreToolRuntime(t, runtime)

	adapter := newEngineCoreTool(
		"create_spreadsheet", "", ToolParameters{}, &protocol.ToolContext{Cwd: dir},
		func(ctx protocol.ToolContext, args map[string]any) ectools.ToolResult {
			return ectools.ToolResult{
				Status:   "completed",
				Metadata: map[string]any{"filePath": filePath},
			}
		},
	)

	res, err := adapter.Execute(context.Background(), `{}`)
	require.NoError(t, err)
	assert.Equal(t, true, res["success"])

	generatedFile, ok := res["generated_file"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "report.xlsx", generatedFile["filename"])
	assert.Equal(t, filePath, generatedFile["filepath"])
	assert.Equal(t, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", generatedFile["mime_type"])
	assert.EqualValues(t, len("xlsx bytes"), generatedFile["bytes"])
	assert.Equal(t, fullPath, generatedFile["local_path"])
	require.Len(t, runtime.requests, 1)
	assert.Equal(t, dir, runtime.requests[0].Cwd)
	assert.Equal(t, filePath, runtime.requests[0].Filepath)
	assert.Equal(t, "create_spreadsheet", runtime.requests[0].ToolName)
	assert.Equal(t, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", runtime.requests[0].MimeType)

	metadata, ok := res["metadata"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, filePath, metadata["filepath"])
	assert.Equal(t, generatedFile, metadata["generated_file"])
}

func TestEngineCoreToolRejectsUnsafeGeneratedFileMetadataPath(t *testing.T) {
	dir := t.TempDir()
	runtime := &fakeEngineCoreToolRuntime{artifact: GeneratedFileArtifact{Filename: "x.csv"}, ok: true}
	useEngineCoreToolRuntime(t, runtime)

	tests := []struct {
		name     string
		filePath string
	}{
		{name: "leading whitespace absolute path", filePath: " /tmp/secret.csv"},
		{name: "trailing whitespace path", filePath: "report.csv "},
		{name: "absolute path", filePath: "/tmp/secret.csv"},
		{name: "parent traversal", filePath: "../secret.csv"},
		{name: "windows parent traversal", filePath: `..\secret.csv`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			adapter := newEngineCoreTool(
				"create_csv", "", ToolParameters{}, &protocol.ToolContext{Cwd: dir},
				func(ctx protocol.ToolContext, args map[string]any) ectools.ToolResult {
					return ectools.ToolResult{
						Status:   "completed",
						Metadata: map[string]any{"filepath": tt.filePath},
					}
				},
			)

			res, err := adapter.Execute(context.Background(), `{}`)
			require.NoError(t, err)
			assert.Equal(t, true, res["success"])
			assert.NotContains(t, res, "generated_file")
		})
	}
	assert.Empty(t, runtime.requests)
}

func TestEngineCoreToolSkipsGeneratedFileWhenRuntimeRejects(t *testing.T) {
	dir := t.TempDir()
	runtime := &fakeEngineCoreToolRuntime{}
	useEngineCoreToolRuntime(t, runtime)

	adapter := newEngineCoreTool(
		"create_csv", "", ToolParameters{}, &protocol.ToolContext{Cwd: dir},
		func(ctx protocol.ToolContext, args map[string]any) ectools.ToolResult {
			return ectools.ToolResult{
				Status:   "completed",
				Metadata: map[string]any{"filepath": "export.csv"},
			}
		},
	)

	res, err := adapter.Execute(context.Background(), `{}`)
	require.NoError(t, err)
	assert.Equal(t, true, res["success"])
	assert.NotContains(t, res, "generated_file")
	require.Len(t, runtime.requests, 1)
	assert.Equal(t, "export.csv", runtime.requests[0].Filepath)
}

func TestNewEngineCoreGeneratedFileToolContextCreatesIsolatedWorkspace(t *testing.T) {
	workspace := t.TempDir()
	useEngineCoreToolRuntime(t, &fakeEngineCoreToolRuntime{workspace: workspace})

	ctx := NewEngineCoreGeneratedFileToolContext()

	require.NotNil(t, ctx)
	assert.NotNil(t, ctx.Ctx)
	assert.NotNil(t, ctx.ReadFiles)
	assert.Equal(t, workspace, ctx.Cwd)
}

func TestGeneratedFileAdapterUsesRuntimeDefaults(t *testing.T) {
	result := ToolResult{"success": true, "metadata": map[string]any{"filepath": "report.csv"}}
	augmentGeneratedFileResult(result, "create_csv", ".")
	assert.NotContains(t, result, "generated_file")

	ctx := NewEngineCoreGeneratedFileToolContext()
	assert.NotEmpty(t, ctx.Cwd)
}

func TestEngineCoreToolRuntimeAndGeneratedFileDefaultEdges(t *testing.T) {
	restore := SetEngineCoreToolRuntime(nil)
	t.Cleanup(restore)
	assert.IsType(t, emptyEngineCoreToolRuntime{}, currentEngineCoreToolRuntime())

	runtime := &fakeEngineCoreToolRuntime{artifact: GeneratedFileArtifact{Bytes: 42}, ok: true}
	restoreRuntime := SetEngineCoreToolRuntime(runtime)
	t.Cleanup(restoreRuntime)

	result := ToolResult{"success": true, "metadata": map[string]any{"filepath": "dir/report.csv"}}
	augmentGeneratedFileResult(result, "create_csv", ".")

	generatedFile, ok := result["generated_file"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "report.csv", generatedFile["filename"])
	assert.Equal(t, "dir/report.csv", generatedFile["filepath"])
	assert.Equal(t, "text/csv", generatedFile["mime_type"])
	assert.Equal(t, "report.csv", generatedFileBase(`dir\report.csv`))
}

func TestGeneratedFilePathAndMimeTypeHelpers(t *testing.T) {
	assert.Equal(t, "from-metadata.csv", generatedFilePathFromResult(ToolResult{
		"metadata": map[string]any{"filepath": "from-metadata.csv"},
		"title":    "from-title.pdf",
	}))
	assert.Equal(t, "from-camel.docx", generatedFilePathFromResult(ToolResult{
		"metadata": map[string]any{"filePath": "from-camel.docx"},
	}))
	assert.Equal(t, "from-title.pdf", generatedFilePathFromResult(ToolResult{"title": "from-title.pdf"}))
	assert.Empty(t, generatedFilePathFromResult(ToolResult{"metadata": map[string]any{"filepath": " "}}))
	assert.Empty(t, generatedFilePathFromResult(ToolResult{"metadata": map[string]any{"filepath": " from-metadata.csv "}}))
	assert.Empty(t, generatedFilePathFromResult(ToolResult{"metadata": map[string]any{"filepath": "/etc/passwd"}}))
	assert.Empty(t, generatedFilePathFromResult(ToolResult{"metadata": map[string]any{"filepath": "../secret.csv"}}))

	cases := map[string]string{
		"data.csv":      "text/csv",
		"brief.docx":    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"index.html":    "text/html",
		"index.htm":     "text/html",
		"report.pdf":    "application/pdf",
		"chart.png":     "image/png",
		"slides.pptx":   "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		"diagram.svg":   "image/svg+xml",
		"model.xlsx":    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		"archive.zip":   "application/zip",
		"unknown.bytes": "application/octet-stream",
	}
	for path, want := range cases {
		assert.Equal(t, want, generatedFileMimeType(path), path)
	}
}

func TestDiscoverTools_GeneratedFileDescriptionsAdvertiseDownloads(t *testing.T) {
	registry := DiscoverTools(config.Config{}, nil, nil, nil, false)
	cases := map[string][]string{
		"create_spreadsheet":  {"downloadable", "Excel", "XLSX"},
		"create_document":     {"downloadable", "Word", "DOCX"},
		"create_presentation": {"downloadable", "PowerPoint", "PPTX"},
		"create_archive":      {"downloadable", "ZIP"},
		"create_csv":          {"downloadable", "CSV"},
		"create_pdf":          {"downloadable", "PDF"},
		"create_chart":        {"downloadable", "PNG", "SVG", "chart"},
		"create_site":         {"downloadable", "HTML", "site", "dashboard"},
	}

	for name, expected := range cases {
		tool, ok := registry.Get(name)
		assert.True(t, ok, "expected generated file tool %s", name)
		desc := tool.Description()
		for _, term := range expected {
			assert.Contains(t, desc, term, "%s description should include %q: %s", name, term, desc)
		}
	}
}

func TestEngineCoreTool_Execute_Valid(t *testing.T) {
	tCtx := NewEngineCoreToolContext()
	execFunc := func(ctx protocol.ToolContext, args map[string]any) ectools.ToolResult {
		return ectools.ToolResult{
			Status:      "completed",
			Output:      "test output",
			Title:       "test title",
			Metadata:    map[string]any{"m": 1},
			Attachments: []map[string]any{{"att": 1}},
		}
	}

	adapter := newEngineCoreTool("dummy", "", ToolParameters{}, tCtx, execFunc)

	res, err := adapter.Execute(context.Background(), `{"arg1":"val"}`)
	require.NoError(t, err)
	success, ok := res["success"].(bool)
	assert.True(t, ok)
	assert.True(t, success)
	assert.Equal(t, "test output", res["content"])
	assert.Equal(t, "test title", res["title"])
	assert.Equal(t, map[string]any{"m": 1}, res["metadata"])
	assert.Equal(t, []map[string]any{{"att": 1}}, res["attachments"])
}

func TestEngineCoreTool_Execute_ErrorResult(t *testing.T) {
	tCtx := NewEngineCoreToolContext()
	execFunc := func(ctx protocol.ToolContext, args map[string]any) ectools.ToolResult {
		return ectools.ToolResult{
			Status: "error",
			Error:  "test error",
		}
	}

	adapter := newEngineCoreTool("dummy", "", ToolParameters{}, tCtx, execFunc)

	res, err := adapter.Execute(context.Background(), `{}`)
	require.NoError(t, err)
	success, ok := res["success"].(bool)
	assert.True(t, ok)
	assert.False(t, success)
	assert.Equal(t, "test error", res["error"])
}

func TestEngineCoreTool_Execute_UsesCallContext(t *testing.T) {
	tCtx := NewEngineCoreToolContext()
	execFunc := func(ctx protocol.ToolContext, args map[string]any) ectools.ToolResult {
		assert.Equal(t, context.Canceled, ctx.Ctx.Err())
		return ectools.ToolResult{
			Status: "error",
			Error:  "context canceled",
		}
	}

	adapter := newEngineCoreTool("dummy", "", ToolParameters{}, tCtx, execFunc)

	callCtx, cancel := context.WithCancel(context.Background())
	cancel()

	res, err := adapter.Execute(callCtx, `{}`)
	require.NoError(t, err)
	success, ok := res["success"].(bool)
	assert.True(t, ok)
	assert.False(t, success)
	assert.Equal(t, "context canceled", res["error"])
}

func TestBuildExecutionContextDefaults(t *testing.T) {
	ctx := buildExecutionContext(nil, nil)
	assert.NotNil(t, ctx.Ctx)
	assert.NotEmpty(t, ctx.Cwd)
	assert.NotNil(t, ctx.ReadFiles)

	base := &protocol.ToolContext{
		Cwd:       "/tmp/custom",
		ReadFiles: map[string]bool{"a.txt": true},
	}
	ctx = buildExecutionContext(base, nil)
	assert.Equal(t, "/tmp/custom", ctx.Cwd)
	assert.True(t, ctx.ReadFiles["a.txt"])
	ctx.ReadFiles["b.txt"] = true
	next := buildExecutionContext(base, nil)
	assert.False(t, base.ReadFiles["b.txt"])
	assert.False(t, next.ReadFiles["b.txt"])
}
