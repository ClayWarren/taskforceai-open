package redaction

import (
	"reflect"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type sanitizeEdgeNode struct {
	Secret string
	Next   *sanitizeEdgeNode
	hidden string
}

func TestSanitizeValueReflectAndCircularEdges(t *testing.T) {
	t.Run("nil and changed any slices", func(t *testing.T) {
		assert.Equal(t, []any{}, SanitizeValue([]any(nil)))
		safe := []any{"safe"}
		assert.Same(t, &safe[0], &SanitizeValue(safe).([]any)[0])

		got, ok := SanitizeValue([]any{"safe", "user@example.com", "Bearer token-value"}).([]any)
		require.True(t, ok)
		assert.Equal(t, "safe", got[0])
		assert.Equal(t, "[REDACTED_EMAIL]", got[1])
		assert.Equal(t, "[REDACTED_BEARER_TOKEN]", got[2])
	})

	t.Run("reflected slices arrays and byte slices", func(t *testing.T) {
		bytes := []byte("secret@example.com")
		assert.Same(t, &bytes[0], &SanitizeValue(bytes).([]byte)[0])

		var nilStrings []string
		assert.Equal(t, []any{}, SanitizeValue(nilStrings))

		got, ok := SanitizeValue([]string{"safe", "user@example.com", fakeStripeKey("test")}).([]any)
		require.True(t, ok)
		assert.Equal(t, "safe", got[0])
		assert.Equal(t, "[REDACTED_EMAIL]", got[1])
		assert.Equal(t, "[REDACTED_STRIPE_KEY]", got[2])

		arr := [2]string{"safe", "also safe"}
		assert.Equal(t, arr, SanitizeValue(arr))
	})

	t.Run("reflected maps and key based redaction", func(t *testing.T) {
		nonStringKey := map[int]string{1: "user@example.com"}
		assert.Equal(t, nonStringKey, SanitizeValue(nonStringKey))

		got, ok := SanitizeValue(map[string]string{
			"email":  "user@example.com",
			"stripe": fakeStripeKey("test"),
			"safe":   "ok",
		}).(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "[REDACTED_EMAIL]", got["email"])
		assert.Equal(t, "[REDACTED_STRIPE_KEY]", got["stripe"])
		assert.Equal(t, "ok", got["safe"])

		safeMap := map[string]string{"safe": "ok"}
		assert.Equal(t, safeMap, SanitizeValue(safeMap))

		byKey, ok := SanitizeValue(map[string]any{
			"apiKey":   "plain-value",
			"password": "plain-value",
		}).(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "[REDACTED_API_KEY]", byKey["apiKey"])
		assert.Equal(t, "[REDACTED]", byKey["password"])
	})

	t.Run("circular map and pointer values", func(t *testing.T) {
		m := map[string]any{}
		m["self"] = m
		got, ok := SanitizeValue(m).(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "[Circular]", got["self"])

		node := &sanitizeEdgeNode{Secret: "user@example.com", hidden: "keep"}
		node.Next = node
		nodeGot, ok := SanitizeValue(node).(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "[REDACTED]", nodeGot["Secret"])
		assert.Equal(t, "[Circular]", nodeGot["Next"])
		assert.NotContains(t, nodeGot, "hidden")

		var nilNode *sanitizeEdgeNode
		assert.Nil(t, SanitizeValue(nilNode))
	})
}

func TestSanitizeHelperEdges(t *testing.T) {
	safeMap := map[string]any{"safe": "value"}
	gotSafeMap := sanitizeStringMap(safeMap, &sanitizeState{})
	gotSafeMap["proof"] = true
	assert.Equal(t, true, safeMap["proof"])
	hints, ok := scanSanitizeStringHints("")
	assert.False(t, ok)
	assert.Zero(t, hints)

	hints, ok = scanSanitizeStringHints("call 555.123.4567")
	assert.True(t, ok)
	assert.Equal(t, 10, hints.digits)
	assert.Equal(t, 2, hints.dots)

	assert.True(t, containsBearerTokenPrefix("prefix BEARER token"))
	assert.False(t, containsBearerTokenPrefix("bearer"))
	assert.True(t, isASCIIWhitespace('\f'))
	assert.False(t, isASCIIWhitespace('x'))
	assert.True(t, containsASCIIFold("Alpha", ""))
	assert.False(t, containsASCIIFold("a", "alphabet"))
	assert.True(t, containsAnyASCIIFold("Token_Value", "missing", "token_"))

	assert.True(t, sanitizeChanged(nil, "x"))
	assert.True(t, sanitizeChanged("x", nil))
	assert.True(t, sanitizeChanged("x", 1))
	assert.True(t, sanitizeChanged(map[string]any(nil), map[string]any{}))
	assert.False(t, sanitizeChanged(func() {}, func() {}))

	var nilMap map[string]any
	key, tracked, circular := trackSanitizeValue(reflect.ValueOf(nilMap), &sanitizeState{})
	assert.False(t, tracked)
	assert.False(t, circular)
	assert.Zero(t, key)

	arrayKey, arrayTracked, arrayCircular := trackSanitizeValue(reflect.ValueOf([1]string{"x"}), &sanitizeState{})
	assert.False(t, arrayTracked)
	assert.False(t, arrayCircular)
	assert.Zero(t, arrayKey)

	defaultKey, defaultTracked, defaultCircular := trackSanitizeValue(reflect.ValueOf(1), &sanitizeState{})
	assert.False(t, defaultTracked)
	assert.False(t, defaultCircular)
	assert.Zero(t, defaultKey)

	slice := []string{"safe"}
	sliceValue := reflect.ValueOf(slice)
	sliceKey := sanitizeVisitKey{kind: sliceValue.Kind(), ptr: sliceValue.Pointer()}
	assert.Equal(t, "[Circular]", sanitizeReflectSliceValue(slice, sliceValue, &sanitizeState{
		seen: map[sanitizeVisitKey]struct{}{sliceKey: {}},
	}))

	stringMap := map[string]string{"safe": "ok"}
	mapValue := reflect.ValueOf(stringMap)
	mapKey := sanitizeVisitKey{kind: mapValue.Kind(), ptr: mapValue.Pointer()}
	assert.Equal(t, "[Circular]", sanitizeReflectMapValue(stringMap, mapValue, &sanitizeState{
		seen: map[sanitizeVisitKey]struct{}{mapKey: {}},
	}))

	src := map[string]string{"a": "b"}
	dst := map[string]any{}
	copyStringMap(dst, reflect.ValueOf(src))
	assert.Equal(t, "b", dst["a"])
}
