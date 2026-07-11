package pkg

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type captureTransport struct {
	entries []LogEntry
}

func (c *captureTransport) Name() string {
	return "capture"
}

func (c *captureTransport) Log(entry LogEntry) error {
	c.entries = append(c.entries, entry)
	return nil
}

func (c *captureTransport) Flush() error {
	return nil
}

type redactedToken string

func (t redactedToken) LogValue() slog.Value {
	return slog.StringValue("[redacted-by-logvaluer]")
}

func requireSingleEntry(t *testing.T, transport *captureTransport) LogEntry {
	t.Helper()
	require.Len(t, transport.entries, 1)
	return transport.entries[0]
}

func TestLogger_SanitizesSensitiveKeysInMetadata(t *testing.T) {
	transport := &captureTransport{}
	logger := NewLogger(LoggerOptions{
		Level:      LevelDebug,
		Transports: []LogTransport{transport},
	})

	logger.Info("token leak", map[string]any{"access_token": "secret-token-value"})

	entry := requireSingleEntry(t, transport)
	assert.Equal(t, "[REDACTED]", entry.Metadata["access_token"])
}

func TestLogger_ResolvesLogValuerMetadata(t *testing.T) {
	transport := &captureTransport{}
	logger := NewLogger(LoggerOptions{
		Level:      LevelDebug,
		Transports: []LogTransport{transport},
	})

	logger.InfoContext(context.Background(), "valuer", "session", redactedToken("raw-secret"))

	entry := requireSingleEntry(t, transport)
	assert.Equal(t, "[redacted-by-logvaluer]", entry.Metadata["session"])
}

func TestLogger_PreservesGroupedMetadataValues(t *testing.T) {
	transport := &captureTransport{}
	logger := NewLogger(LoggerOptions{
		Level:      LevelDebug,
		Transports: []LogTransport{transport},
	})

	logger.InfoContext(
		context.Background(),
		"group attr",
		slog.Group("request", "id", "123", "step", "sync"),
	)

	entry := requireSingleEntry(t, transport)
	requestMeta, ok := entry.Metadata["request"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "123", requestMeta["id"])
	assert.Equal(t, "sync", requestMeta["step"])
}

func TestLogger_RecordMetadataOverridesInheritedContext(t *testing.T) {
	transport := &captureTransport{}
	logger := NewLogger(LoggerOptions{
		Level:      LevelDebug,
		Context:    map[string]any{"request_id": "base"},
		Transports: []LogTransport{transport},
	})

	logger.Info("collision", map[string]any{"request_id": "call"})

	entry := requireSingleEntry(t, transport)
	assert.Equal(t, "call", entry.Metadata["request_id"])
}

func TestLogger_InitialContextPopulatesLogEntryContext(t *testing.T) {
	transport := &captureTransport{}
	logger := NewLogger(LoggerOptions{
		Level: LevelDebug,
		Context: map[string]any{
			"service":      "logger-test",
			"access_token": "secret-token",
			"customer_id":  redactedToken("raw-context-secret"),
		},
		Transports: []LogTransport{transport},
	})

	logger.Info("context", nil)

	entry := requireSingleEntry(t, transport)
	assert.Equal(t, "logger-test", entry.Context["service"])
	assert.Equal(t, "[REDACTED]", entry.Context["access_token"])
	assert.Equal(t, "[redacted-by-logvaluer]", entry.Context["customer_id"])
	assert.Equal(t, "logger-test", entry.Metadata["service"])
	assert.Equal(t, "[REDACTED]", entry.Metadata["access_token"])
	assert.Equal(t, "[redacted-by-logvaluer]", entry.Metadata["customer_id"])

	data, err := json.Marshal(entry)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "raw-context-secret")
}

func TestLogger_StringifiesErrorMetadataForJSONTransports(t *testing.T) {
	transport := &captureTransport{}
	logger := NewLogger(LoggerOptions{
		Level:      LevelDebug,
		Transports: []LogTransport{transport},
	})
	err := errors.New("database unavailable")

	logger.ErrorContext(context.Background(), "error log", "error", err)

	entry := requireSingleEntry(t, transport)
	assert.Equal(t, "database unavailable", entry.Metadata["error"])
	require.ErrorIs(t, entry.Err, err)

	data, marshalErr := json.Marshal(entry)
	require.NoError(t, marshalErr)
	assert.Contains(t, string(data), `"error":"database unavailable"`)
}

func TestLogger_InheritedErrorAttrSetsEntryError(t *testing.T) {
	transport := &captureTransport{}
	entryErr := errors.New("inherited failure")
	handler := (&HandlerBridge{
		transports: []LogTransport{transport},
		level:      slog.LevelDebug,
	}).WithAttrs([]slog.Attr{slog.Any("error", entryErr)})

	slog.New(handler).Info("inherited error")

	entry := requireSingleEntry(t, transport)
	require.ErrorIs(t, entry.Err, entryErr)
	assert.Equal(t, "inherited failure", entry.Metadata["error"])
}

func TestLogger_GroupedErrorAttrSetsEntryError(t *testing.T) {
	transport := &captureTransport{}
	entryErr := errors.New("grouped failure")
	handler := &HandlerBridge{
		transports: []LogTransport{transport},
		level:      slog.LevelDebug,
	}

	slog.New(handler).WithGroup("request").Error("grouped error", "error", entryErr)

	entry := requireSingleEntry(t, transport)
	require.ErrorIs(t, entry.Err, entryErr)
	assert.Equal(t, "grouped failure", entry.Metadata["request.error"])
}

func TestLogger_PerCallErrorOverridesInheritedError(t *testing.T) {
	transport := &captureTransport{}
	inheritedErr := errors.New("inherited failure")
	callErr := errors.New("call failure")
	handler := (&HandlerBridge{
		transports: []LogTransport{transport},
		level:      slog.LevelDebug,
	}).WithAttrs([]slog.Attr{slog.Any("error", inheritedErr)})

	slog.New(handler).Error("override error", "error", callErr)

	entry := requireSingleEntry(t, transport)
	require.ErrorIs(t, entry.Err, callErr)
	assert.Equal(t, "call failure", entry.Metadata["error"])
}

func TestLogger_PerCallNonErrorClearsInheritedEntryError(t *testing.T) {
	transport := &captureTransport{}
	inheritedErr := errors.New("inherited failure")
	handler := (&HandlerBridge{
		transports: []LogTransport{transport},
		level:      slog.LevelDebug,
	}).WithAttrs([]slog.Attr{slog.Any("error", inheritedErr)})

	slog.New(handler).Error("clear error", "error", "handled")

	entry := requireSingleEntry(t, transport)
	require.NoError(t, entry.Err)
	assert.Equal(t, "handled", entry.Metadata["error"])
}

func TestLogger_SlogGroupErrorAttrSetsEntryError(t *testing.T) {
	transport := &captureTransport{}
	entryErr := errors.New("group failure")
	logger := slog.New(&HandlerBridge{
		transports: []LogTransport{transport},
		level:      slog.LevelDebug,
	})

	logger.Error("slog group error", slog.Group("request", "error", entryErr))

	entry := requireSingleEntry(t, transport)
	require.ErrorIs(t, entry.Err, entryErr)
	requestMeta, ok := entry.Metadata["request"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "group failure", requestMeta["error"])
}

func TestLogger_AnonymousMapAndGroupErrorsNormalizeMetadata(t *testing.T) {
	entryErr := errors.New("anonymous failure")
	metadata := map[string]any{}

	err, controlsEntryErr := setMetadataAttr(metadata, "", slog.AnyValue(map[string]any{
		"error": entryErr,
		"nested": map[string]any{
			"inner": entryErr,
		},
		"items": []any{entryErr},
	}))

	require.True(t, controlsEntryErr)
	require.ErrorIs(t, err, entryErr)
	assert.Equal(t, "anonymous failure", metadata["error"])
	assert.Equal(t, map[string]any{"inner": "anonymous failure"}, metadata["nested"])
	assert.Equal(t, []any{"anonymous failure"}, metadata["items"])

	groupMetadata := map[string]any{}
	err, controlsEntryErr = setMetadataGroup(groupMetadata, "", []slog.Attr{slog.Any("error", entryErr)})
	require.True(t, controlsEntryErr)
	require.ErrorIs(t, err, entryErr)
	assert.Equal(t, "anonymous failure", groupMetadata["error"])
	assert.Equal(t, "request", prefixedKey("request", ""))
}

func TestLogger_SanitizeMessageFallsBackToOriginal(t *testing.T) {
	previous := sanitizeLogValue
	sanitizeLogValue = func(any) any {
		return 123
	}
	t.Cleanup(func() {
		sanitizeLogValue = previous
	})

	assert.Equal(t, "raw message", sanitizeMessage("raw message"))
}

func TestLogger_NilReceiverFallsBackToDefaultSlog(t *testing.T) {
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(func() {
		slog.SetDefault(previous)
	})

	var logger *Logger
	logger.InfoContext(context.Background(), "nil context", "key", "value")
	logger.Log(LevelInfo, "nil no metadata", nil)
	logger.Log(LevelInfo, "nil metadata", map[string]any{"key": "value"})
}

func TestHandlerBridge_MergesAnonymousGroupMetadata(t *testing.T) {
	transport := &captureTransport{}
	handler := &HandlerBridge{
		transports: []LogTransport{transport},
		level:      slog.LevelDebug,
	}

	logger := slog.New(handler)
	logger.Info(
		"anonymous group",
		slog.Group("", "request_id", "abc", "component", "sync"),
		slog.Any("", "ignored"),
	)

	entry := requireSingleEntry(t, transport)
	assert.Equal(t, "abc", entry.Metadata["request_id"])
	assert.Equal(t, "sync", entry.Metadata["component"])
	_, hasEmptyKey := entry.Metadata[""]
	assert.False(t, hasEmptyKey)
}

func TestHandlerBridge_NestedGroupsPrefixKeys(t *testing.T) {
	transport := &captureTransport{}
	handler := &HandlerBridge{
		transports: []LogTransport{transport},
		level:      slog.LevelDebug,
	}

	logger := slog.New(handler).WithGroup("request").WithGroup("sync")
	logger.Info("nested group", "id", "abc")

	entry := requireSingleEntry(t, transport)
	assert.Equal(t, "abc", entry.Metadata["request.sync.id"])
}

func TestLogLevel_ToSlogLevelDefaults(t *testing.T) {
	assert.Equal(t, slog.LevelDebug, LogLevel("").ToSlogLevel())
	assert.Equal(t, slog.LevelInfo, LogLevel("trace").ToSlogLevel())
}
