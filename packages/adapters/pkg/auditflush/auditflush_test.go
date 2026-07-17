package auditflush

import (
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
)

func resetFlushForTest(t *testing.T) {
	t.Helper()

	mu.Lock()
	previous := flushFns
	previousNextID := nextID
	flushFns = nil
	nextID = 0
	mu.Unlock()

	t.Cleanup(func() {
		mu.Lock()
		flushFns = previous
		nextID = previousNextID
		mu.Unlock()
	})
}

func TestFlushWithoutRegisteredCallbackIsNoop(t *testing.T) {
	resetFlushForTest(t)

	assert.NotPanics(t, Flush)
}

func TestRegisterNilFlushReturnsNoop(t *testing.T) {
	resetFlushForTest(t)

	unregister := Register(nil)
	assert.NotPanics(t, func() { unregister() })
	assert.NotPanics(t, Flush)
}

func TestFlushRunsRegisteredCallback(t *testing.T) {
	resetFlushForTest(t)

	var calls atomic.Int32
	Register(func() {
		calls.Add(1)
	})

	Flush()
	Flush()

	assert.Equal(t, int32(2), calls.Load())
}

func TestRegisterRunsAllCallbacks(t *testing.T) {
	resetFlushForTest(t)

	var firstCalls atomic.Int32
	var secondCalls atomic.Int32
	Register(func() {
		firstCalls.Add(1)
	})
	Register(func() {
		secondCalls.Add(1)
	})

	Flush()

	assert.Equal(t, int32(1), firstCalls.Load())
	assert.Equal(t, int32(1), secondCalls.Load())
}

func TestRegisterUnregistersCallback(t *testing.T) {
	resetFlushForTest(t)

	var firstCalls atomic.Int32
	var secondCalls atomic.Int32
	unregisterFirst := Register(func() {
		firstCalls.Add(1)
	})
	Register(func() {
		secondCalls.Add(1)
	})
	unregisterFirst()

	Flush()

	assert.Zero(t, firstCalls.Load())
	assert.Equal(t, int32(1), secondCalls.Load())
}
