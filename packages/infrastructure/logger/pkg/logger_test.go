package pkg

import (
	"context"
	"errors"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

type MockTransport struct {
	mock.Mock
}

func (m *MockTransport) Name() string { return "mock" }
func (m *MockTransport) Log(entry LogEntry) error {
	args := m.Called(entry)
	return args.Error(0)
}
func (m *MockTransport) Flush() error {
	args := m.Called()
	return args.Error(0)
}

func TestLogger(t *testing.T) {
	t.Run("Basic Logging", func(t *testing.T) {
		mockT := new(MockTransport)
		logger := NewLogger(LoggerOptions{
			Level:      LevelInfo,
			Transports: []LogTransport{mockT},
		})

		mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
			return e.Level == LevelInfo && e.Message == "hello"
		})).Return(nil)

		logger.Info("hello", nil)
		mockT.AssertExpectations(t)
	})

	t.Run("Level Filtering", func(t *testing.T) {
		mockT := new(MockTransport)
		logger := NewLogger(LoggerOptions{
			Level:      LevelWarn,
			Transports: []LogTransport{mockT},
		})

		// Info should be filtered out
		logger.Info("should not see this", nil)

		mockT.AssertNotCalled(t, "Log", mock.Anything)
	})

	t.Run("Child Logger Context", func(t *testing.T) {
		mockT := new(MockTransport)
		logger := NewLogger(LoggerOptions{
			Context:    map[string]any{"app": "test"},
			Transports: []LogTransport{mockT},
		})

		child := logger.Child(map[string]any{"module": "auth"})

		// New slog implementation puts context attributes into Metadata
		mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
			return e.Metadata["app"] == "test" && e.Metadata["module"] == "auth"
		})).Return(nil)

		child.Info("child log", nil)
		mockT.AssertExpectations(t)
	})

	t.Run("Flush", func(t *testing.T) {
		mockT := new(MockTransport)
		logger := NewLogger(LoggerOptions{
			Transports: []LogTransport{mockT},
		})
		mockT.On("Flush").Return(nil)
		logger.Flush()
		mockT.AssertExpectations(t)
	})

	t.Run("Flush ignores transport errors", func(t *testing.T) {
		mockT := new(MockTransport)
		logger := NewLogger(LoggerOptions{
			Transports: []LogTransport{mockT},
		})
		mockT.On("Flush").Return(errors.New("flush failed"))

		logger.Flush()

		mockT.AssertExpectations(t)
	})

	t.Run("Other levels", func(t *testing.T) {
		mockT := new(MockTransport)
		logger := NewLogger(LoggerOptions{
			Level:      LevelDebug,
			Transports: []LogTransport{mockT},
		})

		mockT.On("Log", mock.Anything).Return(nil).Times(3)

		logger.Debug("d", nil)
		logger.Warn("w", nil)
		logger.Error("e", nil)

		mockT.AssertExpectations(t)
	})

	t.Run("WithAttrs isolation", func(t *testing.T) {
		mockT := new(MockTransport)
		base := &HandlerBridge{
			transports: []LogTransport{mockT},
			level:      slog.LevelDebug,
			attrs:      make([]slog.Attr, 0, 1),
		}

		handlerA := base.WithAttrs([]slog.Attr{slog.String("a", "1")})
		handlerB := base.WithAttrs([]slog.Attr{slog.String("b", "2")})

		mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
			_, hasB := e.Metadata["b"]
			return e.Message == "from a" &&
				e.Metadata["a"] == "1" &&
				!hasB
		})).Return(nil).Once()
		mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
			_, hasA := e.Metadata["a"]
			return e.Message == "from b" &&
				e.Metadata["b"] == "2" &&
				!hasA
		})).Return(nil).Once()

		slog.New(handlerA).Log(context.Background(), slog.LevelInfo, "from a")
		slog.New(handlerB).Log(context.Background(), slog.LevelInfo, "from b")

		mockT.AssertExpectations(t)
	})

	t.Run("Slog routes through configured transports", func(t *testing.T) {
		mockT := new(MockTransport)
		logger := NewLogger(LoggerOptions{
			Context:    map[string]any{"service": "logger-test"},
			Transports: []LogTransport{mockT},
		})

		mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
			return e.Level == LevelInfo &&
				e.Message == "from slog" &&
				e.Metadata["service"] == "logger-test" &&
				e.Metadata["request_id"] == "req-123"
		})).Return(nil).Once()

		logger.Slog().Info("from slog", "request_id", "req-123")

		mockT.AssertExpectations(t)
	})

	t.Run("transport log errors are ignored", func(t *testing.T) {
		mockT := new(MockTransport)
		logger := NewLogger(LoggerOptions{
			Level:      LevelDebug,
			Transports: []LogTransport{mockT},
		})

		mockT.On("Log", mock.MatchedBy(func(e LogEntry) bool {
			return e.Level == LevelInfo && e.Message == "ignored error"
		})).Return(errors.New("log failed")).Once()

		logger.Info("ignored error", nil)

		mockT.AssertExpectations(t)
	})
}

func TestNormalizeMetadataValueHandlesSlogValuesAndGroups(t *testing.T) {
	assert.Equal(t, "value", normalizeMetadataValue(slog.StringValue("value")))
	assert.Equal(t, map[string]any{
		"nested": "value",
		"count":  int64(2),
	}, normalizeMetadataValue(slog.GroupValue(
		slog.String("nested", "value"),
		slog.Int64("count", 2),
	)))
}
