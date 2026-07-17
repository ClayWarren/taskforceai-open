package pkg

import (
	"context"
	"log/slog"
	"strings"
	"sync"
)

var sanitizeLogValue = SanitizeValue

// Logger wraps slog.Logger to maintain backward compatibility while providing modern features.
type Logger struct {
	mu               sync.RWMutex
	slog             *slog.Logger
	contextExtractor func(context.Context) []any

	// Legacy fields for backward compatibility
	level      LogLevel
	transports []LogTransport
}

// HandlerBridge bridges slog.Handler to your legacy LogTransport interface.
type HandlerBridge struct {
	transports []LogTransport
	level      slog.Level
	attrs      []slog.Attr
	group      string
	context    map[string]any
}

func (h *HandlerBridge) Enabled(ctx context.Context, level slog.Level) bool {
	return level >= h.level
}

func (h *HandlerBridge) Handle(ctx context.Context, r slog.Record) error {
	metadataSize := len(h.attrs) + r.NumAttrs()
	// Convert slog.Record to legacy LogEntry
	entry := LogEntry{
		Level:     slogLevelToLegacy(r.Level),
		Message:   sanitizeMessage(r.Message),
		Timestamp: r.Time,
		Metadata:  make(map[string]any, metadataSize),
		Context:   cloneContextMap(h.context),
	}

	// Add inherited attributes first, then record attributes so per-call attrs override inherited attrs.
	for _, a := range h.attrs {
		key := prefixedKey(h.group, a.Key)
		if err, controlsEntryErr := setMetadataAttr(entry.Metadata, key, a.Value); controlsEntryErr {
			entry.Err = err
		}
	}
	r.Attrs(func(a slog.Attr) bool {
		key := prefixedKey(h.group, a.Key)
		if err, controlsEntryErr := setMetadataAttr(entry.Metadata, key, a.Value); controlsEntryErr {
			entry.Err = err
		}
		return true
	})

	if sanitizedMetadata, ok := sanitizeLogEntryValue(entry.Metadata).(map[string]any); ok {
		entry.Metadata = sanitizedMetadata
	}
	if sanitizedContext, ok := sanitizeLogEntryValue(entry.Context).(map[string]any); ok {
		entry.Context = sanitizedContext
	}

	// Keep logging best-effort: transport failures must not affect application flow.
	for _, t := range h.transports {
		_ = t.Log(entry)
	}
	return nil
}

func prefixedKey(group string, key string) string {
	if group == "" {
		return key
	}
	if key == "" {
		return group
	}
	return group + "." + key
}

func setMetadataAttr(metadata map[string]any, key string, value slog.Value) (error, bool) {
	resolved := value.Resolve()
	if resolved.Kind() == slog.KindGroup {
		return setMetadataGroup(metadata, key, resolved.Group())
	}

	converted := resolved.Any()
	if key == "" {
		groupMetadata, ok := converted.(map[string]any)
		if !ok {
			return nil, false
		}
		var entryErr error
		entryErrControlled := false
		for groupKey, groupValue := range groupMetadata {
			metadata[groupKey] = normalizeMetadataValue(groupValue)
			if errVal, ok := metadataErrorValue(groupKey, groupValue); ok {
				entryErrControlled = true
				entryErr = errVal
			}
		}
		return entryErr, entryErrControlled
	}
	metadata[key] = normalizeMetadataValue(converted)
	if isErrorMetadataKey(key) {
		errVal, _ := converted.(error)
		return errVal, true
	}
	return nil, false
}

func metadataErrorValue(key string, value any) (error, bool) {
	if !isErrorMetadataKey(key) {
		return nil, false
	}
	errVal, _ := value.(error)
	return errVal, true
}

func setMetadataGroup(metadata map[string]any, key string, attrs []slog.Attr) (error, bool) {
	if key == "" {
		var entryErr error
		entryErrControlled := false
		for _, groupAttr := range attrs {
			if err, controlsEntryErr := setMetadataAttr(metadata, groupAttr.Key, groupAttr.Value); controlsEntryErr {
				entryErr = err
				entryErrControlled = true
			}
		}
		return entryErr, entryErrControlled
	}

	groupMetadata := make(map[string]any, len(attrs))
	var entryErr error
	entryErrControlled := false
	for _, groupAttr := range attrs {
		if err, controlsEntryErr := setMetadataAttr(groupMetadata, groupAttr.Key, groupAttr.Value); controlsEntryErr {
			entryErr = err
			entryErrControlled = true
		}
	}
	metadata[key] = groupMetadata
	return entryErr, entryErrControlled
}

func isErrorMetadataKey(key string) bool {
	return key == "error" || strings.HasSuffix(key, ".error")
}

func cloneContextMap(contextMap map[string]any) map[string]any {
	if len(contextMap) == 0 {
		return nil
	}
	clone := make(map[string]any, len(contextMap))
	for key, value := range contextMap {
		clone[key] = normalizeMetadataValue(value)
	}
	return clone
}

func normalizeMetadataValue(value any) any {
	switch v := value.(type) {
	case slog.Value:
		return normalizeSlogValue(v)
	case slog.LogValuer:
		return normalizeSlogValue(slog.AnyValue(v))
	case error:
		return v.Error()
	case map[string]any:
		normalized := make(map[string]any, len(v))
		for key, mapValue := range v {
			normalized[key] = normalizeMetadataValue(mapValue)
		}
		return normalized
	case []any:
		normalized := make([]any, len(v))
		for i, item := range v {
			normalized[i] = normalizeMetadataValue(item)
		}
		return normalized
	default:
		return value
	}
}

func normalizeSlogValue(value slog.Value) any {
	resolved := value.Resolve()
	if resolved.Kind() == slog.KindGroup {
		attrs := resolved.Group()
		normalized := make(map[string]any, len(attrs))
		for _, attr := range attrs {
			normalized[attr.Key] = normalizeMetadataValue(attr.Value)
		}
		return normalized
	}
	return normalizeMetadataValue(resolved.Any())
}

func sanitizeMessage(message string) string {
	sanitized, ok := sanitizeLogValue(message).(string)
	if !ok {
		return message
	}
	return sanitized
}

func sanitizeLogEntryValue(value any) any {
	return sanitizeLogValue(value)
}

func (h *HandlerBridge) WithAttrs(attrs []slog.Attr) slog.Handler {
	newH := *h
	merged := make([]slog.Attr, 0, len(h.attrs)+len(attrs))
	merged = append(merged, h.attrs...)
	merged = append(merged, attrs...)
	newH.attrs = merged
	return &newH
}

func (h *HandlerBridge) WithGroup(name string) slog.Handler {
	newH := *h
	if newH.group != "" {
		newH.group += "." + name
	} else {
		newH.group = name
	}
	return &newH
}

func slogLevelToLegacy(l slog.Level) LogLevel {
	switch {
	case l >= slog.LevelError:
		return LevelError
	case l >= slog.LevelWarn:
		return LevelWarn
	case l >= slog.LevelInfo:
		return LevelInfo
	default:
		return LevelDebug
	}
}

func NewLogger(opts LoggerOptions) *Logger {
	level := opts.Level
	if level == "" {
		level = LevelDebug
	}

	// Default context extractor (can be overridden)
	extractor := func(ctx context.Context) []any { return nil }

	// Create Bridge Handler
	handler := &HandlerBridge{
		transports: opts.Transports,
		level:      level.ToSlogLevel(),
		context:    cloneContextMap(opts.Context),
	}

	sl := slog.New(handler)

	// Inject initial context fields
	if opts.Context != nil {
		args := make([]any, 0, len(opts.Context)*2)
		for k, v := range opts.Context {
			args = append(args, k, v)
		}
		sl = sl.With(args...)
	}

	return &Logger{
		slog:             sl,
		contextExtractor: extractor,
		// Legacy fields
		level:      level,
		transports: opts.Transports,
	}
}

// SetContextExtractor allows injecting a function to pull metadata from context.
func (l *Logger) SetContextExtractor(fn func(context.Context) []any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.contextExtractor = fn
}

// Modern Context-Aware Methods

func (l *Logger) InfoContext(ctx context.Context, msg string, args ...any) {
	l.logContext(ctx, slog.LevelInfo, msg, args...)
}

func (l *Logger) ErrorContext(ctx context.Context, msg string, args ...any) {
	l.logContext(ctx, slog.LevelError, msg, args...)
}

func (l *Logger) WarnContext(ctx context.Context, msg string, args ...any) {
	l.logContext(ctx, slog.LevelWarn, msg, args...)
}

func (l *Logger) DebugContext(ctx context.Context, msg string, args ...any) {
	l.logContext(ctx, slog.LevelDebug, msg, args...)
}

func (l *Logger) logContext(ctx context.Context, level slog.Level, msg string, args ...any) {
	if l == nil || l.slog == nil {
		slog.Default().Log(ctx, level, msg, args...)
		return
	}

	l.mu.RLock()
	extractor := l.contextExtractor
	l.mu.RUnlock()

	if extractor != nil {
		ctxArgs := extractor(ctx)
		if len(ctxArgs) > 0 {
			args = append(args, ctxArgs...)
		}
	}
	l.slog.Log(ctx, level, msg, args...)
}

// Legacy Methods (Backward Compatibility)

func (l *Logger) Child(ctx map[string]any) *Logger {
	l.mu.RLock()
	defer l.mu.RUnlock()

	// Clone the logger
	newLogger := &Logger{
		slog:             l.slog,
		contextExtractor: l.contextExtractor,
		level:            l.level,
		transports:       l.transports,
	}

	// Add new context attributes
	args := make([]any, 0, len(ctx)*2)
	for k, v := range ctx {
		args = append(args, k, v)
	}
	newLogger.slog = l.slog.With(args...)

	return newLogger
}

func (l *Logger) Debug(m string, meta map[string]any) { l.Log(LevelDebug, m, meta) }
func (l *Logger) Info(m string, meta map[string]any)  { l.Log(LevelInfo, m, meta) }
func (l *Logger) Warn(m string, meta map[string]any)  { l.Log(LevelWarn, m, meta) }
func (l *Logger) Error(m string, meta map[string]any) { l.Log(LevelError, m, meta) }

// Slog returns the underlying slog logger for packages that use the standard
// library logger directly.
func (l *Logger) Slog() *slog.Logger {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.slog
}

func (l *Logger) Log(lvl LogLevel, m string, meta map[string]any) {
	level := lvl.ToSlogLevel()
	ctx := context.Background()
	if len(meta) == 0 {
		if l == nil || l.slog == nil {
			slog.Default().Log(ctx, level, m)
			return
		}
		l.slog.Log(ctx, level, m)
		return
	}

	attrs := make([]slog.Attr, 0, len(meta))
	for k, v := range meta {
		attrs = append(attrs, slog.Any(k, v))
	}

	if l == nil || l.slog == nil {
		slog.Default().LogAttrs(ctx, level, m, attrs...)
		return
	}

	l.slog.LogAttrs(ctx, level, m, attrs...)
}

func (l *Logger) Flush() {
	l.mu.RLock()
	transports := l.transports
	l.mu.RUnlock()

	for _, t := range transports {
		_ = t.Flush()
	}
}
