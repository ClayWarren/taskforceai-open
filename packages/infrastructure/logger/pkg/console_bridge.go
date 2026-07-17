package pkg

import (
	"io"
	"log"
	"os"
	"strings"
)

type logWriter struct {
	logger *Logger
	level  LogLevel
}

func (w *logWriter) Write(p []byte) (n int, err error) {
	msg := strings.TrimSpace(string(p))
	if msg != "" {
		w.logger.Log(w.level, msg, nil)
	}
	return len(p), nil
}

// RedirectStdLog redirects the global Go 'log' package output to this logger.
func (l *Logger) RedirectStdLog(level LogLevel) io.Writer {
	writer := &logWriter{logger: l, level: level}
	log.SetOutput(writer)
	// Remove flags like date/time because our logger handles it
	log.SetFlags(0)
	return writer
}

// RestoreStdLog resets the global log output to stderr.
func RestoreStdLog() {
	log.SetOutput(os.Stderr)
	log.SetFlags(log.LstdFlags)
}
