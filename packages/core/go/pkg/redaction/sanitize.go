// Package redaction removes sensitive values from structured log data.
package redaction

import (
	"reflect"
	"regexp"
	"strings"
)

type sensitivePattern struct {
	pattern    *regexp.Regexp
	name       string
	mightMatch func(string, sanitizeStringHints) bool
}

type sanitizeVisitKey struct {
	kind reflect.Kind
	ptr  uintptr
}

type sanitizeState struct {
	seen map[sanitizeVisitKey]struct{}
}

var sensitivePatterns = []sensitivePattern{
	{
		pattern: regexp.MustCompile(`(?i)\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b`),
		name:    "EMAIL",
		mightMatch: func(_ string, hints sanitizeStringHints) bool {
			return hints.hasAt
		},
	},
	{
		pattern: regexp.MustCompile(`\b(?:\d{4}[-\s]?){3}\d{4}\b`),
		name:    "CREDIT_CARD",
		mightMatch: func(_ string, hints sanitizeStringHints) bool {
			return hints.digits >= 16
		},
	},
	{
		pattern: regexp.MustCompile(`(?i)\b(?:tfai|sk|pk|api|key|token)_[a-zA-Z0-9]{20,}\b`),
		name:    "API_KEY",
		mightMatch: func(s string, _ sanitizeStringHints) bool {
			return containsAnyASCIIFold(s, "tfai_", "sk_", "pk_", "api_", "key_", "token_")
		},
	},
	{
		pattern: regexp.MustCompile(`\b(sk|pk)_(test|live)_[a-zA-Z0-9]{24,}\b`),
		name:    "STRIPE_KEY",
		mightMatch: func(s string, _ sanitizeStringHints) bool {
			return containsAnyASCIIFold(s, "sk_test_", "sk_live_", "pk_test_", "pk_live_")
		},
	},
	{
		pattern: regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`),
		name:    "SSN",
		mightMatch: func(s string, hints sanitizeStringHints) bool {
			return hints.digits >= 9 && strings.Contains(s, "-")
		},
	},
	{
		pattern: regexp.MustCompile(`\b\d{3}[-.]?\d{3}[-.]?\d{4}\b`),
		name:    "PHONE",
		mightMatch: func(_ string, hints sanitizeStringHints) bool {
			return hints.digits >= 10
		},
	},
	{
		pattern: regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/\-=]+`),
		name:    "BEARER_TOKEN",
		mightMatch: func(_ string, hints sanitizeStringHints) bool {
			return hints.hasBearer
		},
	},
	{
		pattern: regexp.MustCompile(`\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b`),
		name:    "JWT",
		mightMatch: func(_ string, hints sanitizeStringHints) bool {
			return hints.hasJWT
		},
	},
}

type sanitizeStringHints struct {
	digits    int
	dots      int
	hasAt     bool
	hasBearer bool
	hasJWT    bool
}

// SanitizeValue redacts sensitive values recursively.
func SanitizeValue(value any) any {
	return sanitizeValue(value, nil)
}

func sanitizeValue(value any, state *sanitizeState) any {
	if s, ok := value.(string); ok {
		return sanitizeStringValue(s)
	}

	if m, ok := value.(map[string]any); ok {
		return sanitizeAnyMap(m, state)
	}

	if arr, ok := value.([]any); ok {
		return sanitizeAnySlice(arr, state)
	}

	rv := reflect.ValueOf(value)
	if !rv.IsValid() {
		return value
	}

	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		return sanitizeReflectSliceValue(value, rv, state)
	case reflect.Map:
		return sanitizeReflectMapValue(value, rv, state)
	case reflect.Pointer:
		return sanitizePointerValue(value, rv, state)
	case reflect.Struct:
		return sanitizeStructValue(rv, state)
	default:
		return value
	}
}

func sanitizeAnyMap(m map[string]any, state *sanitizeState) any {
	rv := reflect.ValueOf(m)
	state = ensureSanitizeState(state)
	key, tracked, circular := trackSanitizeValue(rv, state)
	if circular {
		return "[Circular]"
	}
	if tracked {
		defer delete(state.seen, key)
	}
	return sanitizeStringMap(m, state)
}

func sanitizeAnySlice(arr []any, state *sanitizeState) any {
	if arr == nil {
		return []any{}
	}
	rv := reflect.ValueOf(arr)
	state = ensureSanitizeState(state)
	key, tracked, circular := trackSanitizeValue(rv, state)
	if circular {
		return "[Circular]"
	}
	if tracked {
		defer delete(state.seen, key)
	}
	var res []any
	for i, v := range arr {
		sanitized := sanitizeValue(v, state)
		if res != nil {
			res[i] = sanitized
			continue
		}
		if sanitizeChanged(v, sanitized) {
			res = make([]any, len(arr))
			copy(res, arr[:i])
			res[i] = sanitized
		}
	}
	if res == nil {
		return arr
	}
	return res
}

func sanitizeReflectSliceValue(value any, rv reflect.Value, state *sanitizeState) any {
	// Keep []byte and other byte arrays intact to avoid turning binary payloads into []any.
	if rv.Type().Elem().Kind() == reflect.Uint8 {
		return value
	}
	if rv.Kind() == reflect.Slice && rv.IsNil() {
		return []any{}
	}
	state = ensureSanitizeState(state)
	key, tracked, circular := trackSanitizeValue(rv, state)
	if circular {
		return "[Circular]"
	}
	if tracked {
		defer delete(state.seen, key)
	}
	var res []any
	for i := 0; i < rv.Len(); i++ {
		item := rv.Index(i).Interface()
		sanitized := sanitizeValue(item, state)
		if res != nil {
			res[i] = sanitized
			continue
		}
		if sanitizeChanged(item, sanitized) {
			res = make([]any, rv.Len())
			for j := 0; j < i; j++ {
				res[j] = rv.Index(j).Interface()
			}
			res[i] = sanitized
		}
	}
	if res == nil {
		return value
	}
	return res
}

func sanitizeReflectMapValue(value any, rv reflect.Value, state *sanitizeState) any {
	if rv.Type().Key().Kind() != reflect.String {
		return value
	}
	state = ensureSanitizeState(state)
	key, tracked, circular := trackSanitizeValue(rv, state)
	if circular {
		return "[Circular]"
	}
	if tracked {
		defer delete(state.seen, key)
	}
	var res map[string]any
	iter := rv.MapRange()
	for iter.Next() {
		key := iter.Key().String()
		item := iter.Value().Interface()
		sanitized := sanitizeMapValueByKey(key, item, state)
		if res != nil {
			res[key] = sanitized
			continue
		}
		if sanitizeChanged(item, sanitized) {
			res = make(map[string]any, rv.Len())
			copyStringMap(res, rv)
			res[key] = sanitized
		}
	}
	if res == nil {
		return value
	}
	return res
}

func sanitizePointerValue(value any, rv reflect.Value, state *sanitizeState) any {
	if rv.IsNil() {
		return value
	}
	state = ensureSanitizeState(state)
	key, tracked, circular := trackSanitizeValue(rv, state)
	if circular {
		return "[Circular]"
	}
	if tracked {
		defer delete(state.seen, key)
	}
	return sanitizeValue(rv.Elem().Interface(), state)
}

func sanitizeStructValue(rv reflect.Value, state *sanitizeState) any {
	res := make(map[string]any, rv.NumField())
	rt := rv.Type()
	for i := 0; i < rv.NumField(); i++ {
		field := rt.Field(i)
		if !field.IsExported() {
			continue
		}
		res[field.Name] = sanitizeMapValueByKey(field.Name, rv.Field(i).Interface(), state)
	}
	return res
}

func sanitizeStringValue(s string) string {
	hints, mightContainSensitive := scanSanitizeStringHints(s)
	if !mightContainSensitive {
		return s
	}
	sanitized := s
	for _, p := range sensitivePatterns {
		if p.mightMatch != nil && !p.mightMatch(sanitized, hints) {
			continue
		}
		sanitized = p.pattern.ReplaceAllString(sanitized, "[REDACTED_"+p.name+"]")
	}
	return sanitized
}

func scanSanitizeStringHints(s string) (sanitizeStringHints, bool) {
	var hints sanitizeStringHints
	if len(s) == 0 {
		return hints, false
	}

	for i := 0; i < len(s); i++ {
		switch ch := s[i]; {
		case ch >= '0' && ch <= '9':
			hints.digits++
		case ch == '.':
			hints.dots++
		case ch == '@':
			hints.hasAt = true
		}
	}

	hints.hasBearer = containsBearerTokenPrefix(s)
	hints.hasJWT = strings.Contains(s, "eyJ") && hints.dots >= 2

	return hints, hints.hasAt ||
		hints.hasBearer ||
		containsAnyASCIIFold(s, "tfai_", "sk_", "pk_", "api_", "key_", "token_") ||
		hints.hasJWT ||
		hints.digits >= 9
}

func containsBearerTokenPrefix(s string) bool {
	for i := 0; i <= len(s)-len("bearer"); i++ {
		if !equalASCIIFoldAt(s, "bearer", i) {
			continue
		}
		after := i + len("bearer")
		if after < len(s) && isASCIIWhitespace(s[after]) {
			return true
		}
	}
	return false
}

func isASCIIWhitespace(ch byte) bool {
	switch ch {
	case ' ', '\t', '\n', '\r', '\f':
		return true
	default:
		return false
	}
}

func containsAnyASCIIFold(s string, substrs ...string) bool {
	for _, substr := range substrs {
		if containsASCIIFold(s, substr) {
			return true
		}
	}
	return false
}

func containsASCIIFold(s, substr string) bool {
	if len(substr) == 0 {
		return true
	}
	if len(s) < len(substr) {
		return false
	}
	for i := 0; i <= len(s)-len(substr); i++ {
		if equalASCIIFoldAt(s, substr, i) {
			return true
		}
	}
	return false
}

func equalASCIIFoldAt(s, substr string, offset int) bool {
	for i := 0; i < len(substr); i++ {
		if toASCIILower(s[offset+i]) != toASCIILower(substr[i]) {
			return false
		}
	}
	return true
}

func toASCIILower(ch byte) byte {
	if ch >= 'A' && ch <= 'Z' {
		return ch + ('a' - 'A')
	}
	return ch
}

func ensureSanitizeState(state *sanitizeState) *sanitizeState {
	if state != nil {
		return state
	}
	return &sanitizeState{}
}

func sanitizeChanged(before, after any) bool {
	if before == nil || after == nil {
		return before != after
	}

	beforeType := reflect.TypeOf(before)
	afterType := reflect.TypeOf(after)
	if beforeType != afterType {
		return true
	}

	switch beforeType.Kind() {
	case reflect.Map, reflect.Slice, reflect.Pointer:
		beforeValue := reflect.ValueOf(before)
		afterValue := reflect.ValueOf(after)
		if beforeValue.IsNil() || afterValue.IsNil() {
			return beforeValue.IsNil() != afterValue.IsNil()
		}
		return beforeValue.Pointer() != afterValue.Pointer()
	case reflect.Func:
		return false
	default:
		return before != after
	}
}

func trackSanitizeValue(rv reflect.Value, state *sanitizeState) (sanitizeVisitKey, bool, bool) {
	switch rv.Kind() {
	case reflect.Map, reflect.Slice, reflect.Pointer:
		if rv.IsNil() {
			return sanitizeVisitKey{}, false, false
		}
	case reflect.Array:
		return sanitizeVisitKey{}, false, false
	default:
		return sanitizeVisitKey{}, false, false
	}

	key := sanitizeVisitKey{kind: rv.Kind(), ptr: rv.Pointer()}
	if state.seen == nil {
		state.seen = make(map[sanitizeVisitKey]struct{}, 4)
	}
	if _, ok := state.seen[key]; ok {
		return key, true, true
	}
	state.seen[key] = struct{}{}
	return key, true, false
}

func sanitizeStringMap(m map[string]any, state *sanitizeState) map[string]any {
	var res map[string]any
	for k, v := range m {
		sanitized := sanitizeMapValueByKey(k, v, state)
		if res != nil {
			res[k] = sanitized
			continue
		}
		if sanitizeChanged(v, sanitized) {
			res = make(map[string]any, len(m))
			copyAnyMap(res, m)
			res[k] = sanitized
		}
	}
	if res == nil {
		return m
	}
	return res
}

func sanitizeMapValueByKey(key string, value any, state *sanitizeState) any {
	lowerKey := strings.ToLower(key)
	if strings.Contains(lowerKey, "apikey") || strings.Contains(lowerKey, "api_key") {
		return "[REDACTED_API_KEY]"
	}
	if strings.Contains(lowerKey, "password") || strings.Contains(lowerKey, "secret") || strings.Contains(lowerKey, "token") {
		return "[REDACTED]"
	}
	return sanitizeValue(value, state)
}

func copyAnyMap(dst, src map[string]any) {
	for key, value := range src {
		dst[key] = value
	}
}

func copyStringMap(dst map[string]any, src reflect.Value) {
	iter := src.MapRange()
	for iter.Next() {
		key := iter.Key().String()
		dst[key] = iter.Value().Interface()
	}
}
