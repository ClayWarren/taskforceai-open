package streaming

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseStreamingPayload(t *testing.T) {
	t.Run("Valid - Chunk", func(t *testing.T) {
		raw := `{"type":"chunk","chunk":"hello"}`
		res := ParseStreamingPayload(raw)
		assert.True(t, res.Ok)
		assert.Equal(t, "chunk", res.Value.Type)
		assert.Equal(t, "hello", res.Value.Chunk)
	})

	t.Run("Invalid JSON", func(t *testing.T) {
		res := ParseStreamingPayload(`{bad}`)
		assert.False(t, res.Ok)
		assert.Equal(t, ErrInvalidJSON, res.Error)
	})

	t.Run("Empty Input", func(t *testing.T) {
		res := ParseStreamingPayload("")
		assert.False(t, res.Ok)
		assert.Equal(t, ErrInvalidPayload, res.Error)
	})

	t.Run("Invalid Payload - Type Mismatch", func(t *testing.T) {
		// agent_count is int, providing string should trigger UnmarshalTypeError
		res := ParseStreamingPayload(`{"agent_count": "invalid"}`)
		assert.False(t, res.Ok)
		assert.Equal(t, ErrInvalidPayload, res.Error)
	})
}
