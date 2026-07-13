package platform

import (
	"io"
	"log/slog"
	"sync"
)

var (
	logger *slog.Logger
	mu     sync.RWMutex
)

func newDefaultLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
}

func init() {
	logger = newDefaultLogger()
}

func GetLogger() *slog.Logger {
	mu.RLock()
	defer mu.RUnlock()
	return logger
}

func SetLogger(newLogger *slog.Logger) {
	mu.Lock()
	defer mu.Unlock()
	if newLogger == nil {
		logger = newDefaultLogger()
		return
	}
	logger = newLogger
}
