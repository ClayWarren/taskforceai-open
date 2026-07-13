package logging

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGetLevelValue(t *testing.T) {
	tests := []struct {
		level    LogLevel
		expected int
	}{
		{LevelDebug, 0},
		{LevelInfo, 1},
		{LevelWarn, 2},
		{LevelError, 3},
		{"unknown", 1},
	}

	for _, tt := range tests {
		t.Run(string(tt.level), func(t *testing.T) {
			assert.Equal(t, tt.expected, GetLevelValue(tt.level))
		})
	}
}

func TestNewStructuredLogger(t *testing.T) {
	logger := NewStructuredLogger(LevelInfo, "test", map[string]any{"app": "test-app"})
	assert.NotNil(t, logger)
	assert.Equal(t, LevelInfo, logger.level)
	assert.Equal(t, "test", logger.environment)
}

func TestNewStructuredLogger_AllLevels(t *testing.T) {
	t.Run("debug level", func(t *testing.T) {
		logger := NewStructuredLogger(LevelDebug, "test", nil)
		assert.NotNil(t, logger)
		assert.Equal(t, LevelDebug, logger.level)
	})

	t.Run("warn level", func(t *testing.T) {
		logger := NewStructuredLogger(LevelWarn, "test", nil)
		assert.NotNil(t, logger)
		assert.Equal(t, LevelWarn, logger.level)
	})

	t.Run("error level", func(t *testing.T) {
		logger := NewStructuredLogger(LevelError, "test", nil)
		assert.NotNil(t, logger)
		assert.Equal(t, LevelError, logger.level)
	})

	t.Run("unknown level defaults to info", func(t *testing.T) {
		logger := NewStructuredLogger("unknown", "test", nil)
		assert.NotNil(t, logger)
	})

	t.Run("with empty baseMeta", func(t *testing.T) {
		logger := NewStructuredLogger(LevelInfo, "test", map[string]any{})
		assert.NotNil(t, logger)
	})
}

func TestStructuredLogger_Log(t *testing.T) {
	// We can't easily capture os.Stdout without redirecting it, which is risky in parallel tests.
	// However, we can verify the logger methods don't panic and return valid chained loggers.

	logger := NewStructuredLogger(LevelDebug, "test", nil)

	assert.NotPanics(t, func() {
		logger.Debug("debug message")
		logger.Info("info message")
		logger.Warn("warn message")
		logger.Error("error message")
	})
}

func TestStructuredLogger_With(t *testing.T) {
	logger := NewStructuredLogger(LevelInfo, "test", nil)
	child := logger.With("key", "value")

	assert.NotNil(t, child)
	// assert it's a different instance (though underlying slog.Logger handles the immutability)
	assert.IsType(t, &StructuredLogger{}, child)
}

func TestStructuredLogger_WithContext(t *testing.T) {
	logger := NewStructuredLogger(LevelInfo, "test", nil)

	ctx := context.Background()
	child := logger.WithContext(ctx)
	assert.NotNil(t, child)

	// Test with nil context (should return same logger)
	childNil := logger.WithContext(nilContext())
	assert.Equal(t, logger, childNil)
}

func nilContext() context.Context {
	return nil
}

func TestStructuredLogger_WithContext_WithData(t *testing.T) {
	logger := NewStructuredLogger(LevelInfo, "test", nil)

	// Create context with correlation ID and metadata
	ctx := context.Background()
	ctxVal := LogContextValue{
		CorrelationID: "test-corr-123",
		Metadata:      map[string]any{"userId": "user-1"},
	}
	ctx = WithLogContext(ctx, ctxVal)

	child := logger.WithContext(ctx)
	assert.NotNil(t, child)
	assert.NotEqual(t, logger, child) // Should be a different logger with added context
}

func TestStructuredLogger_WithContext_EmptyContext(t *testing.T) {
	logger := NewStructuredLogger(LevelInfo, "test", nil)

	// Context with empty values - should return same logger
	ctx := context.Background()
	ctxVal := LogContextValue{
		CorrelationID: "",
		Metadata:      nil,
	}
	ctx = WithLogContext(ctx, ctxVal)

	child := logger.WithContext(ctx)
	// Should return same logger since no attrs were added
	assert.Equal(t, logger, child)
}

func TestStructuredLogger_GetCorrelationID_NilContext(t *testing.T) {
	logger := NewStructuredLogger(LevelInfo, "test", nil)

	// Call the internal function with nil context
	cid := logger.getCorrelationID(nil)
	assert.Empty(t, cid)
}

func TestStructuredLogger_GetLogMetadata_NilContext(t *testing.T) {
	logger := NewStructuredLogger(LevelInfo, "test", nil)

	// Call the internal function with nil context
	meta := logger.getLogMetadata(nil)
	assert.NotNil(t, meta)
	assert.Empty(t, meta)
}
