package transports

import (
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	"github.com/TaskForceAI/logger/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type consoleRedactingSecret string

func (s consoleRedactingSecret) LogValue() slog.Value {
	return slog.StringValue("[redacted-by-logvaluer]")
}

func TestConsoleTransport(t *testing.T) {
	trans := NewConsoleTransport()
	assert.Equal(t, "console", trans.Name())

	entry := pkg.LogEntry{
		Level:   pkg.LevelInfo,
		Message: "test console",
	}
	err := trans.Log(entry)
	assert.NoError(t, err)
}

func TestConsoleTransport_ErrorLevel(t *testing.T) {
	trans := NewConsoleTransport()

	// Test error level logs to stderr
	err := trans.Log(pkg.LogEntry{
		Level:   pkg.LevelError,
		Message: "error message",
	})
	assert.NoError(t, err)
}

func TestConsoleTransport_RoutesInfoToStdout(t *testing.T) {
	trans := NewConsoleTransport()

	stdout, stderr := captureConsoleOutput(t, func() {
		err := trans.Log(pkg.LogEntry{
			Level:   pkg.LevelInfo,
			Message: "stdout message",
		})
		require.NoError(t, err)
	})

	assert.Contains(t, stdout, `"message":"stdout message"`)
	assert.Empty(t, stderr)
}

func TestConsoleTransport_DoesNotLeakLogValuerInitialContext(t *testing.T) {
	trans := NewConsoleTransport()
	logger := pkg.NewLogger(pkg.LoggerOptions{
		Level: pkg.LevelInfo,
		Context: map[string]any{
			"customer_id": consoleRedactingSecret("raw-context-secret"),
		},
		Transports: []pkg.LogTransport{trans},
	})

	stdout, stderr := captureConsoleOutput(t, func() {
		logger.Info("context", nil)
	})

	assert.Contains(t, stdout, `"customer_id":"[redacted-by-logvaluer]"`)
	assert.NotContains(t, stdout, "raw-context-secret")
	assert.Empty(t, stderr)
}

func TestConsoleTransport_RoutesWarnAndErrorToStderr(t *testing.T) {
	trans := NewConsoleTransport()

	stdout, stderr := captureConsoleOutput(t, func() {
		err := trans.Log(pkg.LogEntry{
			Level:   pkg.LevelWarn,
			Message: "stderr warning",
		})
		require.NoError(t, err)

		err = trans.Log(pkg.LogEntry{
			Level:   pkg.LevelError,
			Message: "stderr error",
		})
		require.NoError(t, err)
	})

	assert.Empty(t, stdout)
	assert.Contains(t, stderr, `"message":"stderr warning"`)
	assert.Contains(t, stderr, `"message":"stderr error"`)
}

func TestConsoleTransport_WarnLevel(t *testing.T) {
	trans := NewConsoleTransport()

	// Test warn level also logs to stderr
	err := trans.Log(pkg.LogEntry{
		Level:   pkg.LevelWarn,
		Message: "warning message",
	})
	assert.NoError(t, err)
}

func TestConsoleTransport_Flush(t *testing.T) {
	trans := NewConsoleTransport()
	err := trans.Flush()
	assert.NoError(t, err)
}

func TestConsoleTransport_MarshalError(t *testing.T) {
	trans := &ConsoleTransport{
		marshalFunc: func(v any) ([]byte, error) {
			return nil, errors.New("marshal error")
		},
	}

	err := trans.Log(pkg.LogEntry{
		Level:   pkg.LevelInfo,
		Message: "test",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "marshal error")
}

func TestConsoleTransport_NilMarshalFunc(t *testing.T) {
	trans := &ConsoleTransport{
		marshalFunc: nil,
	}

	err := trans.Log(pkg.LogEntry{
		Level:   pkg.LevelInfo,
		Message: "test with nil func",
	})
	assert.NoError(t, err)
}

func captureConsoleOutput(t *testing.T, fn func()) (string, string) {
	t.Helper()

	originalStdout := os.Stdout
	originalStderr := os.Stderr
	t.Cleanup(func() {
		os.Stdout = originalStdout
		os.Stderr = originalStderr
	})

	stdoutReader, stdoutWriter, err := os.Pipe()
	require.NoError(t, err)
	stderrReader, stderrWriter, err := os.Pipe()
	require.NoError(t, err)

	os.Stdout = stdoutWriter
	os.Stderr = stderrWriter

	fn()

	require.NoError(t, stdoutWriter.Close())
	require.NoError(t, stderrWriter.Close())

	stdoutBytes, err := io.ReadAll(stdoutReader)
	require.NoError(t, err)
	stderrBytes, err := io.ReadAll(stderrReader)
	require.NoError(t, err)

	return strings.TrimSpace(string(stdoutBytes)), strings.TrimSpace(string(stderrBytes))
}
