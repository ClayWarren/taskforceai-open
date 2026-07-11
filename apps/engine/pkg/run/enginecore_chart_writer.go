package run

import (
	"context"
	"os"
	"path/filepath"
	"sync"

	enginecoretools "github.com/TaskForceAI/core/pkg/tools/enginecore"
)

type enginecoreFileChartWriter struct{}

var (
	enginecoreChartWriterMu        sync.Mutex
	enginecoreChartWriterInstalled bool
)

func installEnginecoreChartWriter() {
	enginecoreChartWriterMu.Lock()
	defer enginecoreChartWriterMu.Unlock()
	if enginecoreChartWriterInstalled {
		return
	}
	enginecoretools.SetChartWriter(enginecoreFileChartWriter{})
	enginecoreChartWriterInstalled = true
}

func (enginecoreFileChartWriter) WriteChart(_ context.Context, request enginecoretools.ChartWriteRequest) error {
	if err := os.MkdirAll(filepath.Dir(request.Path), 0o750); err != nil {
		return enginecoretools.ChartWriteError{Kind: enginecoretools.ChartWriteFailureDirectory, Err: err}
	}
	if err := os.WriteFile(request.Path, request.Content, 0o600); err != nil {
		return enginecoretools.ChartWriteError{Kind: enginecoretools.ChartWriteFailureFile, Err: err}
	}
	return nil
}
