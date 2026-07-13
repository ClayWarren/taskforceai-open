package core

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestBus(t *testing.T) {
	bus := NewBus()

	t.Run("subscribe and publish", func(t *testing.T) {
		ch := bus.Subscribe("test")

		bus.Publish("test", "hello")

		select {
		case ev := <-ch:
			assert.Equal(t, "test", ev.Name)
			assert.Equal(t, "hello", ev.Data)
		case <-time.After(100 * time.Millisecond):
			t.Fatal("timed out waiting for event")
		}
	})

	t.Run("unsubscribe", func(t *testing.T) {
		ch := bus.Subscribe("unsub")
		bus.Unsubscribe("unsub", ch)

		bus.Publish("unsub", "hidden")

		select {
		case _, ok := <-ch:
			assert.False(t, ok, "channel should be closed")
		case <-time.After(100 * time.Millisecond):
			// ok
		}
	})

	t.Run("dropped events", func(t *testing.T) {
		ch := bus.Subscribe("full")
		// fill buffer (8)
		for i := range 8 {
			bus.Publish("full", i)
		}

		var droppedCount atomic.Uint64
		bus.SetDropObserver(func(count uint64) {
			droppedCount.Store(count)
		})

		// 9th should drop
		bus.Publish("full", 9)

		assert.Positive(t, droppedCount.Load())
		assert.Positive(t, bus.Dropped())

		// drain
		for range 8 {
			<-ch
		}

		t.Run("clear observer", func(t *testing.T) {
			bus.SetDropObserver(nil)
			// Refill buffer (8)
			for i := range 8 {
				bus.Publish("full", i)
			}
			// 9th should drop
			bus.Publish("full", 10)
			// No panic, and drop count should increase but no callback
			assert.Greater(t, bus.Dropped(), uint64(1))
		})
	})
}

func TestBus_DropWithoutObserverDoesNotPanic(t *testing.T) {
	bus := NewBus()
	ch := bus.Subscribe("full-no-observer")

	for i := range 8 {
		bus.Publish("full-no-observer", i)
	}

	assert.NotPanics(t, func() {
		bus.Publish("full-no-observer", 9)
	})
	assert.Positive(t, bus.Dropped())

	for range 8 {
		<-ch
	}
}
