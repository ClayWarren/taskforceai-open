package logging

import (
	"context"
	"log/slog"
	"os"
)

type LogLevel string

const (
	LevelDebug LogLevel = "debug"
	LevelInfo  LogLevel = "info"
	LevelWarn  LogLevel = "warn"
	LevelError LogLevel = "error"
)

func GetLevelValue(level LogLevel) int {
	switch level {
	case LevelDebug:
		return 0
	case LevelInfo:
		return 1
	case LevelWarn:
		return 2
	case LevelError:
		return 3
	default:
		return 1
	}
}

type Logger interface {
	Debug(message string, args ...any)
	Info(message string, args ...any)
	Warn(message string, args ...any)
	Error(message string, args ...any)
	With(args ...any) Logger
	WithContext(ctx context.Context) Logger
}

type StructuredLogger struct {
	handler          slog.Handler
	logger           *slog.Logger
	level            LogLevel
	environment      string
	baseMeta         map[string]any
	getCorrelationID func(context.Context) string
	getLogMetadata   func(context.Context) map[string]any
}

func NewStructuredLogger(level LogLevel, env string, baseMeta map[string]any) *StructuredLogger {
	var slogLevel slog.Level
	switch level {
	case LevelDebug:
		slogLevel = slog.LevelDebug
	case LevelInfo:
		slogLevel = slog.LevelInfo
	case LevelWarn:
		slogLevel = slog.LevelWarn
	case LevelError:
		slogLevel = slog.LevelError
	}

	opts := &slog.HandlerOptions{
		Level: slogLevel,
	}

	handler := slog.NewJSONHandler(os.Stdout, opts)
	logger := slog.New(handler)

	if len(baseMeta) > 0 {
		attrs := make([]any, 0, len(baseMeta)*2)
		for k, v := range baseMeta {
			attrs = append(attrs, k, v)
		}
		logger = logger.With(attrs...)
	}

	return &StructuredLogger{
		handler:     handler,
		logger:      logger,
		level:       level,
		environment: env,
		baseMeta:    baseMeta,
		getCorrelationID: func(ctx context.Context) string {
			if ctx == nil {
				return ""
			}
			return GetCorrelationID(ctx)
		},
		getLogMetadata: func(ctx context.Context) map[string]any {
			if ctx == nil {
				return make(map[string]any)
			}
			return GetLogMetadata(ctx)
		},
	}
}

func (l *StructuredLogger) Debug(msg string, args ...any) {
	l.logger.Debug(msg, args...)
}

func (l *StructuredLogger) Info(msg string, args ...any) {
	l.logger.Info(msg, args...)
}

func (l *StructuredLogger) Warn(msg string, msgArgs ...any) {
	l.logger.Warn(msg, msgArgs...)
}

func (l *StructuredLogger) Error(msg string, msgArgs ...any) {
	l.logger.Error(msg, msgArgs...)
}

func (l *StructuredLogger) With(args ...any) Logger {
	return &StructuredLogger{
		handler:          l.handler,
		logger:           l.logger.With(args...),
		level:            l.level,
		environment:      l.environment,
		baseMeta:         l.baseMeta,
		getCorrelationID: l.getCorrelationID,
		getLogMetadata:   l.getLogMetadata,
	}
}

func (l *StructuredLogger) WithContext(ctx context.Context) Logger {
	if ctx == nil {
		return l
	}
	attrs := make([]any, 0)
	if cid := l.getCorrelationID(ctx); cid != "" {
		attrs = append(attrs, "correlationId", cid)
	}
	meta := l.getLogMetadata(ctx)
	for k, v := range meta {
		attrs = append(attrs, k, v)
	}
	if len(attrs) == 0 {
		return l
	}
	return l.With(attrs...)
}
