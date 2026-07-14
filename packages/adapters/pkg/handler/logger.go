package handler

import (
	"context"
	"log/slog"
	"os"
	"sync"

	adapterlogging "github.com/TaskForceAI/adapters/pkg/logging"
)

// Logger is the handler-layer logging port. Apps install a concrete
// infrastructure logger at composition time.
type Logger interface {
	Debug(message string, meta map[string]any)
	Info(message string, meta map[string]any)
	Warn(message string, meta map[string]any)
	Error(message string, meta map[string]any)
	DebugContext(ctx context.Context, message string, args ...any)
	InfoContext(ctx context.Context, message string, args ...any)
	WarnContext(ctx context.Context, message string, args ...any)
	ErrorContext(ctx context.Context, message string, args ...any)
	Flush()
	Slog() *slog.Logger
}

var (
	loggerMu     sync.RWMutex
	globalLogger Logger = newFallbackLogger()
)

// SetLogger installs the process logger used by shared handler adapters.
func SetLogger(logger Logger) {
	if logger == nil {
		logger = newFallbackLogger()
	}

	loggerMu.Lock()
	globalLogger = logger
	loggerMu.Unlock()

	slog.SetDefault(logger.Slog())
}

// ResetLoggerForTest restores the handler fallback logger.
func ResetLoggerForTest() {
	SetLogger(newFallbackLogger())
}

// GetLogger returns the logger installed by the app composition root.
func GetLogger() Logger {
	loggerMu.RLock()
	logger := globalLogger
	loggerMu.RUnlock()
	if logger != nil {
		return logger
	}

	logger = newFallbackLogger()
	SetLogger(logger)
	return logger
}

// ContextLogArgs adapts handler request-context metadata into slog arguments.
func ContextLogArgs(ctx context.Context) []any {
	if ctx == nil {
		return nil
	}

	logCtx, ok := adapterlogging.GetLogContext(ctx)
	if !ok {
		return nil
	}

	args := make([]any, 0, len(logCtx.Metadata)*2+2)
	if logCtx.CorrelationID != "" {
		args = append(args, "correlationId", logCtx.CorrelationID)
	}
	for key, value := range logCtx.Metadata {
		args = append(args, key, adapterlogging.SanitizeValue(value))
	}
	return args
}

type fallbackLogger struct {
	logger *slog.Logger
}

func newFallbackLogger() *fallbackLogger {
	return &fallbackLogger{
		logger: slog.New(slog.NewJSONHandler(os.Stdout, nil)),
	}
}

func (l *fallbackLogger) Debug(message string, meta map[string]any) {
	l.log(context.Background(), slog.LevelDebug, message, mapAttrs(meta)...)
}

func (l *fallbackLogger) Info(message string, meta map[string]any) {
	l.log(context.Background(), slog.LevelInfo, message, mapAttrs(meta)...)
}

func (l *fallbackLogger) Warn(message string, meta map[string]any) {
	l.log(context.Background(), slog.LevelWarn, message, mapAttrs(meta)...)
}

func (l *fallbackLogger) Error(message string, meta map[string]any) {
	l.log(context.Background(), slog.LevelError, message, mapAttrs(meta)...)
}

func (l *fallbackLogger) DebugContext(ctx context.Context, message string, args ...any) {
	l.log(ctx, slog.LevelDebug, message, args...)
}

func (l *fallbackLogger) InfoContext(ctx context.Context, message string, args ...any) {
	l.log(ctx, slog.LevelInfo, message, args...)
}

func (l *fallbackLogger) WarnContext(ctx context.Context, message string, args ...any) {
	l.log(ctx, slog.LevelWarn, message, args...)
}

func (l *fallbackLogger) ErrorContext(ctx context.Context, message string, args ...any) {
	l.log(ctx, slog.LevelError, message, args...)
}

func (l *fallbackLogger) Flush() {}

func (l *fallbackLogger) Slog() *slog.Logger {
	if l == nil || l.logger == nil {
		return slog.Default()
	}
	return l.logger
}

func (l *fallbackLogger) log(ctx context.Context, level slog.Level, message string, args ...any) {
	if l == nil || l.logger == nil {
		slog.Default().Log(ctx, level, message, args...)
		return
	}
	contextArgs := ContextLogArgs(ctx)
	if len(contextArgs) > 0 {
		args = append(args, contextArgs...)
	}
	l.logger.Log(ctx, level, message, args...)
}

func mapAttrs(meta map[string]any) []any {
	if len(meta) == 0 {
		return nil
	}
	args := make([]any, 0, len(meta)*2)
	for key, value := range meta {
		args = append(args, key, adapterlogging.SanitizeValue(value))
	}
	return args
}
