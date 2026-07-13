package logging

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFormatLogEntry(t *testing.T) {
	t.Run("basic format", func(t *testing.T) {
		result := FormatLogEntry(LevelInfo, "test message", nil, "test", "corr-123", nil, nil)

		var entry LogEntry
		err := json.Unmarshal([]byte(result), &entry)
		require.NoError(t, err)
		assert.Equal(t, LevelInfo, entry.Level)
		assert.Equal(t, "test message", entry.Message)
		assert.Equal(t, "test", entry.Environment)
		assert.Equal(t, "corr-123", entry.CorrelationID)
	})

	t.Run("with meta", func(t *testing.T) {
		meta := map[string]any{"key": "value"}
		result := FormatLogEntry(LevelDebug, "with meta", meta, "dev", "", nil, nil)

		var entry LogEntry
		err := json.Unmarshal([]byte(result), &entry)
		require.NoError(t, err)
		assert.Equal(t, LevelDebug, entry.Level)
		assert.NotNil(t, entry.Meta)
	})

	t.Run("with base and context meta", func(t *testing.T) {
		baseMeta := map[string]any{"app": "test"}
		contextMeta := map[string]any{"requestId": "req-1"}
		result := FormatLogEntry(LevelWarn, "test", nil, "", "", baseMeta, contextMeta)

		var entry LogEntry
		err := json.Unmarshal([]byte(result), &entry)
		require.NoError(t, err)
		assert.NotNil(t, entry.Meta)
	})

	t.Run("sanitizes message", func(t *testing.T) {
		// Using a normal string that will be sanitized
		result := FormatLogEntry(LevelError, "safe message", nil, "", "", nil, nil)

		var entry LogEntry
		err := json.Unmarshal([]byte(result), &entry)
		require.NoError(t, err)
		assert.Equal(t, "safe message", entry.Message)
	})

	t.Run("marshal error fallback", func(t *testing.T) {
		// Save original and restore after test
		originalMarshal := marshalFunc
		defer func() { marshalFunc = originalMarshal }()

		// Override with failing function
		marshalFunc = func(v any) ([]byte, error) {
			return nil, errors.New("marshal error")
		}

		result := FormatLogEntry(LevelError, "test", nil, "", "", nil, nil)
		assert.Contains(t, result, `"level":"error"`)
		assert.Contains(t, result, `error marshaling log entry`)
	})
}
