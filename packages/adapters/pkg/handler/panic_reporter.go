package handler

import (
	"net/http"
	"sync"
)

// PanicReporter is the handler-layer port for reporting recovered panics to
// external observability systems.
type PanicReporter interface {
	ReportBackgroundPanic(name string, recovered any)
	ReportRequestPanic(r *http.Request, recovered any)
}

var (
	panicReporterMu sync.RWMutex
	panicReporter   PanicReporter = noopPanicReporter{}
)

// SetPanicReporter installs the process panic reporter used by shared handler
// adapters.
func SetPanicReporter(reporter PanicReporter) {
	if reporter == nil {
		reporter = noopPanicReporter{}
	}
	panicReporterMu.Lock()
	panicReporter = reporter
	panicReporterMu.Unlock()
}

// ResetPanicReporterForTest restores the no-op panic reporter.
func ResetPanicReporterForTest() {
	SetPanicReporter(nil)
}

func getPanicReporter() PanicReporter {
	panicReporterMu.RLock()
	reporter := panicReporter
	panicReporterMu.RUnlock()
	if reporter == nil {
		return noopPanicReporter{}
	}
	return reporter
}

type noopPanicReporter struct{}

func (noopPanicReporter) ReportBackgroundPanic(string, any)     {}
func (noopPanicReporter) ReportRequestPanic(*http.Request, any) {}
