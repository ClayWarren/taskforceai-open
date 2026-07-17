package artifacts

import (
	"bytes"
	"context"
	"io"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeCSVFileWriter struct {
	err      error
	requests []CSVWriteRequest
	contents [][]byte
}

func (w *fakeCSVFileWriter) WriteCSV(_ context.Context, request CSVWriteRequest) error {
	w.requests = append(w.requests, request)
	if w.err != nil {
		return w.err
	}
	var content bytes.Buffer
	if request.Write != nil {
		if err := request.Write(&content); err != nil {
			return err
		}
	}
	w.contents = append(w.contents, append([]byte(nil), content.Bytes()...))
	return nil
}

func useCSVFileWriter(t *testing.T, writer CSVWriter) {
	t.Helper()
	restore := SetCSVWriter(writer)
	t.Cleanup(restore)
}

func TestToolCreateCSV(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{
		Ctx: context.Background(),
		Cwd: tmpDir,
	}

	t.Run("success", func(t *testing.T) {
		writer := &fakeCSVFileWriter{}
		useCSVFileWriter(t, writer)
		args := map[string]any{
			"filePath": "reports/test.csv",
			"rows": []any{
				[]any{"h1", "h2"},
				[]any{"v1", "v2"},
			},
		}
		res := ExecuteCSV(ctx, args)
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "reports", "test.csv"), writer.requests[0].Path)
			assert.Equal(t, "h1,h2\nv1,v2\n", string(writer.contents[0]))
		}
	})

	t.Run("invalid args", func(t *testing.T) {
		assert.Equal(t, "error", ExecuteCSV(ctx, map[string]any{}).Status)
		assert.Equal(t, "error", ExecuteCSV(ctx, map[string]any{"filePath": "bad.csv"}).Status)
	})

	t.Run("rejects oversized row input before writing", func(t *testing.T) {
		tooManyRows := make([]any, MaxCSVRows+1)
		for i := range tooManyRows {
			tooManyRows[i] = []any{"value"}
		}
		res := ExecuteCSV(ctx, map[string]any{
			"filePath": "too-many-rows.csv",
			"rows":     tooManyRows,
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "exceeds maximum allowed")

		tooManyColumns := make([]any, MaxCSVColumns+1)
		for i := range tooManyColumns {
			tooManyColumns[i] = "value"
		}
		res = ExecuteCSV(ctx, map[string]any{
			"filePath": "too-many-columns.csv",
			"rows":     []any{tooManyColumns},
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "exceeds maximum allowed")
	})

	t.Run("skips non-row entries", func(t *testing.T) {
		writer := &fakeCSVFileWriter{}
		useCSVFileWriter(t, writer)
		res := ExecuteCSV(ctx, map[string]any{
			"filePath": "mixed.csv",
			"rows": []any{
				"skip",
				[]any{"v1", 2, true},
			},
		})
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "mixed.csv"), writer.requests[0].Path)
			assert.Contains(t, string(writer.contents[0]), "v1,2,true")
		}
	})
}

func TestWriteCSVRowsEnforcesOutputLimit(t *testing.T) {
	err := writeCSVRows(newCSVSizeLimitWriter(io.Discard, 8), []any{
		[]any{"abcdefghi"},
	})
	require.Error(t, err)
	assert.Contains(t, csvWriteErrorMessage(err), "CSV output exceeds maximum allowed")
}
