package pkg

import (
	"context"
	"log/slog"
	"testing"
)

type benchmarkTransport struct {
	entry LogEntry
}

func (t *benchmarkTransport) Name() string { return "benchmark" }

func (t *benchmarkTransport) Log(entry LogEntry) error {
	t.entry = entry
	return nil
}

func (t *benchmarkTransport) Flush() error { return nil }

func BenchmarkLoggerInfoPlainMetadata(b *testing.B) {
	transport := &benchmarkTransport{}
	logger := NewLogger(LoggerOptions{
		Level:      LevelInfo,
		Transports: []LogTransport{transport},
	})

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		logger.Info("task scheduled", map[string]any{
			"task_id": "task-123",
			"queue":   "default",
			"attempt": i % 3,
		})
	}
}

func BenchmarkLoggerInfoContextExtractor(b *testing.B) {
	type ctxKey string
	const requestIDKey ctxKey = "request_id"

	transport := &benchmarkTransport{}
	logger := NewLogger(LoggerOptions{
		Level:      LevelInfo,
		Transports: []LogTransport{transport},
	})
	logger.SetContextExtractor(func(ctx context.Context) []any {
		if val, ok := ctx.Value(requestIDKey).(string); ok {
			return []any{"request_id", val}
		}
		return nil
	})
	ctx := context.WithValue(context.Background(), requestIDKey, "req-123")

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		logger.InfoContext(ctx, "task heartbeat", "task_id", "task-123")
	}
}

func BenchmarkHandlerBridgeInheritedAttrs(b *testing.B) {
	transport := &benchmarkTransport{}
	logger := slog.New(&HandlerBridge{
		transports: []LogTransport{transport},
		level:      slog.LevelInfo,
	}).With(
		"service", "engine",
		"component", "runner",
		"region", "iad1",
	)

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		logger.Info("task completed", "task_id", "task-123", "duration_ms", 42)
	}
}

func BenchmarkHandlerBridgeGroupedAttrs(b *testing.B) {
	transport := &benchmarkTransport{}
	logger := slog.New(&HandlerBridge{
		transports: []LogTransport{transport},
		level:      slog.LevelInfo,
	}).WithGroup("task")

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		logger.Info(
			"grouped task",
			slog.Group("run", "id", "run-123", "step", "sync", "attempt", i%3),
		)
	}
}

func BenchmarkLoggerSensitiveMetadata(b *testing.B) {
	transport := &benchmarkTransport{}
	logger := NewLogger(LoggerOptions{
		Level:      LevelInfo,
		Transports: []LogTransport{transport},
	})

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		logger.Info("token leak", map[string]any{
			"access_token": "secret-token-value",
			"task_id":      "task-123",
			"email":        "owner@example.com",
		})
	}
}
