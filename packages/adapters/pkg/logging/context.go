package logging

import (
	"context"
	"maps"
)

type logContextKey struct{}

// LogContextValue holds request-scoped logging context data.
type LogContextValue struct {
	CorrelationID string
	Metadata      map[string]any
}

// CORRELATION_ID_HEADER is the header used to accept an upstream correlation identifier.
const CORRELATION_ID_HEADER = "x-correlation-id"

func cloneMetadata(metadata map[string]any) map[string]any {
	if metadata == nil {
		return nil
	}

	cloned := make(map[string]any, len(metadata))
	maps.Copy(cloned, metadata)
	return cloned
}

// WithLogContext returns a new context with the given log context values.
// Metadata is merged with existing metadata in the context.
func WithLogContext(ctx context.Context, partial LogContextValue) context.Context {
	parent, ok := ctx.Value(logContextKey{}).(*LogContextValue)

	newMetadata := make(map[string]any)
	if ok && parent.Metadata != nil {
		maps.Copy(newMetadata, parent.Metadata)
	}
	if partial.Metadata != nil {
		maps.Copy(newMetadata, partial.Metadata)
	}

	correlationID := partial.CorrelationID
	if correlationID == "" && ok {
		correlationID = parent.CorrelationID
	}

	return context.WithValue(ctx, logContextKey{}, &LogContextValue{
		CorrelationID: correlationID,
		Metadata:      newMetadata,
	})
}

// GetLogContext returns the LogContextValue from the context, if any.
func GetLogContext(ctx context.Context) (*LogContextValue, bool) {
	val, ok := ctx.Value(logContextKey{}).(*LogContextValue)
	if !ok || val == nil {
		return nil, false
	}

	return &LogContextValue{
		CorrelationID: val.CorrelationID,
		Metadata:      cloneMetadata(val.Metadata),
	}, true
}

// GetCorrelationID returns the correlation ID from the context, if any.
func GetCorrelationID(ctx context.Context) string {
	if val, ok := GetLogContext(ctx); ok {
		return val.CorrelationID
	}
	return ""
}

// GetLogMetadata returns the log metadata from the context, or an empty map.
func GetLogMetadata(ctx context.Context) map[string]any {
	if val, ok := GetLogContext(ctx); ok && val.Metadata != nil {
		return val.Metadata
	}
	return make(map[string]any)
}
