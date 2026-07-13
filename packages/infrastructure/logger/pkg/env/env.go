package env

import (
	"context"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	loggerpkg "github.com/TaskForceAI/logger/pkg"
	"github.com/TaskForceAI/logger/pkg/transports"
	"github.com/getsentry/sentry-go"
)

// LoggerOptions describes the composition-root configuration for the
// infrastructure logger.
type LoggerOptions struct {
	ServiceName      string
	ContextExtractor func(context.Context) []any
}

// NewLogger constructs the process logger from environment-backed
// infrastructure details.
func NewLogger(options LoggerOptions) *loggerpkg.Logger {
	level := loggerpkg.LevelInfo
	if os.Getenv("DEBUG") == "true" {
		level = loggerpkg.LevelDebug
	}

	logTransports := []loggerpkg.LogTransport{transports.NewConsoleTransport()}
	if redisURL := redisTransportConfig(); redisURL != "" {
		if rt, err := transports.NewRedisTransport(redisURL, ""); err == nil {
			logTransports = append(logTransports, rt)
		} else {
			slog.Warn("Redis logging disabled: failed to initialize transport", "error", err)
		}
	}

	if sentryDSN := strings.TrimSpace(os.Getenv("SENTRY_DSN")); sentryDSN != "" {
		_ = sentry.Init(sentry.ClientOptions{
			Dsn:         sentryDSN,
			Environment: os.Getenv("NODE_ENV"),
			SampleRate:  parseSentrySampleRate(os.Getenv("SENTRY_ERROR_SAMPLE_RATE")),
			BeforeSend:  sanitizeSentryEvent,
		})
		logTransports = append(
			logTransports,
			transports.NewSentryTransport([]loggerpkg.LogLevel{loggerpkg.LevelError, loggerpkg.LevelWarn}),
		)
	}

	serviceName := strings.TrimSpace(options.ServiceName)
	if serviceName == "" {
		serviceName = "go-server"
	}

	logger := loggerpkg.NewLogger(loggerpkg.LoggerOptions{
		Level:      level,
		Transports: logTransports,
		Context: map[string]any{
			"service": serviceName,
			"env":     os.Getenv("NODE_ENV"),
		},
	})
	if options.ContextExtractor != nil {
		logger.SetContextExtractor(options.ContextExtractor)
	}
	return logger
}

// InstallLogger installs an environment-backed logger as slog's process
// default and returns it to the app composition root.
func InstallLogger(options LoggerOptions) *loggerpkg.Logger {
	logger := NewLogger(options)
	slog.SetDefault(logger.Slog())
	return logger
}

// SentryPanicReporter reports recovered panics to Sentry.
type SentryPanicReporter struct {
	FlushTimeout time.Duration
}

func (r SentryPanicReporter) ReportBackgroundPanic(name string, recovered any) {
	hub := sentry.CurrentHub().Clone()
	hub.ConfigureScope(func(scope *sentry.Scope) {
		scope.SetTag("goroutine", name)
		scope.SetLevel(sentry.LevelFatal)
	})
	hub.Recover(recovered)
	hub.Flush(r.flushTimeout())
}

func (r SentryPanicReporter) ReportRequestPanic(request *http.Request, recovered any) {
	hub := sentry.CurrentHub().Clone()
	hub.ConfigureScope(func(scope *sentry.Scope) {
		scope.SetRequest(request)
		scope.SetLevel(sentry.LevelFatal)
	})
	hub.Recover(recovered)
	hub.Flush(r.flushTimeout())
}

func (r SentryPanicReporter) flushTimeout() time.Duration {
	if r.FlushTimeout <= 0 {
		return 2 * time.Second
	}
	return r.FlushTimeout
}

func redisTransportConfig() string {
	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" {
		redisURL = strings.TrimSpace(os.Getenv("REDIS_KV_URL"))
	}
	return redisURL
}

func parseSentrySampleRate(raw string) float64 {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 1.0
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 1.0
	}
	if math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 1.0
	}
	if parsed < 0 {
		return 0
	}
	if parsed > 1 {
		return 1
	}
	return parsed
}

func sanitizeSentryEvent(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}

	if sanitized, ok := loggerpkg.SanitizeValue(event.Message).(string); ok {
		event.Message = sanitized
	}

	for key, context := range event.Contexts {
		if sanitized, ok := loggerpkg.SanitizeValue(context).(map[string]any); ok {
			event.Contexts[key] = sanitized
		}
	}

	for idx := range event.Breadcrumbs {
		crumb := event.Breadcrumbs[idx]
		if crumb == nil {
			continue
		}
		if sanitizedMsg, ok := loggerpkg.SanitizeValue(crumb.Message).(string); ok {
			crumb.Message = sanitizedMsg
		}
		if len(crumb.Data) > 0 {
			if sanitizedData, ok := loggerpkg.SanitizeValue(crumb.Data).(map[string]any); ok {
				crumb.Data = sanitizedData
			}
		}
	}

	for idx := range event.Exception {
		sanitizedValue, ok := loggerpkg.SanitizeValue(event.Exception[idx].Value).(string)
		if ok {
			event.Exception[idx].Value = sanitizedValue
		}
	}

	return event
}
