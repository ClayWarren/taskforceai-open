package tools

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

func TestToolGlob_MatchesPathPatterns(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.MkdirAll(sub, 0o750); err != nil {
		t.Fatalf("failed creating subdir: %v", err)
	}
	target := filepath.Join(sub, "file.txt")
	if err := os.WriteFile(target, []byte("ok"), 0o600); err != nil {
		t.Fatalf("failed creating file: %v", err)
	}

	result := toolGlob(protocol.ToolContext{
		Ctx: context.Background(),
		Cwd: root,
	}, map[string]any{
		"path":    ".",
		"pattern": "sub/*.txt",
	})

	if result.Status != "completed" {
		t.Fatalf("unexpected status: %s", result.Status)
	}
	if !strings.Contains(result.Output, "<cwd>/sub/file.txt") {
		t.Fatalf("expected glob output to include nested file path, got %q", result.Output)
	}
}

func TestToolGlob_BraceExpansion(t *testing.T) {
	root := t.TempDir()
	_ = os.WriteFile(filepath.Join(root, "a.go"), []byte(""), 0600)
	_ = os.WriteFile(filepath.Join(root, "b.ts"), []byte(""), 0600)

	result := toolGlob(protocol.ToolContext{
		Ctx: context.Background(),
		Cwd: root,
	}, map[string]any{
		"pattern": "*.{go,ts}",
	})

	if !strings.Contains(result.Output, "a.go") || !strings.Contains(result.Output, "b.ts") {
		t.Errorf("expected both files in output, got %q", result.Output)
	}
}

func TestToolGlob_Errors(t *testing.T) {
	root := t.TempDir()

	// 1. Missing pattern
	res := toolGlob(protocol.ToolContext{Ctx: context.Background(), Cwd: root}, map[string]any{})
	if res.Status != "error" {
		t.Error("expected error for missing pattern")
	}

	// 2. No such directory
	res = toolGlob(protocol.ToolContext{Ctx: context.Background(), Cwd: root}, map[string]any{"pattern": "*", "path": "missing"})
	if res.Status != "error" {
		t.Error("expected error for missing path")
	}

	// 3. No files found
	res = toolGlob(protocol.ToolContext{Ctx: context.Background(), Cwd: root}, map[string]any{"pattern": "*.missing"})
	if res.Status != "completed" || !strings.Contains(res.Output, "No files found") {
		t.Fatalf("expected no-files result, got status=%s output=%q", res.Status, res.Output)
	}
}

func TestToolGlob_TruncatesToNewestMatches(t *testing.T) {
	root := t.TempDir()
	oldDir := filepath.Join(root, "old")
	newPath := filepath.Join(root, "zz-newest.go")
	if err := os.MkdirAll(oldDir, 0o750); err != nil {
		t.Fatalf("failed creating old dir: %v", err)
	}
	oldTime := time.Now().Add(-2 * time.Hour)
	for i := range globResultLimit + 30 {
		path := filepath.Join(oldDir, "old-"+strconv.Itoa(i)+".go")
		if err := os.WriteFile(path, []byte("old"), 0o600); err != nil {
			t.Fatalf("failed writing old file: %v", err)
		}
		if err := os.Chtimes(path, oldTime, oldTime); err != nil {
			t.Fatalf("failed setting old mtime: %v", err)
		}
	}
	if err := os.WriteFile(newPath, []byte("new"), 0o600); err != nil {
		t.Fatalf("failed writing newest file: %v", err)
	}
	newTime := time.Now().Add(-1 * time.Hour)
	if err := os.Chtimes(newPath, newTime, newTime); err != nil {
		t.Fatalf("failed setting newest mtime: %v", err)
	}

	result := toolGlob(protocol.ToolContext{Ctx: context.Background(), Cwd: root}, map[string]any{
		"pattern": "*.go",
	})

	if result.Status != "completed" {
		t.Fatalf("unexpected status: %s", result.Status)
	}
	if result.Metadata["count"] != globResultLimit+31 {
		t.Fatalf("count = %#v, want %d", result.Metadata["count"], globResultLimit+31)
	}
	if result.Metadata["shown"] != globResultLimit {
		t.Fatalf("shown = %#v, want %d", result.Metadata["shown"], globResultLimit)
	}
	if result.Metadata["truncated"] != true {
		t.Fatalf("truncated = %#v, want true", result.Metadata["truncated"])
	}
	if !strings.Contains(result.Output, "<cwd>/zz-newest.go") {
		t.Fatalf("expected newest file in truncated output, got %q", result.Output)
	}
	if !strings.Contains(result.Output, "Results are truncated") {
		t.Fatalf("expected truncation hint, got %q", result.Output)
	}
}

func BenchmarkToolGlobLargeTree(b *testing.B) {
	root := b.TempDir()
	for dir := range 20 {
		dirPath := filepath.Join(root, "pkg", "module-"+strconv.Itoa(dir))
		if err := os.MkdirAll(dirPath, 0o750); err != nil {
			b.Fatalf("failed creating module dir: %v", err)
		}
		for file := range 50 {
			ext := ".go"
			if file%5 == 0 {
				ext = ".md"
			}
			path := filepath.Join(dirPath, "file-"+strconv.Itoa(file)+ext)
			if err := os.WriteFile(path, []byte("content"), 0o600); err != nil {
				b.Fatalf("failed writing file: %v", err)
			}
		}
	}

	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: root}
	args := map[string]any{"path": ".", "pattern": "*.go"}

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		result := toolGlob(ctx, args)
		if result.Status != "completed" {
			b.Fatalf("unexpected status: %s", result.Status)
		}
		if result.Metadata["count"] != 800 {
			b.Fatalf("count = %#v, want 800", result.Metadata["count"])
		}
		if result.Metadata["shown"] != globResultLimit {
			b.Fatalf("shown = %#v, want %d", result.Metadata["shown"], globResultLimit)
		}
	}
}
