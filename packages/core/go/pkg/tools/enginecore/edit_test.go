package tools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToolEdit(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-edit-*")
	require.NoError(t, err)
	defer func() { _ = os.RemoveAll(tmpDir) }()

	ctx := protocol.ToolContext{
		Ctx:       context.Background(),
		Cwd:       tmpDir,
		ReadFiles: make(map[string]bool),
	}

	t.Run("edit success", func(t *testing.T) {
		testFile := filepath.Join(tmpDir, "edit.txt")
		err = os.WriteFile(testFile, []byte("hello world"), 0600)
		require.NoError(t, err)
		ctx.ReadFiles["edit.txt"] = true

		args := map[string]any{
			"filePath":  "edit.txt",
			"oldString": "world",
			"newString": "universe",
		}
		res := toolEdit(ctx, args)
		assert.Equal(t, "completed", res.Status)

		data := mustReadTestFile(t, testFile)
		assert.Equal(t, "hello universe", string(data))
	})

	t.Run("edit create file", func(t *testing.T) {
		args := map[string]any{
			"filePath":  "new_edit.txt",
			"oldString": "",
			"newString": "created via edit",
		}
		res := toolEdit(ctx, args)
		assert.Equal(t, "completed", res.Status)

		data := mustReadTestFile(t, filepath.Join(tmpDir, "new_edit.txt"))
		assert.Equal(t, "created via edit", string(data))
		diff, ok := res.Metadata["diff"].(string)
		assert.True(t, ok)
		assert.Contains(t, diff, "@@ -0,0 +1,1 @@")
		assert.Contains(t, diff, "+created via edit")
		assert.Contains(t, diff, "\\ No newline at end of file")
		fd, ok := res.Metadata["filediff"].(fileDiff)
		assert.True(t, ok)
		assert.Equal(t, fileDiff{
			File:      filepath.Join(tmpDir, "new_edit.txt"),
			Before:    "",
			After:     "created via edit",
			Additions: 1,
			Deletions: 0,
		}, fd)
	})

	t.Run("edit requires file to be read first", func(t *testing.T) {
		testFile := filepath.Join(tmpDir, "guard.txt")
		err = os.WriteFile(testFile, []byte("hello world"), 0600)
		require.NoError(t, err)

		args := map[string]any{
			"filePath":  "guard.txt",
			"oldString": "world",
			"newString": "friend",
		}
		res := toolEdit(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "You must read file <cwd>/guard.txt before overwriting it")
		data := mustReadTestFile(t, testFile)
		assert.Equal(t, "hello world", string(data))
	})

	t.Run("edit replaces all occurrences", func(t *testing.T) {
		testFile := filepath.Join(tmpDir, "replace.txt")
		err = os.WriteFile(testFile, []byte("cat dog cat"), 0600)
		require.NoError(t, err)
		ctx.ReadFiles["replace.txt"] = true

		res := toolEdit(ctx, map[string]any{
			"filePath":  "replace.txt",
			"oldString": "cat",
			"newString": "fox",
		})
		assert.Equal(t, "completed", res.Status)
		data := mustReadTestFile(t, testFile)
		assert.Equal(t, "fox dog fox", string(data))
	})

	t.Run("edit no-op succeeds when old string is not present", func(t *testing.T) {
		testFile := filepath.Join(tmpDir, "noop.txt")
		err = os.WriteFile(testFile, []byte("stable line"), 0600)
		require.NoError(t, err)
		ctx.ReadFiles["noop.txt"] = true

		res := toolEdit(ctx, map[string]any{
			"filePath":  "noop.txt",
			"oldString": "missing",
			"newString": "changed",
		})
		assert.Equal(t, "completed", res.Status)
		data := mustReadTestFile(t, testFile)
		assert.Equal(t, "stable line", string(data))
		fd, ok := res.Metadata["filediff"].(fileDiff)
		assert.True(t, ok)
		assert.Equal(t, 0, fd.Additions)
		assert.Equal(t, 0, fd.Deletions)
		diff, ok := res.Metadata["diff"].(string)
		assert.True(t, ok)
		assert.NotContains(t, diff, "-stable line")
		assert.NotContains(t, diff, "+changed")
	})

	t.Run("edit missing file errors when oldString is non-empty", func(t *testing.T) {
		res := toolEdit(ctx, map[string]any{
			"filePath":  "missing.txt",
			"oldString": "a",
			"newString": "b",
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "File <cwd>/missing.txt not found")
	})

	t.Run("edit same strings fail", func(t *testing.T) {
		args := map[string]any{
			"filePath":  "edit.txt",
			"oldString": "same",
			"newString": "same",
		}
		res := toolEdit(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "must be different")
	})

	t.Run("edit directory fails", func(t *testing.T) {
		args := map[string]any{
			"filePath":  "dir/",
			"oldString": "a",
			"newString": "b",
		}
		res := toolEdit(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "Path is a directory, not a file")
	})

	t.Run("edit invalid args are rejected", func(t *testing.T) {
		res := toolEdit(ctx, map[string]any{"filePath": "dir/"})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "invalid arguments")
	})
}

func TestToolEditCreatesNewFileAndRejectsInvalidInputs(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{
		Ctx:       context.Background(),
		Cwd:       tmpDir,
		ReadFiles: map[string]bool{},
	}

	res := toolEdit(ctx, map[string]any{})
	assert.Equal(t, "error", res.Status)

	res = toolEdit(ctx, map[string]any{
		"filePath":  "same.txt",
		"oldString": "x",
		"newString": "x",
	})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "must be different")

	res = toolEdit(ctx, map[string]any{
		"filePath":  "dir/",
		"oldString": "",
		"newString": "content",
	})
	assert.Equal(t, "error", res.Status)

	res = toolEdit(ctx, map[string]any{
		"filePath":  "new/file.txt",
		"oldString": "",
		"newString": "created",
	})
	assert.Equal(t, "completed", res.Status)
	assert.FileExists(t, filepath.Join(tmpDir, "new", "file.txt"))
}

func TestBuildUnifiedDiff(t *testing.T) {
	t.Run("create hunk starts at zero and marks missing newline", func(t *testing.T) {
		diff, fd := buildUnifiedDiff("a.txt", "", "created")
		assert.Contains(t, diff, "@@ -0,0 +1,1 @@")
		assert.Contains(t, diff, "+created")
		assert.Contains(t, diff, "\\ No newline at end of file")
		assert.Equal(t, fileDiff{
			File:      "a.txt",
			Before:    "",
			After:     "created",
			Additions: 1,
			Deletions: 0,
		}, fd)
	})

	t.Run("replacement without trailing newlines adds both eof markers", func(t *testing.T) {
		diff, _ := buildUnifiedDiff("b.txt", "old", "new")
		assert.Contains(t, diff, "-old")
		assert.Contains(t, diff, "+new")
		assert.Equal(t, 2, strings.Count(diff, "\\ No newline at end of file"))
	})

	t.Run("trailing-newline inputs keep expected hunk positions", func(t *testing.T) {
		diff, _ := buildUnifiedDiff("c.txt", "line1\nline2\n", "line1\nline3\n")
		assert.Contains(t, diff, "@@ -2,1 +2,1 @@")
		assert.Contains(t, diff, "-line2")
		assert.Contains(t, diff, "+line3")
		assert.NotContains(t, diff, "\\ No newline at end of file")
	})
}
