package artifacts

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
		res := ExecuteSpreadsheet(ctx, args)
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
		res := ExecuteSpreadsheet(ctx, nil)
		assert.Equal(t, "error", res.Status)
	})

	t.Run("row limit and default sheet names", func(t *testing.T) {
		rows := make([]any, MaxSpreadsheetRows+1)
		for i := range rows {
			rows[i] = []any{"value"}
		}
		res := ExecuteSpreadsheet(ctx, map[string]any{
			"filePath": "too-many.xlsx",
			"sheets": []any{
				map[string]any{"rows": rows},
			},
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "exceeds maximum allowed")

		writer := &fakeSpreadsheetWriter{}
		useSpreadsheetWriter(t, writer)
		res = ExecuteSpreadsheet(ctx, map[string]any{
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
		res := ExecuteSpreadsheet(ctx, map[string]any{
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

func TestValidateSpreadsheetSizeLimits(t *testing.T) {
	baseLimits := spreadsheetSizeLimits{
		sheets:       2,
		rows:         2,
		columns:      2,
		cells:        3,
		cellBytes:    8,
		payloadBytes: 10,
	}

	tests := []struct {
		name    string
		sheets  []any
		limits  spreadsheetSizeLimits
		message string
	}{
		{
			name:    "sheet count",
			sheets:  []any{map[string]any{}, map[string]any{}, map[string]any{}},
			limits:  baseLimits,
			message: "sheet count",
		},
		{
			name: "row count",
			sheets: []any{map[string]any{"rows": []any{
				[]any{"a"}, []any{"b"}, []any{"c"},
			}}},
			limits:  baseLimits,
			message: "total rows",
		},
		{
			name:    "column count",
			sheets:  []any{map[string]any{"rows": []any{[]any{"a", "b", "c"}}}},
			limits:  baseLimits,
			message: "has 3 cells",
		},
		{
			name: "total cell count",
			sheets: []any{map[string]any{"rows": []any{
				[]any{"a", "b"}, []any{"c", "d"},
			}}},
			limits:  baseLimits,
			message: "total cells",
		},
		{
			name:    "unsupported cell value",
			sheets:  []any{map[string]any{"rows": []any{[]any{make(chan int)}}}},
			limits:  baseLimits,
			message: "unsupported value",
		},
		{
			name:    "individual cell bytes",
			sheets:  []any{map[string]any{"rows": []any{[]any{"1234567"}}}},
			limits:  baseLimits,
			message: "maximum serialized size (8 bytes)",
		},
		{
			name: "total payload bytes",
			sheets: []any{map[string]any{"rows": []any{
				[]any{"1234", "5678"},
			}}},
			limits:  baseLimits,
			message: "spreadsheet cell payload",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateSpreadsheetSizeWithLimits(test.sheets, test.limits)
			assert.ErrorContains(t, err, test.message)
		})
	}

	assert.NoError(t, validateSpreadsheetSizeWithLimits([]any{
		"ignored",
		map[string]any{"rows": "ignored"},
	}, baseLimits))
	assert.NoError(t, validateSpreadsheetSizeWithLimits([]any{
		map[string]any{"rows": []any{"ignored", []any{"ok"}}},
	}, baseLimits))
}
