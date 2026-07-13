package pkg

import (
	"log/slog"
	"time"
)

type LogLevel string

const (
	LevelDebug LogLevel = "debug"
	LevelInfo  LogLevel = "info"
	LevelWarn  LogLevel = "warn"
	LevelError LogLevel = "error"
)

func (l LogLevel) ToSlogLevel() slog.Level {
	switch l {
	case "", LevelDebug:
		return slog.LevelDebug
	case LevelInfo:
		return slog.LevelInfo
	case LevelWarn:
		return slog.LevelWarn
	case LevelError:
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

type LogEntry struct {
	Level     LogLevel       `json:"level"`
	Message   string         `json:"message"`
	Context   map[string]any `json:"context,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	Timestamp time.Time      `json:"timestamp"`
	Err       error          `json:"-"`
}

type LogTransport interface {
	Name() string
	Log(entry LogEntry) error
	Flush() error
}

type LoggerOptions struct {
	Level      LogLevel
	Context    map[string]any
	Transports []LogTransport
}
