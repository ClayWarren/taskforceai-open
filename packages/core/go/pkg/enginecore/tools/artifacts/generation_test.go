package artifacts

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFileGenerationTools(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "tooltest")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.RemoveAll(tmpDir); err != nil {
			t.Logf("failed to remove temp dir: %v", err)
		}
	}()

	ctx := protocol.ToolContext{
		Cwd:       tmpDir,
		ReadFiles: make(map[string]bool),
	}

	t.Run("create_spreadsheet", func(t *testing.T) {
		writer := &fakeSpreadsheetWriter{}
		useSpreadsheetWriter(t, writer)
		args := map[string]any{
			"filePath": "test.xlsx",
			"sheets": []any{
				map[string]any{
					"name": "Data",
					"rows": []any{
						[]any{"Name", "Value"},
						[]any{"Item 1", 100},
					},
				},
			},
		}
		res := ExecuteSpreadsheet(ctx, args)
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "test.xlsx"), writer.requests[0].Path)
			if err := os.WriteFile(writer.requests[0].Path, []byte("spreadsheet fixture"), 0o600); err != nil {
				t.Fatalf("write spreadsheet fixture for archive: %v", err)
			}
		}
	})

	t.Run("create_csv", func(t *testing.T) {
		writer := &fakeCSVFileWriter{}
		useCSVFileWriter(t, writer)
		args := map[string]any{
			"filePath": "test.csv",
			"rows": []any{
				[]any{"ID", "Score"},
				[]any{1, 95.5},
			},
		}
		res := ExecuteCSV(ctx, args)
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "test.csv"), writer.requests[0].Path)
			require.NotEmpty(t, writer.contents)
			assert.Contains(t, string(writer.contents[0]), "ID,Score")
			if err := os.WriteFile(writer.requests[0].Path, writer.contents[0], 0o600); err != nil {
				t.Fatalf("write captured CSV for archive fixture: %v", err)
			}
		}
	})

	t.Run("create_archive", func(t *testing.T) {
		// Depends on files created above
		writer := &fakeArchiveFileWriter{useEntryCount: true}
		useArchiveWriter(t, writer)
		args := map[string]any{
			"filePath": "bundle.zip",
			"files":    []any{"test.xlsx", "test.csv"},
		}
		res := ExecuteArchive(ctx, args)
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "bundle.zip"), writer.requests[0].Path)
			assert.Len(t, writer.requests[0].Entries, 2)
		}
	})

	t.Run("create_pdf", func(t *testing.T) {
		writer := &fakePDFWriter{}
		usePDFWriter(t, writer)
		args := map[string]any{
			"filePath": "report.pdf",
			"title":    "Monthly Report",
			"sections": []any{
				map[string]any{
					"heading": "Introduction",
					"content": "This is a test PDF report.",
				},
			},
		}
		res := ExecutePDF(ctx, args)
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "report.pdf"), writer.requests[0].Path)
		}
	})

	t.Run("create_chart", func(t *testing.T) {
		writer := &fakeChartWriter{}
		useChartWriter(t, writer)
		args := map[string]any{
			"filePath": "chart.png",
			"type":     "bar",
			"title":    "Sales",
			"data": []any{
				map[string]any{"label": "A", "value": 10},
				map[string]any{"label": "B", "value": 20},
			},
		}
		res := ExecuteChart(ctx, args)
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "chart.png"), writer.requests[0].Path)
			assert.NotEmpty(t, writer.requests[0].Content)
		}
	})

	t.Run("create_site", func(t *testing.T) {
		writer := &fakeSiteWriter{}
		useSiteWriter(t, writer)
		args := map[string]any{
			"filePath": "review.html",
			"title":    "Customer Review",
			"html":     "<!doctype html><html><head><title>Customer Review</title></head><body><button>Decide</button></body></html>",
		}
		res := ExecuteSite(ctx, args)
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, filepath.Join(tmpDir, "review.html"), writer.request.Path)
		assert.Contains(t, string(writer.request.Content), "<button>Decide</button>")
	})

	t.Run("create_site validation and write errors", func(t *testing.T) {
		tests := []struct {
			name string
			args map[string]any
			want string
		}{
			{
				name: "missing file path",
				args: map[string]any{"html": "<html></html>"},
				want: "missing filePath",
			},
			{
				name: "non html extension",
				args: map[string]any{"filePath": "review.txt", "html": "<html></html>"},
				want: "filePath must end in .html or .htm",
			},
			{
				name: "missing html",
				args: map[string]any{"filePath": "empty.html", "html": "   "},
				want: "missing html",
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				res := ExecuteSite(ctx, tt.args)
				assert.Equal(t, "error", res.Status)
				assert.Contains(t, res.Error, tt.want)
			})
		}

		useSiteWriter(t, &fakeSiteWriter{err: errors.New("write failed")})
		res := ExecuteSite(ctx, map[string]any{
			"filePath": "blocked.html",
			"html":     "<html></html>",
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "Error saving site")

		writer := &fakeSiteWriter{}
		useSiteWriter(t, writer)
		res = ExecuteSite(ctx, map[string]any{
			"filePath": "review.htm",
			"title":    "Short Extension",
			"html":     "<!doctype html><html></html>",
		})
		assert.Equal(t, "completed", res.Status)
		assert.Equal(t, "Short Extension", res.Metadata["title"])
		assert.Equal(t, filepath.Join(tmpDir, "review.htm"), writer.request.Path)
	})
}
