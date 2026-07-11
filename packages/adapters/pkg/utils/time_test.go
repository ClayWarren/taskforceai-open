package utils

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestClock(t *testing.T) {
	t.Run("SystemClock", func(t *testing.T) {
		assert.NotZero(t, SystemClock.Now())
		assert.NotZero(t, SystemClock.Time())
	})

	t.Run("FixedClock", func(t *testing.T) {
		now := int64(1000)
		c := NewFixedClock(now)
		assert.Equal(t, now, c.Now())

		c.Advance(500)
		assert.Equal(t, int64(1500), c.Now())

		c.Set(2000)
		assert.Equal(t, int64(2000), c.Now())
	})

	t.Run("FixedClock Time", func(t *testing.T) {
		tm := time.Now()
		fc := NewFixedClock(tm.UnixMilli())
		assert.True(t, fc.Time().Equal(time.UnixMilli(tm.UnixMilli())))
	})
}
