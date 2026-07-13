package transports

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/logger/pkg"
	"github.com/getsentry/sentry-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSentryTransportMapping(t *testing.T) {
	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelError, pkg.LevelWarn})

	tests := []struct {
		level    pkg.LogLevel
		expected sentry.Level
	}{
		{pkg.LevelDebug, sentry.LevelDebug},
		{pkg.LevelInfo, sentry.LevelInfo},
		{pkg.LevelWarn, sentry.LevelWarning},
		{pkg.LevelError, sentry.LevelError},
		{"unknown", sentry.LevelInfo},
	}

	for _, tt := range tests {
		got := tr.mapLevel(tt.level)
		assert.Equal(t, tt.expected, got)
	}
}

func TestSentryTransportLevels(t *testing.T) {
	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelError})

	t.Run("Level allowed", func(t *testing.T) {
		err := tr.Log(pkg.LogEntry{Level: pkg.LevelError, Message: "err"})
		assert.NoError(t, err)
	})

	t.Run("Level filtered", func(t *testing.T) {
		err := tr.Log(pkg.LogEntry{Level: pkg.LevelInfo, Message: "info"})
		assert.NoError(t, err)
	})
}

func TestSentryTransport_FiltersDisallowedLevelsBeforeSending(t *testing.T) {
	mockTransport := bindMockSentryTransport(t)
	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelError})

	err := tr.Log(pkg.LogEntry{Level: pkg.LevelInfo, Message: "filtered info"})
	require.NoError(t, err)

	assert.Empty(t, mockTransport.Events())
}

func TestSentryTransport_CapturesMessageWithSanitizedContexts(t *testing.T) {
	mockTransport := bindMockSentryTransport(t)
	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelInfo})

	err := tr.Log(pkg.LogEntry{
		Level:   pkg.LevelInfo,
		Message: "info with context",
		Context: map[string]any{
			"requestId":    "req-123",
			"access_token": "secret-token",
		},
		Metadata: map[string]any{
			"component": "scheduler",
			"api_key":   "secret-key",
		},
	})
	require.NoError(t, err)

	event := requireSingleSentryEvent(t, mockTransport)
	assert.Equal(t, sentry.LevelInfo, event.Level)
	assert.Equal(t, "info with context", event.Message)
	assert.Equal(t, "info with context", event.Contexts["log"]["message"])
	assert.Equal(t, "req-123", event.Contexts["logger"]["requestId"])
	assert.Equal(t, "[REDACTED]", event.Contexts["logger"]["access_token"])
	assert.Equal(t, "scheduler", event.Contexts["metadata"]["component"])
	assert.Equal(t, "[REDACTED_API_KEY]", event.Contexts["metadata"]["api_key"])
	assert.Empty(t, event.Exception)
}

func TestSentryTransport_CapturesEntryErrorAsException(t *testing.T) {
	mockTransport := bindMockSentryTransport(t)
	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelError})
	entryErr := errors.New("database unavailable")

	err := tr.Log(pkg.LogEntry{
		Level:    pkg.LevelError,
		Message:  "error with entry err",
		Metadata: map[string]any{"component": "worker"},
		Err:      entryErr,
	})
	require.NoError(t, err)

	event := requireSingleSentryEvent(t, mockTransport)
	require.Len(t, event.Exception, 1)
	assert.Equal(t, "database unavailable", event.Exception[0].Value)
	assert.Equal(t, sentry.LevelError, event.Level)
	assert.Equal(t, "error with entry err", event.Contexts["log"]["message"])
	assert.Equal(t, "worker", event.Contexts["metadata"]["component"])
}

func TestSentryTransport_CapturesGroupedLoggerErrorAsException(t *testing.T) {
	mockTransport := bindMockSentryTransport(t)
	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelError})
	logger := pkg.NewLogger(pkg.LoggerOptions{
		Level:      pkg.LevelDebug,
		Transports: []pkg.LogTransport{tr},
	}).Slog().WithGroup("request")
	entryErr := errors.New("grouped failure")

	logger.Error("grouped sentry error", "error", entryErr)

	event := requireSingleSentryEvent(t, mockTransport)
	require.Len(t, event.Exception, 1)
	assert.Equal(t, "grouped failure", event.Exception[0].Value)
	assert.Equal(t, "grouped failure", event.Contexts["metadata"]["request.error"])
}

func TestSentryTransport_CapturesCyclicErrorWithoutUnwrapTraversal(t *testing.T) {
	mockTransport := bindMockSentryTransport(t)
	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelError})
	entryErr := cyclicError{}

	err := tr.Log(pkg.LogEntry{
		Level:   pkg.LevelError,
		Message: "cyclic error",
		Err:     entryErr,
	})
	require.NoError(t, err)

	event := requireSingleSentryEvent(t, mockTransport)
	require.Len(t, event.Exception, 1)
	assert.Equal(t, "cyclic error", event.Exception[0].Value)
}

func TestSentryTransport_FallsBackToRawContextsWhenSanitizerChangesType(t *testing.T) {
	mockTransport := bindMockSentryTransport(t)
	previous := sanitizeSentryValue
	sanitizeSentryValue = func(any) any {
		return "not a context map"
	}
	t.Cleanup(func() {
		sanitizeSentryValue = previous
	})

	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelInfo})
	err := tr.Log(pkg.LogEntry{
		Level:   pkg.LevelInfo,
		Message: "fallback context",
		Context: map[string]any{
			"requestId": "req-123",
		},
		Metadata: map[string]any{
			"component": "scheduler",
		},
	})
	require.NoError(t, err)

	event := requireSingleSentryEvent(t, mockTransport)
	assert.Equal(t, "req-123", event.Contexts["logger"]["requestId"])
	assert.Equal(t, "scheduler", event.Contexts["metadata"]["component"])
}

type cyclicError struct{}

func (cyclicError) Error() string {
	return "cyclic error"
}

func (err cyclicError) Unwrap() error {
	return err
}

type panicError struct{}

func (panicError) Error() string {
	panic("boom")
}

func TestSentrySafeErrorHandlesNilAndPanickingError(t *testing.T) {
	require.NoError(t, sentrySafeError(nil))
	require.EqualError(t, sentrySafeError(panicError{}), "error string unavailable: boom")
}

func TestSentryTransport_DefaultLevels(t *testing.T) {
	// Empty levels should default to error only
	tr := NewSentryTransport(nil)
	assert.NotNil(t, tr)

	// Error level should be enabled by default
	err := tr.Log(pkg.LogEntry{Level: pkg.LevelError, Message: "default error"})
	assert.NoError(t, err)
}

func TestSentryTransport_Name(t *testing.T) {
	tr := NewSentryTransport(nil)
	assert.Equal(t, "sentry", tr.Name())
}

func TestSentryTransport_Flush(t *testing.T) {
	tr := NewSentryTransport(nil)
	err := tr.Flush()
	assert.NoError(t, err)
}

func TestSentryTransport_LogWithContext(t *testing.T) {
	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelError})

	err := tr.Log(pkg.LogEntry{
		Level:   pkg.LevelError,
		Message: "error with context",
		Context: map[string]any{"requestId": "123"},
	})
	assert.NoError(t, err)
}

func TestSentryTransport_LogWithMetadata(t *testing.T) {
	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelError})

	err := tr.Log(pkg.LogEntry{
		Level:    pkg.LevelError,
		Message:  "error with metadata",
		Metadata: map[string]any{"key": "value"},
	})
	assert.NoError(t, err)
}

func TestSentryTransport_LogWithErrorMetadata(t *testing.T) {
	mockTransport := bindMockSentryTransport(t)
	tr := NewSentryTransport([]pkg.LogLevel{pkg.LevelError})

	err := tr.Log(pkg.LogEntry{
		Level:    pkg.LevelError,
		Message:  "error with error metadata",
		Metadata: map[string]any{"error": errors.New("test error")},
	})
	require.NoError(t, err)

	event := requireSingleSentryEvent(t, mockTransport)
	assert.Equal(t, "error with error metadata", event.Message)
	assert.Empty(t, event.Exception)
}

func bindMockSentryTransport(t *testing.T) *sentry.MockTransport {
	t.Helper()

	mockTransport := &sentry.MockTransport{}
	client, err := sentry.NewClient(sentry.ClientOptions{
		Dsn:       "https://public@example.com/1",
		Transport: mockTransport,
	})
	require.NoError(t, err)

	hub := sentry.CurrentHub()
	previousClient := hub.Client()
	hub.BindClient(client)
	t.Cleanup(func() {
		hub.BindClient(previousClient)
		mockTransport.Flush(time.Second)
		mockTransport.FlushWithContext(context.Background())
	})

	return mockTransport
}

func requireSingleSentryEvent(t *testing.T, transport *sentry.MockTransport) *sentry.Event {
	t.Helper()

	events := transport.Events()
	require.Len(t, events, 1)
	return events[0]
}
