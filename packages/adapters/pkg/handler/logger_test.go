package handler

import (
	"context"
	"log/slog"
	"sync/atomic"
	"testing"

	adapterlogging "github.com/TaskForceAI/adapters/pkg/logging"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testLogger struct {
	calls atomic.Int32
}

func (l *testLogger) Debug(string, map[string]any) { l.calls.Add(1) }
func (l *testLogger) Info(string, map[string]any)  { l.calls.Add(1) }
func (l *testLogger) Warn(string, map[string]any)  { l.calls.Add(1) }
func (l *testLogger) Error(string, map[string]any) { l.calls.Add(1) }
func (l *testLogger) DebugContext(context.Context, string, ...any) {
	l.calls.Add(1)
}
func (l *testLogger) InfoContext(context.Context, string, ...any) {
	l.calls.Add(1)
}
func (l *testLogger) WarnContext(context.Context, string, ...any) {
	l.calls.Add(1)
}
func (l *testLogger) ErrorContext(context.Context, string, ...any) {
	l.calls.Add(1)
}
func (l *testLogger) Flush() {}
func (l *testLogger) Slog() *slog.Logger {
	return slog.Default()
}

func TestGetLoggerUsesInstalledLogger(t *testing.T) {
	t.Cleanup(ResetLoggerForTest)

	logger := &testLogger{}
	SetLogger(logger)

	GetLogger().Info("installed logger", nil)
	require.Equal(t, int32(1), logger.calls.Load())
}

func TestSetLoggerNilRestoresFallback(t *testing.T) {
	t.Cleanup(ResetLoggerForTest)

	SetLogger(nil)
	logger := GetLogger()

	require.NotNil(t, logger)
	assert.NotPanics(t, func() {
		logger.Info("fallback logger", map[string]any{"email": "user@example.com"})
		logger.WarnContext(context.Background(), "fallback context logger", "key", "value")
	})
}

func TestFallbackLoggerMethods(t *testing.T) {
	fb := newFallbackLogger()
	assert.NotPanics(t, func() {
		fb.Debug("debug", map[string]any{"k": "v"})
		fb.DebugContext(context.Background(), "debug-ctx", "k", "v")
		fb.Flush()
	})
	assert.NotNil(t, fb.Slog())

	// A zero-value fallbackLogger has no inner logger and must route to the
	// slog default instead of panicking.
	empty := &fallbackLogger{}
	assert.Equal(t, slog.Default(), empty.Slog())
	assert.NotPanics(t, func() {
		empty.Debug("routed to default", nil)
	})
}

func TestContextLogArgsNilContext(t *testing.T) {
	var ctx context.Context
	assert.Nil(t, ContextLogArgs(ctx))
}

func TestGetLoggerRecreatesFallbackWhenNil(t *testing.T) {
	t.Cleanup(ResetLoggerForTest)

	// Simulate a not-yet-installed logger; GetLogger must lazily recreate one.
	loggerMu.Lock()
	globalLogger = nil
	loggerMu.Unlock()

	assert.NotNil(t, GetLogger())
}

func TestContextLogArgs(t *testing.T) {
	ctx := adapterlogging.WithLogContext(context.Background(), adapterlogging.LogContextValue{
		CorrelationID: "corr-123",
		Metadata: map[string]any{
			"email": "user@example.com",
		},
	})

	args := ContextLogArgs(ctx)

	assert.Equal(t, []any{"correlationId", "corr-123", "email", "[REDACTED_EMAIL]"}, args)
	assert.Nil(t, ContextLogArgs(context.Background()))
}
