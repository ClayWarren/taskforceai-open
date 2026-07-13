package pkg

import (
	"context"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/mock"
)

func TestLogger_Context(t *testing.T) {
	mockT := new(MockTransport)
	logger := NewLogger(LoggerOptions{
		Level:      LevelDebug,
		Transports: []LogTransport{mockT},
	})

	type ctxKey string

	const requestIDKey ctxKey = "request_id"

	ctx := context.WithValue(context.Background(), requestIDKey, "12345")

	// Test SetContextExtractor
	logger.SetContextExtractor(func(ctx context.Context) []any {
		if val, ok := ctx.Value(requestIDKey).(string); ok {
			return []any{"request_id", val}
		}
		return nil
	})

	// Test InfoContext
	mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
		return e.Message == "test info context" &&
			e.Metadata["request_id"] == "12345" &&
			e.Metadata["foo"] == "bar" &&
			e.Level == LevelInfo
	})).Return(nil)

	logger.InfoContext(ctx, "test info context", "foo", "bar")

	// Test ErrorContext
	mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
		return e.Message == "test error context" &&
			e.Level == LevelError
	})).Return(nil)

	logger.ErrorContext(ctx, "test error context")

	// Test WarnContext
	mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
		return e.Message == "test warn context" &&
			e.Level == LevelWarn
	})).Return(nil)

	logger.WarnContext(ctx, "test warn context")

	// Test DebugContext
	mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
		return e.Message == "test debug context" &&
			e.Level == LevelDebug
	})).Return(nil)

	logger.DebugContext(ctx, "test debug context")

	mockT.AssertExpectations(t)
}

func TestLogger_WithGroup(t *testing.T) {
	mockT := new(MockTransport)
	// We need to construct the logger manually or use NewLogger to test WithGroup via HandlerBridge
	// Since WithGroup is not exposed on Logger, but on the handler inside, and slog.Logger supports WithGroup.
	// We can test this by accessing the underlying slog logger if possible, but the struct field is unexported.
	// However, HandlerBridge logic for WithGroup is what we want to test.

	// We can test HandlerBridge directly or rely on integration via slog.
	// But since we can't easily replace the slog logger inside Logger after creation (private field),
	// and Logger doesn't expose WithGroup, we might need to rely on `Child` which uses `With` but not `WithGroup`.

	// Wait, the coverage report shows `WithGroup` in `logger.go` has 0% coverage.
	// This method is on `*HandlerBridge`.
	// It is called by `slog.Logger.WithGroup()`.
	// If `Logger` doesn't expose a way to call `WithGroup` on its internal `slog`, then maybe we can't test it via `Logger`.

	// However, we can create a test that uses `HandlerBridge` directly.

	handler := &HandlerBridge{
		transports: []LogTransport{mockT},
		level:      slog.LevelDebug,
	}

	logger := slog.New(handler).WithGroup("mygroup")

	mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
		// WithGroup should prefix keys.
		// The implementation of HandlerBridge.Handle:
		// if h.group != "" { key = h.group + "." + key }
		val, ok := e.Metadata["mygroup.key"]
		return ok && val == "value" && e.Message == "test group"
	})).Return(nil)

	logger.Info("test group", "key", "value")

	mockT.AssertExpectations(t)
}
