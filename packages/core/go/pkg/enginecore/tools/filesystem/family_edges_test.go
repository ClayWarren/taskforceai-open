package filesystem

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFilesystemFamilyBoundaryEdges(t *testing.T) {
	root := t.TempDir()
	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: root, ReadFiles: map[string]bool{}}

	t.Run("missing arguments stay within their tool", func(t *testing.T) {
		assert.Equal(t, "error", ExecuteRead(ctx, nil).Status)
		assert.Equal(t, "error", ExecuteGrep(ctx, nil).Status)
		_, readMissing := parseReadArgs(nil)
		assert.Equal(t, []string{"missing filePath"}, readMissing)
		_, grepMissing := parseGrepArgs(nil)
		assert.Equal(t, []string{"missing pattern"}, grepMissing)
	})

	t.Run("write and edit fail closed outside the workspace", func(t *testing.T) {
		outsideRoot := t.TempDir()
		outsideRelative, err := filepath.Rel(root, outsideRoot)
		require.NoError(t, err)
		writeResult := ExecuteWrite(ctx, map[string]any{
			"filePath": filepath.Join(outsideRelative, "write.txt"),
			"content":  "new",
		})
		assert.Equal(t, "error", writeResult.Status)
		editResult := ExecuteEdit(ctx, map[string]any{
			"filePath":  filepath.Join(outsideRelative, "edit.txt"),
			"oldString": "old",
			"newString": "new",
		})
		assert.Equal(t, "error", editResult.Status)
	})

	t.Run("glob observes cancellation while walking", func(t *testing.T) {
		canceled, cancel := context.WithCancel(context.Background())
		cancel()
		result := ExecuteGlob(protocol.ToolContext{Ctx: canceled, Cwd: root}, map[string]any{"pattern": "*"})
		assert.Equal(t, "error", result.Status)
		assert.Contains(t, result.Error, context.Canceled.Error())
	})

	t.Run("glob applies file ignore rules", func(t *testing.T) {
		require.NoError(t, os.WriteFile(filepath.Join(root, ".gitignore"), []byte("ignored.txt\n"), 0o600))
		require.NoError(t, os.WriteFile(filepath.Join(root, "ignored.txt"), []byte("ignored"), 0o600))
		require.NoError(t, os.WriteFile(filepath.Join(root, "visible.txt"), []byte("visible"), 0o600))
		result := ExecuteGlob(ctx, map[string]any{"pattern": "*.txt"})
		assert.Equal(t, "completed", result.Status)
		assert.NotContains(t, result.Output, "ignored.txt")
		assert.Contains(t, result.Output, "visible.txt")
	})
}
