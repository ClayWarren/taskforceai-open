package run

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnginecoreFileChartWriter(t *testing.T) {
	tmpDir := t.TempDir()
	target := filepath.Join(tmpDir, "reports", "chart.svg")

	err := (enginecoreFileChartWriter{}).WriteChart(context.Background(), enginecoretools.ChartWriteRequest{
		Path:    target,
		Content: []byte("<svg></svg>"),
	})
	require.NoError(t, err)
	assert.FileExists(t, target)
}

func TestEnginecoreFileChartWriterDirectoryError(t *testing.T) {
	tmpDir := t.TempDir()
	blocker := filepath.Join(tmpDir, "blocked")
	require.NoError(t, os.WriteFile(blocker, []byte("not a directory"), 0o600))

	err := (enginecoreFileChartWriter{}).WriteChart(context.Background(), enginecoretools.ChartWriteRequest{
		Path:    filepath.Join(blocker, "chart.svg"),
		Content: []byte("<svg></svg>"),
	})
	var writeErr enginecoretools.ChartWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.ChartWriteFailureDirectory, writeErr.Kind)
}

func TestEnginecoreFileChartWriterFileError(t *testing.T) {
	target := filepath.Join(t.TempDir(), "chart.svg")
	require.NoError(t, os.Mkdir(target, 0o750))

	err := (enginecoreFileChartWriter{}).WriteChart(context.Background(), enginecoretools.ChartWriteRequest{
		Path:    target,
		Content: []byte("<svg></svg>"),
	})
	var writeErr enginecoretools.ChartWriteError
	require.ErrorAs(t, err, &writeErr)
	assert.Equal(t, enginecoretools.ChartWriteFailureFile, writeErr.Kind)
}
