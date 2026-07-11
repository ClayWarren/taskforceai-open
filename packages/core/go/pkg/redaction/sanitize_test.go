package redaction

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func fakeStripeKey(environment string) string {
	return "sk_" + environment + "_abcdefghijklmnopqrstuvwxyz"
}

func TestSanitizeValue(t *testing.T) {
	tests := []struct {
		name     string
		input    any
		expected any
	}{
		{
			name:     "String",
			input:    "hello world",
			expected: "hello world",
		},
		{
			name:     "Email",
			input:    "Contact: test@example.com",
			expected: "Contact: [REDACTED_EMAIL]",
		},
		{
			name:     "API Key",
			input:    "Key: " + fakeStripeKey("live"),
			expected: "Key: [REDACTED_STRIPE_KEY]",
		},
		{
			name:     "Map with password",
			input:    map[string]any{"password": "secret123", "username": "user"},
			expected: map[string]any{"password": "[REDACTED]", "username": "user"},
		},
		{
			name:     "Map with api key key",
			input:    map[string]any{"my_api_key": "12345"},
			expected: map[string]any{"my_api_key": "[REDACTED_API_KEY]"},
		},
		{
			name:     "Nested Map",
			input:    map[string]any{"user": map[string]any{"email": "test@test.com"}},
			expected: map[string]any{"user": map[string]any{"email": "[REDACTED_EMAIL]"}},
		},
		{
			name:     "Slice",
			input:    []any{"safe", "test@test.com"},
			expected: []any{"safe", "[REDACTED_EMAIL]"},
		},
		{
			name:     "Typed Slice",
			input:    []string{"safe", "test@test.com"},
			expected: []any{"safe", "[REDACTED_EMAIL]"},
		},
		{
			name:     "Map with secret",
			input:    map[string]any{"client_secret": "abc123"},
			expected: map[string]any{"client_secret": "[REDACTED]"},
		},
		{
			name:     "Map with token",
			input:    map[string]any{"access_token": "xyz789"},
			expected: map[string]any{"access_token": "[REDACTED]"},
		},
		{
			name:     "Map with apikey (no underscore)",
			input:    map[string]any{"myapikey": "key123"},
			expected: map[string]any{"myapikey": "[REDACTED_API_KEY]"},
		},
		{
			name: "JWT",
			input: "token: eyJhbGciOiJIUzI1NiJ9." +
				"eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature_value-123",
			expected: "token: [REDACTED_JWT]",
		},
		{
			name: "Bearer token",
			input: "Authorization: Bearer " +
				"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature_value-123",
			expected: "Authorization: [REDACTED_BEARER_TOKEN]",
		},
		{
			name:     "Bearer token with tab separator",
			input:    "Authorization: Bearer\tsecret-token-value",
			expected: "Authorization: [REDACTED_BEARER_TOKEN]",
		},
		{
			name:     "Short email",
			input:    "a@b.co",
			expected: "[REDACTED_EMAIL]",
		},
		{
			name:     "Non-string non-map non-slice value",
			input:    12345,
			expected: 12345,
		},
		{
			name:     "nil value",
			input:    nil,
			expected: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, SanitizeValue(tt.input))
		})
	}
}

func TestSanitizeValueAdditionalPatterns(t *testing.T) {
	assert.Equal(t, "[REDACTED_CREDIT_CARD]", SanitizeValue("4111111111111111"))
	assert.Equal(t, "[REDACTED_SSN]", SanitizeValue("123-45-6789"))
	assert.Equal(t, "[REDACTED_PHONE]", SanitizeValue("555-123-4567"))
	assert.Equal(t, "[REDACTED_API_KEY]", SanitizeValue("tfai_1234567890abcdef1234567890abcdef12345678"))
	assert.Equal(t, "[REDACTED_API_KEY]", SanitizeValue("sk_1234567890abcdef1234567890abcdef"))
	assert.Equal(t, "[REDACTED_API_KEY]", SanitizeValue("pk_1234567890abcdef1234567890abcdef"))
	assert.Equal(t, "[REDACTED_API_KEY]", SanitizeValue("api_abcdefghijklmnopqrstuvwxyz"))
	assert.Equal(t, "[REDACTED_API_KEY]", SanitizeValue("KEY_abcdefghijklmnopqrstuvwxyz"))
	assert.Equal(t, "[REDACTED_API_KEY]", SanitizeValue("token_abcdefghijklmnopqrstuvwxyz"))
	assert.Equal(t, map[string]any{"items": []any{"[REDACTED_EMAIL]"}}, SanitizeValue(map[string]any{
		"items": []any{"person@example.com"},
	}))
}

func TestSanitizeValueReflectPaths(t *testing.T) {
	type tokenPayload struct {
		Token string
		Email string
	}

	assert.Equal(t, []byte{1, 2, 3}, SanitizeValue([]byte{1, 2, 3}))
	assert.Equal(t, []any{"safe", "[REDACTED_EMAIL]"}, SanitizeValue([]string{"safe", "person@example.com"}))
	assert.Equal(t, map[int]string{1: "x"}, SanitizeValue(map[int]string{1: "x"}))
	assert.Equal(t, map[string]any{
		"Token": "[REDACTED]",
		"Email": "[REDACTED_EMAIL]",
	}, SanitizeValue(tokenPayload{
		Token: "secret-token",
		Email: "person@example.com",
	}))
}

func TestSanitizeValuePointersArraysAndNilCollections(t *testing.T) {
	type tokenPayload struct {
		Secret string
		Next   *tokenPayload
	}

	email := "person@example.com"
	assert.Equal(t, "[REDACTED_EMAIL]", SanitizeValue(&email))

	var nilPointer *string
	assert.Equal(t, nilPointer, SanitizeValue(nilPointer))

	assert.Equal(t, []any{"safe", "[REDACTED_EMAIL]"}, SanitizeValue([2]string{"safe", "person@example.com"}))

	var nilSlice []string
	assert.Equal(t, []any{}, SanitizeValue(nilSlice))

	payload := &tokenPayload{Secret: "super-secret"}
	payload.Next = payload
	assert.Equal(t, map[string]any{
		"Secret": "[REDACTED]",
		"Next":   "[Circular]",
	}, SanitizeValue(payload))
}

func TestSanitizeValueCircularReferences(t *testing.T) {
	m := map[string]any{"email": "person@example.com"}
	m["self"] = m

	assert.Equal(t, map[string]any{
		"email": "[REDACTED_EMAIL]",
		"self":  "[Circular]",
	}, SanitizeValue(m))

	arr := make([]any, 2)
	arr[0] = "safe"
	arr[1] = arr
	assert.Equal(t, []any{"safe", "[Circular]"}, SanitizeValue(arr))
}

var benchmarkSanitizedValue any

func BenchmarkSanitizeValueSafeString(b *testing.B) {
	for b.Loop() {
		benchmarkSanitizedValue = SanitizeValue("GET /api/v1/tasks completed")
	}
}

func BenchmarkSanitizeValueSensitiveString(b *testing.B) {
	for b.Loop() {
		benchmarkSanitizedValue = SanitizeValue("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature_value-123")
	}
}

func BenchmarkSanitizeValueSafeMetadata(b *testing.B) {
	metadata := map[string]any{
		"method": "GET",
		"path":   "/api/v1/tasks",
		"status": 200,
		"tags":   []any{"engine", "stream", "completed"},
		"nested": map[string]any{
			"task_id": "task-123",
			"model":   "openai/gpt-5",
		},
	}

	b.ReportAllocs()
	for b.Loop() {
		benchmarkSanitizedValue = SanitizeValue(metadata)
	}
}

func BenchmarkSanitizeValueSensitiveMetadata(b *testing.B) {
	metadata := map[string]any{
		"email":        "person@example.com",
		"access_token": "secret",
		"headers": map[string]any{
			"authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature_value-123",
		},
		"events": []any{
			map[string]any{"message": "contact admin@example.com"},
			map[string]any{"status": "complete"},
		},
	}

	b.ReportAllocs()
	for b.Loop() {
		benchmarkSanitizedValue = SanitizeValue(metadata)
	}
}
