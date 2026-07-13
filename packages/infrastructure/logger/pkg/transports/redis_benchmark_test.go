package transports

import (
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/logger/pkg"
)

func BenchmarkRedisTransportLogWithTrim(b *testing.B) {
	transport, _ := newTestRedisTransport(b)
	transport.maxEntries = defaultRedisMaxEntries
	benchmarkRedisTransportLog(b, transport)
}

func BenchmarkRedisTransportLogWithoutTrim(b *testing.B) {
	transport, _ := newTestRedisTransport(b)
	transport.maxEntries = 0
	benchmarkRedisTransportLog(b, transport)
}

func benchmarkRedisTransportLog(b *testing.B, transport *RedisTransport) {
	entry := pkg.LogEntry{
		Level:     pkg.LevelInfo,
		Message:   "redis benchmark",
		Timestamp: time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
		Metadata: map[string]any{
			"task_id": "task-123",
			"queue":   "default",
			"attempt": 2,
		},
	}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if err := transport.Log(entry); err != nil && !errors.Is(err, ErrRedisLogQueueFull) {
			b.Fatal(err)
		}
	}
	if err := transport.Flush(); err != nil {
		b.Fatal(err)
	}
}
