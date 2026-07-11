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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGrepGlobPushTo95CoverageGapPaths(t *testing.T) {
	tmpDir := t.TempDir()

	t.Run("grep tolerates walk errors on unreadable directories", func(t *testing.T) {
		locked := filepath.Join(tmpDir, "locked")
		assert.NoError(t, os.Mkdir(locked, 0o750))
		assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, "visible.txt"), []byte("visible"), 0o600))
		assert.NoError(t, os.Chmod(locked, 0o000))
		t.Cleanup(func() { _ = os.Chmod(locked, 0o750) })

		res := toolGrep(protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir}, map[string]any{
			"path":    ".",
			"pattern": "visible",
		})
		assert.Equal(t, "error", res.Status)
	})

	t.Run("glob expand brace patterns return combined matches", func(t *testing.T) {
		assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, "a.txt"), []byte("a"), 0o600))
		assert.NoError(t, os.WriteFile(filepath.Join(tmpDir, "b.txt"), []byte("b"), 0o600))
		res := toolGlob(protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir}, map[string]any{
			"pattern": "{a,b}.txt",
		})
		assert.Equal(t, "completed", res.Status)
		if count, ok := res.Metadata["count"].(int); !ok || count < 2 {
			t.Fatalf("expected at least two glob matches, got %#v", res.Metadata["count"])
		}
	})
}

func TestMatchesGlob(t *testing.T) {
	tests := []struct {
		glob     string
		path     string
		root     string
		expected bool
	}{
		{"*.txt", "file.txt", "", true},
		{"*.txt", "file.go", "", false},
		{"src/*.go", "src/main.go", "", true},
		{"src/*.go", "pkg/main.go", "", false},
		{"main.go", "/abs/path/main.go", "/abs/path", true},
	}

	for _, tt := range tests {
		assert.Equal(t, tt.expected, matchesGlob(tt.glob, tt.path, tt.root))
	}
}

func TestSplitLines(t *testing.T) {
	assert.Equal(t, []string{""}, splitLines(""))
	assert.Equal(t, []string{"a", "b"}, splitLines("a\r\nb"))
	assert.Equal(t, []string{"a", "b", ""}, splitLines("a\nb\n"))
}

func TestToolGrep(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-grep-*")
	require.NoError(t, err)
	defer func() { _ = os.RemoveAll(tmpDir) }()

	err = os.WriteFile(filepath.Join(tmpDir, "file1.txt"), []byte(`match this
and that`), 0600)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(tmpDir, "file2.txt"), []byte("no match"), 0600)
	require.NoError(t, err)

	ctx := protocol.ToolContext{
		Ctx: context.Background(),
		Cwd: tmpDir,
	}

	t.Run("grep success", func(t *testing.T) {
		args := map[string]any{"pattern": "match"}
		res := toolGrep(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "Found 2 matches")
		assert.Contains(t, res.Output, "file1.txt")
		assert.Contains(t, res.Output, "file2.txt")
	})

	t.Run("grep with path", func(t *testing.T) {
		args := map[string]any{
			"pattern": "match",
			"path":    "file1.txt",
		}
		res := toolGrep(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "file1.txt")
	})

	t.Run("grep invalid regex", func(t *testing.T) {
		args := map[string]any{"pattern": "["}
		res := toolGrep(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "invalid regex")
	})

	t.Run("grep include filters matching files", func(t *testing.T) {
		err = os.MkdirAll(filepath.Join(tmpDir, "sub"), 0o750)
		require.NoError(t, err)
		err = os.WriteFile(filepath.Join(tmpDir, "sub", "include.txt"), []byte("token"), 0600)
		require.NoError(t, err)
		err = os.WriteFile(filepath.Join(tmpDir, "sub", "include.log"), []byte("token"), 0600)
		require.NoError(t, err)

		res := toolGrep(ctx, map[string]any{
			"pattern": "token",
			"include": "*.txt",
		})
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "include.txt")
		assert.NotContains(t, res.Output, "include.log")
	})

	t.Run("grep include with double-star returns empty result", func(t *testing.T) {
		res := toolGrep(ctx, map[string]any{
			"pattern": "match",
			"include": "**/*.txt",
		})
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, "No files found", res.Output)
		assert.Equal(t, false, res.Metadata["truncated"])
		assert.Equal(t, 0, res.Metadata["matches"])
	})

	t.Run("grep missing search path returns empty result", func(t *testing.T) {
		res := toolGrep(ctx, map[string]any{
			"pattern": "match",
			"path":    "does-not-exist",
		})
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, "No files found", res.Output)
		assert.Equal(t, false, res.Metadata["truncated"])
		assert.Equal(t, 0, res.Metadata["matches"])
	})

	t.Run("grep blocks external paths without permission checker", func(t *testing.T) {
		res := toolGrep(ctx, map[string]any{
			"pattern": "match",
			"path":    "..",
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "external directory access denied")
	})

	t.Run("grep truncates at max results", func(t *testing.T) {
		lines := make([]string, 130)
		for i := range lines {
			lines[i] = "many-match line"
		}
		err = os.WriteFile(filepath.Join(tmpDir, "many.txt"), []byte(strings.Join(lines, "\n")), 0600)
		require.NoError(t, err)

		res := toolGrep(ctx, map[string]any{"pattern": "many-match"})
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "Found 100 matches")
		assert.Contains(t, res.Output, "(Results are truncated. Consider using a more specific path or pattern.)")
		assert.Equal(t, true, res.Metadata["truncated"])
		assert.Equal(t, 100, res.Metadata["matches"])
	})

	t.Run("grep orders output by newest file first", func(t *testing.T) {
		oldPath := filepath.Join(tmpDir, "older.txt")
		newPath := filepath.Join(tmpDir, "newer.txt")
		err = os.WriteFile(oldPath, []byte("needle"), 0600)
		require.NoError(t, err)
		err = os.WriteFile(newPath, []byte("needle"), 0600)
		require.NoError(t, err)

		oldTime := time.Now().Add(-2 * time.Hour)
		newTime := time.Now().Add(-1 * time.Hour)
		assert.NoError(t, os.Chtimes(oldPath, oldTime, oldTime))
		assert.NoError(t, os.Chtimes(newPath, newTime, newTime))

		res := toolGrep(ctx, map[string]any{"pattern": "needle"})
		assert.Equal(t, "completed", res.Status)
		newerIndex := strings.Index(res.Output, "<cwd>/newer.txt:")
		olderIndex := strings.Index(res.Output, "<cwd>/older.txt:")
		assert.NotEqual(t, -1, newerIndex)
		assert.NotEqual(t, -1, olderIndex)
		assert.Less(t, newerIndex, olderIndex)
	})

	t.Run("grep returns cancellation errors before regex compile", func(t *testing.T) {
		canceledCtx, cancel := context.WithCancel(context.Background())
		cancel()
		res := toolGrep(protocol.ToolContext{
			Ctx: canceledCtx,
			Cwd: tmpDir,
		}, map[string]any{"pattern": "match"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "regex compilation timed out")
	})

	t.Run("grep returns filesystem errors from walk", func(t *testing.T) {
		restrictedPath := filepath.Join(tmpDir, "restricted.txt")
		err = os.WriteFile(restrictedPath, []byte("restricted-match"), 0600)
		assert.NoError(t, err)
		assert.NoError(t, os.Chmod(restrictedPath, 0))
		defer func() {
			_ = os.Chmod(restrictedPath, 0o600)
		}()

		res := toolGrep(ctx, map[string]any{"pattern": "restricted-match"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "restricted.txt")
	})

	t.Run("grep truncates long matching line output", func(t *testing.T) {
		longLine := strings.Repeat("a", 2105) + " needle"
		err = os.WriteFile(filepath.Join(tmpDir, "longline.txt"), []byte(longLine), 0600)
		require.NoError(t, err)

		res := toolGrep(ctx, map[string]any{"pattern": "needle"})
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, strings.Repeat("a", 2000)+"...")
		assert.NotContains(t, res.Output, strings.Repeat("a", 2105)+" needle")
	})

	t.Run("grep no results", func(t *testing.T) {
		args := map[string]any{"pattern": "missing"}
		res := toolGrep(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Contains(t, res.Output, "No files found")
	})
}

func TestToolGrepKeepsNewestMatchesWhenTruncated(t *testing.T) {
	tmpDir := t.TempDir()
	oldPath := filepath.Join(tmpDir, "a-old.txt")
	newPath := filepath.Join(tmpDir, "z-new.txt")

	oldLines := make([]string, 130)
	for i := range oldLines {
		oldLines[i] = "old-hit"
	}
	require.NoError(t, os.WriteFile(oldPath, []byte(strings.Join(oldLines, "\n")), 0o600))
	require.NoError(t, os.WriteFile(newPath, []byte("new-hit"), 0o600))

	oldTime := time.Now().Add(-2 * time.Hour)
	newTime := time.Now().Add(-1 * time.Hour)
	require.NoError(t, os.Chtimes(oldPath, oldTime, oldTime))
	require.NoError(t, os.Chtimes(newPath, newTime, newTime))

	res := toolGrep(protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir}, map[string]any{
		"pattern": "hit",
	})

	require.Equal(t, "completed", res.Status)
	assert.Equal(t, true, res.Metadata["truncated"])
	assert.Equal(t, 100, res.Metadata["matches"])
	assert.Contains(t, res.Output, "<cwd>/z-new.txt:")
	assert.Contains(t, res.Output, "new-hit")
}

func BenchmarkToolGrepLargeTree(b *testing.B) {
	tmpDir := b.TempDir()
	lines := make([]string, 200)
	for i := range lines {
		if i%5 == 0 {
			lines[i] = "needle line with enough content to look like a source hit"
		} else {
			lines[i] = "ordinary source line without the token"
		}
	}
	body := []byte(strings.Join(lines, "\n"))
	for dir := range 20 {
		dirPath := filepath.Join(tmpDir, "pkg", "module-"+strconv.Itoa(dir))
		require.NoError(b, os.MkdirAll(dirPath, 0o750))
		for file := range 30 {
			require.NoError(
				b,
				os.WriteFile(filepath.Join(dirPath, "file-"+strconv.Itoa(file)+".go"), body, 0o600),
			)
		}
	}

	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir}
	args := map[string]any{"pattern": "needle", "include": "*.go"}

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		res := toolGrep(ctx, args)
		if res.Status != "completed" {
			b.Fatalf("grep status = %s, error = %s", res.Status, res.Error)
		}
		if res.Metadata["matches"] != 100 {
			b.Fatalf("matches = %#v, want 100", res.Metadata["matches"])
		}
	}
}
