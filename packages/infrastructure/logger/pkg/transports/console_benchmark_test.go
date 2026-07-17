package transports

import (
	"os"
	"testing"
	"time"

	"github.com/TaskForceAI/logger/pkg"
)

func BenchmarkConsoleTransportLogInfo(b *testing.B) {
	benchmarkConsoleTransportLog(b, pkg.LevelInfo)
}

func BenchmarkConsoleTransportLogWarn(b *testing.B) {
	benchmarkConsoleTransportLog(b, pkg.LevelWarn)
}

func benchmarkConsoleTransportLog(b *testing.B, level pkg.LogLevel) {
	devNull, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if err != nil {
		b.Fatal(err)
	}
	defer devNull.Close()

	originalStdout := os.Stdout
	originalStderr := os.Stderr
	os.Stdout = devNull
	os.Stderr = devNull
	defer func() {
		os.Stdout = originalStdout
		os.Stderr = originalStderr
	}()

	transport := NewConsoleTransport()
	entry := pkg.LogEntry{
		Level:     level,
		Message:   "console benchmark",
		Timestamp: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
		Metadata: map[string]any{
			"task_id": "task-123",
			"queue":   "default",
			"attempt": 2,
		},
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if err := transport.Log(entry); err != nil {
			b.Fatal(err)
		}
	}
}
