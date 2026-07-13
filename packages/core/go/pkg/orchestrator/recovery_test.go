package orchestrator

import "testing"

type stubBackgroundPanicReporter struct {
	name      string
	recovered any
}

func (s *stubBackgroundPanicReporter) ReportBackgroundPanic(name string, recovered any) {
	s.name = name
	s.recovered = recovered
}

func TestWithBackgroundRecovery(t *testing.T) {
	ran := false
	withBackgroundRecovery("ok", nil, func() {
		ran = true
	})
	if !ran {
		t.Fatalf("expected wrapped function to run")
	}

	reporter := &stubBackgroundPanicReporter{}
	withBackgroundRecovery("panic", reporter, func() {
		panic("boom")
	})
	if reporter.name != "panic" {
		t.Fatalf("expected panic reporter to receive name, got %q", reporter.name)
	}
	if reporter.recovered != "boom" {
		t.Fatalf("expected panic reporter to receive recovered value, got %#v", reporter.recovered)
	}
}
