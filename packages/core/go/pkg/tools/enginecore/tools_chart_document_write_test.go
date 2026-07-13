package tools

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
)

func TestChartDocumentWriteRemainingCoverageGapPaths(t *testing.T) {
	tmpDir := t.TempDir()
	ctx := protocol.ToolContext{Ctx: context.Background(), Cwd: tmpDir, ReadFiles: map[string]bool{}}

	t.Run("write creates new files successfully", func(t *testing.T) {
		res := toolWrite(ctx, map[string]any{
			"filePath": "created.txt",
			"content":  "hello world",
		})
		assert.Equal(t, "completed", res.Status)
		assert.True(t, res.TitleSet)
	})

	t.Run("chart bar and pie success", func(t *testing.T) {
		data := []any{
			map[string]any{"label": "A", "value": 1},
			map[string]any{"label": "B", "value": 2},
			"skip",
		}
		writer := &fakeChartWriter{}
		useChartWriter(t, writer)
		bar := toolCreateChart(ctx, map[string]any{
			"filePath": "chart.png",
			"type":     "bar",
			"title":    "Counts",
			"data":     data,
		})
		assert.Equal(t, "completed", bar.Status)

		pie := toolCreateChart(ctx, map[string]any{
			"filePath": "chart.svg",
			"type":     "pie",
			"title":    "Share",
			"data":     data,
		})
		assert.Equal(t, "completed", pie.Status)
		assert.Len(t, writer.requests, 2)
	})

	t.Run("document success", func(t *testing.T) {
		writer := &fakeDocumentWriter{}
		useDocumentWriter(t, writer)
		res := toolCreateDocument(ctx, map[string]any{
			"filePath": "doc.docx",
			"title":    "Report",
			"sections": []any{
				map[string]any{"heading": "Intro", "content": "Welcome"},
				"skip",
				map[string]any{"content": "Body only"},
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.Len(t, writer.requests, 1)
	})

	t.Run("webfetch connection failure", func(t *testing.T) {
		res := toolWebFetch(ctx, map[string]any{"url": "http://invalid.invalid.example/"})
		assert.Equal(t, "error", res.Status)
	})
}
