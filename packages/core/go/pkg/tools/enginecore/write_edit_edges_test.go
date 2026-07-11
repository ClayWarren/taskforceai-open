package tools

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToolWriteFilesystemEdges(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{
		Ctx:        context.Background(),
		Cwd:        tmpDir,
		ReadFiles:  map[string]bool{},
		Permission: allowPermission{},
	}
	args := map[string]any{"filePath": "out.txt", "content": "content"}

	previousMkdir := makeWriteDirectory
	previousWrite := writeToolFile
	previousRename := renameWriteFile
	previousRemove := removeWriteTemp
	t.Cleanup(func() {
		makeWriteDirectory = previousMkdir
		writeToolFile = previousWrite
		renameWriteFile = previousRename
		removeWriteTemp = previousRemove
	})
	removable := filepath.Join(tmpDir, "remove-me")
	require.NoError(t, os.WriteFile(removable, nil, 0o600))
	require.NoError(t, removeWriteTemp(removable))

	outsideFile := filepath.Join(t.TempDir(), "outside.txt")
	require.NoError(t, os.WriteFile(outsideFile, []byte("old"), 0o600))
	outsideRel, err := filepath.Rel(tmpDir, outsideFile)
	require.NoError(t, err)
	res := toolWrite(ctx, map[string]any{"filePath": outsideRel, "content": "new"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, outsideFile)

	makeWriteDirectory = func(string, os.FileMode) error { return errors.New("mkdir failed") }
	res = toolWrite(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "mkdir failed")
	makeWriteDirectory = previousMkdir

	writeToolFile = func(string, []byte, os.FileMode) error { return errors.New("write failed") }
	res = toolWrite(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "write failed")
	writeToolFile = previousWrite

	renameWriteFile = func(string, string) error { return errors.New("rename failed") }
	removeCalled := false
	removeWriteTemp = func(string) error {
		removeCalled = true
		return nil
	}
	res = toolWrite(ctx, args)
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "rename failed")
	assert.True(t, removeCalled)
}

func TestToolEditFilesystemEdges(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{
		Ctx:        context.Background(),
		Cwd:        tmpDir,
		ReadFiles:  map[string]bool{},
		Permission: allowPermission{},
	}

	previousMkdir := makeEditDirectory
	previousWrite := writeEditFile
	t.Cleanup(func() {
		makeEditDirectory = previousMkdir
		writeEditFile = previousWrite
	})

	outsideFile := filepath.Join(t.TempDir(), "outside-edit.txt")
	require.NoError(t, os.WriteFile(outsideFile, []byte("old"), 0o600))
	outsideRel, err := filepath.Rel(tmpDir, outsideFile)
	require.NoError(t, err)
	res := toolEdit(ctx, map[string]any{"filePath": outsideRel, "oldString": "old", "newString": "new"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, outsideFile)

	makeEditDirectory = func(string, os.FileMode) error { return errors.New("mkdir failed") }
	res = toolEdit(ctx, map[string]any{"filePath": "new-file.txt", "oldString": "", "newString": "new"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "mkdir failed")
	makeEditDirectory = previousMkdir

	writeEditFile = func(string, []byte, os.FileMode) error { return errors.New("write failed") }
	res = toolEdit(ctx, map[string]any{"filePath": "new-file.txt", "oldString": "", "newString": "new"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "write failed")

	existing := filepath.Join(tmpDir, "existing.txt")
	require.NoError(t, os.WriteFile(existing, []byte("old"), 0o600))
	ctx.ReadFiles["existing.txt"] = true
	res = toolEdit(ctx, map[string]any{"filePath": "existing.txt", "oldString": "old", "newString": "new"})
	assert.Equal(t, "error", res.Status)
	assert.Contains(t, res.Error, "write failed")
	writeEditFile = previousWrite

	diff, fd := buildUnifiedDiff("delete.txt", "old\nsame\n", "")
	assert.Contains(t, diff, "-old")
	assert.Contains(t, diff, "-same")
	assert.Equal(t, 0, fd.Additions)
	assert.Equal(t, 2, fd.Deletions)

	diff, _ = buildUnifiedDiff("suffix.txt", "old\nsame\n", "new\nsame\n")
	assert.Contains(t, diff, "-old")
	assert.Contains(t, diff, "+new")
	assert.NotContains(t, diff, "-same")
}
