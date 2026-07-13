package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestWithBackgroundRecoveryRunsFunction(t *testing.T) {
	called := false
	WithBackgroundRecovery("test", func() {
		called = true
	})

	if !called {
		t.Fatal("expected wrapped function to run")
	}
}

func TestWithBackgroundRecoveryRecoversPanic(t *testing.T) {
	reporter := &testBackgroundPanicReporter{}
	SetPanicReporter(reporter)
	t.Cleanup(ResetPanicReporterForTest)

	WithBackgroundRecovery("panic-test", func() {
		panic("boom")
	})

	assert.Equal(t, "panic-test", reporter.name)
	assert.Equal(t, "boom", reporter.recovered)
}

func TestNoopPanicReporterAndNilGuard(t *testing.T) {
	t.Cleanup(ResetPanicReporterForTest)

	// The no-op reporter must accept both entry points without panicking.
	assert.NotPanics(t, func() {
		reporter := noopPanicReporter{}
		reporter.ReportBackgroundPanic("worker", "boom")
		reporter.ReportRequestPanic(httptest.NewRequest(http.MethodGet, "/", nil), "boom")
	})

	// A nil installed reporter falls back to the no-op reporter.
	panicReporterMu.Lock()
	panicReporter = nil
	panicReporterMu.Unlock()
	assert.NotNil(t, getPanicReporter())
}

func TestGoRunsFunctionWithRecovery(t *testing.T) {
	done := make(chan struct{})

	Go("async-test", func() {
		close(done)
	})

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("expected background function to run")
	}
}

type testBackgroundPanicReporter struct {
	name             string
	recovered        any
	request          *http.Request
	requestRecovered any
}

func (r *testBackgroundPanicReporter) ReportBackgroundPanic(name string, recovered any) {
	r.name = name
	r.recovered = recovered
}

func (r *testBackgroundPanicReporter) ReportRequestPanic(request *http.Request, recovered any) {
	r.request = request
	r.requestRecovered = recovered
}
