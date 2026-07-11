package tools

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

type fakeSpreadsheetWriter struct {
	err      error
	requests []SpreadsheetWriteRequest
}

func (w *fakeSpreadsheetWriter) WriteSpreadsheet(_ context.Context, request SpreadsheetWriteRequest) error {
	w.requests = append(w.requests, request)
	return w.err
}

func useSpreadsheetWriter(t *testing.T, writer SpreadsheetWriter) {
	t.Helper()
	restore := SetSpreadsheetWriter(writer)
	t.Cleanup(restore)
}

func TestToolCreateSpreadsheet(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{
		Ctx: context.Background(),
		Cwd: tmpDir,
	}

	t.Run("success", func(t *testing.T) {
		writer := &fakeSpreadsheetWriter{}
		useSpreadsheetWriter(t, writer)
		args := map[string]any{
			"filePath": "test.xlsx",
			"sheets": []any{
				map[string]any{
					"name": "Sheet1",
					"rows": []any{
						[]any{"A1", "B1"},
						[]any{"A2", "B2"},
					},
				},
			},
		}
		res := toolCreateSpreadsheet(ctx, args)
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			request := writer.requests[0]
			assert.Equal(t, filepath.Join(tmpDir, "test.xlsx"), request.Path)
			assert.Equal(t, []SpreadsheetSheet{{
				Name: "Sheet1",
				Rows: [][]any{
					{"A1", "B1"},
					{"A2", "B2"},
				},
			}}, request.Sheets)
		}
	})

	t.Run("missing args", func(t *testing.T) {
		res := toolCreateSpreadsheet(ctx, nil)
		assert.Equal(t, "error", res.Status)
	})

	t.Run("row limit and default sheet names", func(t *testing.T) {
		rows := make([]any, MaxSpreadsheetRows+1)
		for i := range rows {
			rows[i] = []any{"value"}
		}
		res := toolCreateSpreadsheet(ctx, map[string]any{
			"filePath": "too-many.xlsx",
			"sheets": []any{
				map[string]any{"rows": rows},
			},
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "exceeds maximum allowed")

		writer := &fakeSpreadsheetWriter{}
		useSpreadsheetWriter(t, writer)
		res = toolCreateSpreadsheet(ctx, map[string]any{
			"filePath": "defaults.xlsx",
			"sheets": []any{
				map[string]any{"rows": []any{[]any{"A"}}},
				map[string]any{"rows": []any{"skip", []any{"B"}}},
				"skip",
			},
		})
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "defaults.xlsx"), writer.requests[0].Path)
			assert.Equal(t, []SpreadsheetSheet{
				{Name: "Sheet1", Rows: [][]any{{"A"}}},
				{Name: "Sheet2", Rows: [][]any{{"B"}}},
			}, writer.requests[0].Sheets)
		}
	})

	t.Run("preserves cell diagnostics in metadata", func(t *testing.T) {
		useSpreadsheetWriter(t, &fakeSpreadsheetWriter{})
		res := toolCreateSpreadsheet(ctx, map[string]any{
			"filePath": "diagnostics.xlsx",
			"sheets": []any{
				map[string]any{
					"name": "bad/name",
					"rows": []any{
						[]any{"A"},
					},
				},
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.NotEmpty(t, res.Metadata["cell_errors"])
	})
}
