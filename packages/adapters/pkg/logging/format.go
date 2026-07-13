package logging

import (
	"encoding/json"
	"runtime"
	"time"
)

// LogEntry represents the structured JSON log format.
type LogEntry struct {
	Timestamp     string   `json:"timestamp"`
	Level         LogLevel `json:"level"`
	Message       string   `json:"message"`
	Meta          any      `json:"meta,omitempty"`
	Environment   string   `json:"environment,omitempty"`
	GoVersion     string   `json:"goVersion,omitempty"`
	CorrelationID string   `json:"correlationId,omitempty"`
}

// marshalFunc is the function used to marshal log entries. Can be overridden in tests.
var marshalFunc = json.Marshal

// FormatLogEntry produces a JSON string representing a log entry.
func FormatLogEntry(
	level LogLevel,
	message string,
	meta any,
	environment string,
	correlationID string,
	baseMeta map[string]any,
	contextMeta map[string]any,
) string {
	sanitizedMessage := ""
	if s, ok := SanitizeValue(message).(string); ok {
		sanitizedMessage = s
	}

	entry := LogEntry{
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
		Level:         level,
		Message:       sanitizedMessage,
		Environment:   environment,
		GoVersion:     runtime.Version(),
		CorrelationID: correlationID,
	}

	normalized := NormalizeMeta(baseMeta, contextMeta, meta)
	if normalized != nil {
		entry.Meta = SanitizeValue(normalized)
	}

	data, err := marshalFunc(entry)
	if err != nil {
		// Fallback for failed marshaling
		return `{"level":"` + string(level) + `","message":"error marshaling log entry"}`
	}
	return string(data)
}
