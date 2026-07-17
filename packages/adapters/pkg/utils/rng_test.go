package utils

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRNG(t *testing.T) {
	t.Run("SystemRNG", func(t *testing.T) {
		assert.NotEmpty(t, SystemRNG.UUID())
		val := SystemRNG.Random()
		assert.GreaterOrEqual(t, val, 0.0)
		assert.Less(t, val, 1.0)
	})

	t.Run("MockRNG", func(t *testing.T) {
		m := NewMockRNG(0.123, "test-uuid")
		assert.Equal(t, 0.123, m.Random())
		assert.Equal(t, "test-uuid", m.UUID())

		m.SetNextRandom(0.456)
		m.SetNextUUID("new-uuid")
		assert.Equal(t, 0.456, m.Random())
		assert.Equal(t, "new-uuid", m.UUID())
	})
}
