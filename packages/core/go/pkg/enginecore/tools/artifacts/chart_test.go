package artifacts

import (
	"context"
	"io"
	"path/filepath"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeChartWriter struct {
	err      error
	requests []ChartWriteRequest
}

func (w *fakeChartWriter) WriteChart(_ context.Context, request ChartWriteRequest) error {
	w.requests = append(w.requests, request)
	return w.err
}

func useChartWriter(t *testing.T, writer ChartWriter) {
	t.Helper()
	restore := SetChartWriter(writer)
	t.Cleanup(restore)
}

func TestToolCreateChart(t *testing.T) {
	assert.Equal(t, float64(3), toFloat(3))
	tmpDir := t.TempDir()

	ctx := protocol.ToolContext{
		Ctx: context.Background(),
		Cwd: tmpDir,
	}

	t.Run("bar chart success", func(t *testing.T) {
		writer := &fakeChartWriter{}
		useChartWriter(t, writer)
		args := map[string]any{
			"filePath": "chart.png",
			"type":     "bar",
			"title":    "Test Chart",
			"data": []any{
				map[string]any{"label": "A", "value": 10.0},
				map[string]any{"label": "B", "value": 20.0},
			},
		}
		res := ExecuteChart(ctx, args)
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "chart.png"), writer.requests[0].Path)
			assert.NotEmpty(t, writer.requests[0].Content)
		}
	})

	t.Run("pie chart success", func(t *testing.T) {
		writer := &fakeChartWriter{}
		useChartWriter(t, writer)
		args := map[string]any{
			"filePath": "reports/charts/pie.svg",
			"type":     "pie",
			"data": []any{
				map[string]any{"label": "X", "value": 50.0},
			},
		}
		res := ExecuteChart(ctx, args)
		assert.Equal(t, "completed", res.Status)
		if assert.Len(t, writer.requests, 1) {
			assert.Equal(t, filepath.Join(tmpDir, "reports", "charts", "pie.svg"), writer.requests[0].Path)
			assert.Contains(t, string(writer.requests[0].Content), "<svg")
		}
	})

	t.Run("invalid args and mixed values", func(t *testing.T) {
		assert.Equal(t, "error", ExecuteChart(ctx, map[string]any{}).Status)
		assert.Equal(t, "error", ExecuteChart(ctx, map[string]any{"filePath": "chart.png"}).Status)
		writer := &fakeChartWriter{}
		useChartWriter(t, writer)
		res := ExecuteChart(ctx, map[string]any{
			"filePath": "mixed.png",
			"data": []any{
				map[string]any{"label": "int", "value": 1},
				map[string]any{"label": "int64", "value": int64(2)},
				map[string]any{"label": "bad", "value": "x"},
				"skip",
			},
		})
		assert.Equal(t, "completed", res.Status)
		assert.Len(t, writer.requests, 1)
	})

	t.Run("render and writer errors", func(t *testing.T) {
		res := ExecuteChart(ctx, map[string]any{
			"filePath": "empty-values.png",
			"data":     []any{"skip"},
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "missing chart values")

		useChartWriter(t, &fakeChartWriter{
			err: ChartWriteError{Kind: ChartWriteFailureFile, Err: assert.AnError},
		})
		res = ExecuteChart(ctx, map[string]any{
			"filePath": "blocked-chart.png",
			"data": []any{
				map[string]any{"label": "A", "value": 1},
			},
		})
		assert.Equal(t, "error", res.Status)
		assert.Contains(t, res.Error, "Error creating chart file")
	})

	t.Run("render rejects empty values", func(t *testing.T) {
		err := renderChart("bar", "Empty", nil, false, io.Discard)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing chart values")
	})
}
