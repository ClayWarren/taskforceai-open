package tools

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToolWrite(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "test-write-*")
	require.NoError(t, err)
	defer func() { _ = os.RemoveAll(tmpDir) }()

	ctx := protocol.ToolContext{
		Ctx:       context.Background(),
		Cwd:       tmpDir,
		ReadFiles: make(map[string]bool),
	}

	t.Run("write new file", func(t *testing.T) {
		args := map[string]any{
			"filePath": "new.txt",
			"content":  "hello world",
		}
		res := toolWrite(ctx, args)
		assert.Equal(t, "completed", res.Status)

		data := mustReadTestFile(t, filepath.Join(tmpDir, "new.txt"))
		assert.Equal(t, "hello world", string(data))
	})

	t.Run("write empty file", func(t *testing.T) {
		args := map[string]any{
			"filePath": "empty.txt",
			"content":  "",
		}
		res := toolWrite(ctx, args)
		assert.Equal(t, "completed", res.Status)

		data := mustReadTestFile(t, filepath.Join(tmpDir, "empty.txt"))
		assert.Empty(t, data)
	})

	t.Run("missing args", func(t *testing.T) {
		res := toolWrite(ctx, map[string]any{})
		assert.Equal(t, "error", res.Status)
	})

	t.Run("creates nested directories", func(t *testing.T) {
		res := toolWrite(ctx, map[string]any{
			"filePath": "nested/deep/file.txt",
			"content":  "nested content",
		})
		assert.Equal(t, "completed", res.Status)
		assert.FileExists(t, filepath.Join(tmpDir, "nested", "deep", "file.txt"))
		assert.Equal(t, false, res.Metadata["exists"])
	})

	t.Run("write existing file without read fails", func(t *testing.T) {
		err = os.WriteFile(filepath.Join(tmpDir, "exists.txt"), []byte("old"), 0600)
		require.NoError(t, err)

		args := map[string]any{
			"filePath": "exists.txt",
			"content":  "new content",
		}
		res := toolWrite(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "You must read file")
	})

	t.Run("write existing file after read success", func(t *testing.T) {
		ctx.ReadFiles["exists.txt"] = true
		args := map[string]any{
			"filePath": "exists.txt",
			"content":  "new content",
		}
		res := toolWrite(ctx, args)
		assert.Equal(t, "completed", res.Status)

		data := mustReadTestFile(t, filepath.Join(tmpDir, "exists.txt"))
		assert.Equal(t, "new content", string(data))
	})

	t.Run("write to directory fails", func(t *testing.T) {
		args := map[string]any{
			"filePath": "dir/",
			"content":  "content",
		}
		res := toolWrite(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "path is a directory")
	})
}
