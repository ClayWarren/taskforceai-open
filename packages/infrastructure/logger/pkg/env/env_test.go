package env

import (
	"context"
	"errors"
	"log/slog"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewLogger(t *testing.T) {
	t.Setenv("DEBUG", "true")
	t.Setenv("REDIS_URL", "://bad-redis-url")
	t.Setenv("SENTRY_DSN", "https://public@sentry.io/1")
	t.Setenv("SENTRY_ERROR_SAMPLE_RATE", "1.0")
	t.Setenv("NODE_ENV", "test")

	logger := NewLogger(LoggerOptions{ServiceName: "unit-service"})

	require.NotNil(t, logger)
	assert.NotNil(t, logger.Slog())
}

func TestNewLogger_RedisSuccessDefaultNameAndContextExtractor(t *testing.T) {
	// A well-formed redis URL parses successfully, so the redis transport is
	// appended (success branch, not the failure warning).
	t.Setenv("DEBUG", "")
	t.Setenv("REDIS_URL", "redis://localhost:6379")
	t.Setenv("REDIS_KV_URL", "")
	t.Setenv("SENTRY_DSN", "")
	t.Setenv("NODE_ENV", "test")

	logger := NewLogger(LoggerOptions{
		// Empty ServiceName exercises the "go-server" default.
		ServiceName: "",
		// A non-nil ContextExtractor exercises the SetContextExtractor wiring.
		ContextExtractor: func(context.Context) []any { return nil },
	})
	require.NotNil(t, logger)
	assert.NotNil(t, logger.Slog())
}

func TestInstallLoggerAndPanicReporter(t *testing.T) {
	t.Setenv("DEBUG", "")
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "")
	t.Setenv("SENTRY_DSN", "")
	t.Setenv("NODE_ENV", "test")

	logger := InstallLogger(LoggerOptions{ServiceName: "installed-service"})
	require.NotNil(t, logger)
	slog.Default().Info("installed logger smoke")

	defaultReporter := SentryPanicReporter{}
	assert.Equal(t, 2*time.Second, defaultReporter.flushTimeout())

	reporter := SentryPanicReporter{FlushTimeout: time.Millisecond}
	assert.Equal(t, time.Millisecond, reporter.flushTimeout())
	reporter.ReportBackgroundPanic("worker", errors.New("background panic"))
	reporter.ReportRequestPanic(httptest.NewRequest("GET", "/panic", nil), "request panic")
}

func TestRedisTransportConfig(t *testing.T) {
	t.Setenv("REDIS_URL", " https://redis-main ")
	t.Setenv("REDIS_KV_URL", " https://redis-fallback ")

	url := redisTransportConfig()
	assert.Equal(t, "https://redis-main", url)

	t.Setenv("REDIS_URL", "")
	url = redisTransportConfig()
	assert.Equal(t, "https://redis-fallback", url)

	t.Setenv("REDIS_KV_URL", "")
	url = redisTransportConfig()
	assert.Empty(t, url)
}

func TestParseSentrySampleRate(t *testing.T) {
	tests := []struct {
		input    string
		expected float64
	}{
		{"", 1.0},
		{"invalid", 1.0},
		{"NaN", 1.0},
		{"+Inf", 1.0},
		{"-Inf", 1.0},
		{"0.5", 0.5},
		{"0", 0.0},
		{"1", 1.0},
		{"-0.1", 0.0},
		{"1.5", 1.0},
		{"  0.3  ", 0.3},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			assert.Equal(t, tc.expected, parseSentrySampleRate(tc.input))
		})
	}
}

func TestSanitizeSentryEvent(t *testing.T) {
	assert.Nil(t, sanitizeSentryEvent(nil, nil))

	event := &sentry.Event{
		Message: "Hello user@example.com",
		Contexts: map[string]sentry.Context{
			"extra": {
				"email": "user@example.com",
			},
		},
		Breadcrumbs: []*sentry.Breadcrumb{
			nil,
			{Message: "crumb user@example.com", Data: map[string]any{"token": "secret"}},
		},
		Exception: []sentry.Exception{
			{Value: "oops user@example.com"},
		},
	}

	sanitized := sanitizeSentryEvent(event, nil)

	require.NotNil(t, sanitized)
	assert.Equal(t, "Hello [REDACTED_EMAIL]", sanitized.Message)
	assert.Equal(t, "[REDACTED_EMAIL]", sanitized.Contexts["extra"]["email"])
	assert.Equal(t, "crumb [REDACTED_EMAIL]", sanitized.Breadcrumbs[1].Message)
	assert.Equal(t, "oops [REDACTED_EMAIL]", sanitized.Exception[0].Value)
}
