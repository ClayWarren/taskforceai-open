package sync

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseBroadcastEvent(t *testing.T) {
	t.Run("Connected", func(t *testing.T) {
		raw := `{"type":"connected","connectionId":"123"}`
		res := ParseBroadcastEvent(raw)
		assert.True(t, res.Ok)
		assert.Equal(t, "connected", res.Value.Type)
		assert.Equal(t, "123", res.Value.ConnectionID)
	})

	t.Run("Empty", func(t *testing.T) {
		res := ParseBroadcastEvent("")
		assert.False(t, res.Ok)
		assert.Equal(t, ErrEmptyEvent, res.Error)
	})

	t.Run("Invalid JSON", func(t *testing.T) {
		res := ParseBroadcastEvent("{invalid}")
		assert.False(t, res.Ok)
		assert.Equal(t, ErrInvalidJSON, res.Error)
	})

	t.Run("Invalid Schema", func(t *testing.T) {
		// This might be hard to trigger with just unmarshal to struct if fields are optional
		// But if we pass something that's not an object:
		res := ParseBroadcastEvent(`"not an object"`)
		assert.False(t, res.Ok)
		assert.Equal(t, ErrInvalidSchema, res.Error)
	})

	t.Run("Missing type", func(t *testing.T) {
		res := ParseBroadcastEvent(`{"connectionId":"123"}`)
		assert.False(t, res.Ok)
		assert.Equal(t, ErrInvalidSchema, res.Error)
	})
}
