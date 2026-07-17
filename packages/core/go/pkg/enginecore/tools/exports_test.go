package tools

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

func TestExports(t *testing.T) {
	ctx := protocol.ToolContext{}
	args := map[string]any{}

	// We just want to ensure these wrappers don't panic and we hit the coverage.
	// Since args are empty, most will just return invalidArgs ToolResult.
	_ = ToolRead(ctx, args)
	_ = ToolWrite(ctx, args)
	_ = ToolEdit(ctx, args)
	_ = ToolApplyPatch(ctx, args)
	_ = ToolGlob(ctx, args)
	_ = ToolGrep(ctx, args)
	_ = ToolCreateSpreadsheet(ctx, args)
	_ = ToolCreateDocument(ctx, args)
	_ = ToolCreatePresentation(ctx, args)
	_ = ToolCreateArchive(ctx, nil)
	_ = ToolCreateCSV(ctx, nil)
	_ = ToolCreatePDF(ctx, nil)
	_ = ToolCreateChart(ctx, nil)
	_ = ToolCreateSite(ctx, nil)
}

func TestExportedToolWrappersNormalizeContext(t *testing.T) {
	tmpDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmpDir, "file.txt"), []byte("hello"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	res := ToolGlob(
		protocol.ToolContext{Cwd: tmpDir},
		map[string]any{"pattern": "*.txt"},
	)
	if res.Status != "completed" {
		t.Fatalf("ToolGlob status = %q, error = %q", res.Status, res.Error)
	}
	if res.Output == "" || res.Output == "No files found" {
		t.Fatalf("ToolGlob output = %q", res.Output)
	}
}
