package artifacts

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type selectivePermission struct {
	denied map[string]bool
}

type fakeArchiveFileWriter struct {
	err           error
	filesAdded    int
	useEntryCount bool
	requests      []ArchiveWriteRequest
}

func (w *fakeArchiveFileWriter) WriteArchive(_ context.Context, request ArchiveWriteRequest) (ArchiveWriteResult, error) {
	w.requests = append(w.requests, request)
	if w.err != nil {
		return ArchiveWriteResult{}, w.err
	}
	if w.useEntryCount {
		return ArchiveWriteResult{FilesAdded: len(request.Entries)}, nil
	}
	return ArchiveWriteResult{FilesAdded: w.filesAdded}, nil
}

func useArchiveWriter(t *testing.T, writer ArchiveWriter) {
	t.Helper()
	restore := SetArchiveWriter(writer)
	t.Cleanup(restore)
}

func (p selectivePermission) Ask(req protocol.PermissionRequest) error {
	if req.Permission != "read" {
		return nil
	}
	filePath, ok := req.Metadata["filePath"].(string)
	if !ok {
		return nil
	}
	if p.denied[filePath] {
		return errPermissionDenied{}
	}
	return nil
}

func TestToolCreateArchive(t *testing.T) {
	tmpDir := t.TempDir()

	_ = os.WriteFile(filepath.Join(tmpDir, "f1.txt"), []byte("data1"), 0600)

	ctx := protocol.ToolContext{
		Ctx: context.Background(),
		Cwd: tmpDir,
	}

	t.Run("success", func(t *testing.T) {
		writer := &fakeArchiveFileWriter{useEntryCount: true}
		useArchiveWriter(t, writer)
		args := map[string]any{
			"filePath": "test.zip",
			"files":    []any{"f1.txt"},
		}
		res := ExecuteArchive(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, 1, res.Metadata["files_added"])
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "test.zip"), writer.requests[0].Path)
			if assert.Len(t, writer.requests[0].Entries, 1) {
				assert.Equal(t, filepath.Join(tmpDir, "f1.txt"), writer.requests[0].Entries[0].SourcePath)
				assert.Equal(t, "f1.txt", writer.requests[0].Entries[0].Name)
			}
		}
	})

	t.Run("no files added", func(t *testing.T) {
		useArchiveWriter(t, &fakeArchiveFileWriter{})
		args := map[string]any{
			"filePath": "empty.zip",
			"files":    []any{"missing.txt"},
		}
		res := ExecuteArchive(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "No files could be added")
	})

	t.Run("skips files denied by read permission", func(t *testing.T) {
		err := os.WriteFile(filepath.Join(tmpDir, "f2.txt"), []byte("data2"), 0o600)
		require.NoError(t, err)

		writer := &fakeArchiveFileWriter{useEntryCount: true}
		useArchiveWriter(t, writer)
		args := map[string]any{
			"filePath": "filtered.zip",
			"files":    []any{"f1.txt", "f2.txt"},
		}
		res := ExecuteArchive(protocol.ToolContext{
			Ctx:        context.Background(),
			Cwd:        tmpDir,
			Permission: selectivePermission{denied: map[string]bool{"f2.txt": true}},
		}, args)
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, 1, res.Metadata["files_added"])
		if assert.Len(t, writer.requests, 1) {
			assert.Len(t, writer.requests[0].Entries, 1)
		}
	})

	t.Run("existing destination is preserved when archive creation fails", func(t *testing.T) {
		destPath := filepath.Join(tmpDir, "preserve.zip")
		original := []byte("ORIGINAL-DATA")
		err := os.WriteFile(destPath, original, 0o600)
		require.NoError(t, err)

		args := map[string]any{
			"filePath": "preserve.zip",
			"files":    []any{"missing.txt"},
		}
		useArchiveWriter(t, &fakeArchiveFileWriter{})
		res := ExecuteArchive(ctx, args)
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "No files could be added")

		after := mustReadTestFile(t, destPath)
		assert.Equal(t, original, after)
	})

	t.Run("invalid args and file limit", func(t *testing.T) {
		assert.Equal(t, "error", ExecuteArchive(ctx, map[string]any{}).Status)
		assert.Equal(t, "error", ExecuteArchive(ctx, map[string]any{"filePath": "missing.zip"}).Status)
		files := make([]any, MaxArchiveFiles+1)
		for i := range files {
			files[i] = "f1.txt"
		}
		res := ExecuteArchive(ctx, map[string]any{"filePath": "many.zip", "files": files})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "exceeds maximum allowed")
	})
}
