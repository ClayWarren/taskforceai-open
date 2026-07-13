package shared

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRateLimiter(t *testing.T) {
	t.Run("No limit", func(t *testing.T) {
		rl := NewRateLimiter(0)
		start := time.Now()
		for range 10 {
			rl.Acquire()
		}
		duration := time.Since(start)
		if duration > 100*time.Millisecond {
			t.Errorf("expected almost no delay when no limit, got %v", duration)
		}
	})

	t.Run("With limit", func(t *testing.T) {
		// Use a high limit to avoid long waits in tests,
		// but test that it does record timestamps.
		rl := NewRateLimiter(5)
		for range 5 {
			rl.Acquire()
		}

		rl.mu.Lock()
		count := len(rl.timestamps)
		rl.mu.Unlock()

		if count != 5 {
			t.Errorf("expected 5 timestamps, got %d", count)
		}
	})

	t.Run("Update limit", func(t *testing.T) {
		rl := NewRateLimiter(5)
		rl.UpdateLimit(0)
		if rl.limit != nil {
			t.Errorf("expected nil limit after UpdateLimit(0)")
		}

		rl.UpdateLimit(10)
		if rl.limit == nil || *rl.limit != 10 {
			t.Errorf("expected limit 10, got %v", rl.limit)
		}
	})
}

func TestRateLimiterPushTo95CoverageGapPaths(t *testing.T) {
	t.Run("nil context uses background", func(t *testing.T) {
		rl := NewRateLimiter(1)
		var nilContext context.Context
		if err := rl.AcquireContext(nilContext); err != nil {
			t.Fatalf("expected nil context to acquire, got %v", err)
		}
	})

	t.Run("acquire waits when limit is reached", func(t *testing.T) {
		rl := NewRateLimiter(1)
		rl.windowMs = 5
		rl.Acquire()

		start := time.Now()
		rl.Acquire()
		elapsed := time.Since(start)
		if elapsed < 4*time.Millisecond {
			t.Fatalf("expected acquire to wait when limit reached, got %v", elapsed)
		}
	})

	t.Run("acquire context returns on cancellation", func(t *testing.T) {
		rl := NewRateLimiter(1)
		rl.windowMs = 60000
		rl.Acquire()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		start := time.Now()
		err := rl.AcquireContext(ctx)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected context.Canceled, got %v", err)
		}
		if time.Since(start) > 100*time.Millisecond {
			t.Fatalf("expected cancellation without waiting for the limiter window")
		}
	})

	t.Run("cancellation drains fired timer", func(t *testing.T) {
		previousStop := stopRateLimitTimer
		stopRateLimitTimer = func(timer *time.Timer) bool {
			timer.Stop()
			return false
		}
		t.Cleanup(func() { stopRateLimitTimer = previousStop })

		rl := NewRateLimiter(1)
		rl.windowMs = 60000
		rl.Acquire()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		if err := rl.AcquireContext(ctx); !errors.Is(err, context.Canceled) {
			t.Fatalf("expected context.Canceled, got %v", err)
		}
	})

	t.Run("drain helper consumes fired timer", func(t *testing.T) {
		timer := time.NewTimer(time.Millisecond)
		time.Sleep(5 * time.Millisecond)
		drainRateLimitTimer(timer)
	})
}
