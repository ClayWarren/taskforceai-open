package artifacts

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestArtifactFamilyBoundaryEdges(t *testing.T) {
	root := t.TempDir()
	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: root}

	t.Run("archive skips malformed and external entries", func(t *testing.T) {
		useArchiveWriter(t, &fakeArchiveFileWriter{useEntryCount: true})
		malformed := ExecuteArchive(ctx, map[string]any{
			"filePath": "malformed.zip",
			"files":    []any{1, ""},
		})
		assert.Equal(t, "error", malformed.Status)

		external := filepath.Join(t.TempDir(), "outside.txt")
		externalRelative, err := filepath.Rel(root, external)
		require.NoError(t, err)
		denied := ExecuteArchive(ctx, map[string]any{
			"filePath": "external.zip",
			"files":    []any{externalRelative},
		})
		assert.Equal(t, "error", denied.Status)
	})

	t.Run("chart renders every format and chart branch", func(t *testing.T) {
		writer := &fakeChartWriter{}
		useChartWriter(t, writer)
		data := []any{
			map[string]any{"label": "A", "value": 3},
			map[string]any{"label": "B", "value": 1},
		}
		bar := ExecuteChart(ctx, map[string]any{
			"filePath": "bar.svg",
			"type":     "bar",
			"title":    "Bar <Title>",
			"data":     data,
		})
		assert.Equal(t, "completed", bar.Status)
		pie := ExecuteChart(ctx, map[string]any{
			"filePath": "pie.png",
			"type":     "pie",
			"data":     data,
		})
		assert.Equal(t, "completed", pie.Status)
		assert.Len(t, writer.requests, 2)
	})

	t.Run("generated outputs fail closed outside the workspace", func(t *testing.T) {
		outsideRoot := t.TempDir()
		outsideRelative, err := filepath.Rel(root, outsideRoot)
		require.NoError(t, err)

		csv := ExecuteCSV(ctx, map[string]any{
			"filePath": filepath.Join(outsideRelative, "data.csv"),
			"rows":     []any{[]any{"a"}},
		})
		assert.Equal(t, "error", csv.Status)

		presentation := ExecutePresentation(ctx, map[string]any{
			"filePath": filepath.Join(outsideRelative, "slides.pptx"),
			"slides":   []any{map[string]any{"title": "A"}},
		})
		assert.Equal(t, "error", presentation.Status)

		assert.Equal(t, "error", ExecuteSpreadsheet(ctx, map[string]any{"filePath": "empty.xlsx"}).Status)
		spreadsheet := ExecuteSpreadsheet(ctx, map[string]any{
			"filePath": filepath.Join(outsideRelative, "book.xlsx"),
			"sheets":   []any{map[string]any{"rows": []any{[]any{"a"}}}},
		})
		assert.Equal(t, "error", spreadsheet.Status)
	})
}
