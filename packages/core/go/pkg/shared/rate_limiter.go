package shared

import (
	"context"
	"sync"
	"time"
)

type RateLimiter struct {
	windowMs   int64
	limit      *int
	timestamps []int64
	mu         sync.Mutex
}

var stopRateLimitTimer = func(timer *time.Timer) bool {
	return timer.Stop()
}

var drainRateLimitTimer = func(timer *time.Timer) {
	select {
	case <-timer.C:
	default:
	}
}

func NewRateLimiter(requestsPerMinute int) *RateLimiter {
	var limit *int
	if requestsPerMinute > 0 {
		l := requestsPerMinute
		limit = &l
	}
	return &RateLimiter{
		windowMs:   60000,
		limit:      limit,
		timestamps: make([]int64, 0),
	}
}

func (r *RateLimiter) UpdateLimit(requestsPerMinute int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if requestsPerMinute > 0 {
		l := requestsPerMinute
		r.limit = &l
	} else {
		r.limit = nil
	}
}

func (r *RateLimiter) Acquire() {
	_ = r.AcquireContext(context.Background())
}

func (r *RateLimiter) AcquireContext(ctx context.Context) error { //nolint:contextcheck // Nil preserves the legacy Acquire behavior.
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		r.mu.Lock()
		if r.limit == nil {
			r.mu.Unlock()
			return nil
		}
		limit := *r.limit
		now := time.Now().UnixMilli()

		// Filter old timestamps
		valid := make([]int64, 0, len(r.timestamps))
		for _, ts := range r.timestamps {
			if now-ts < r.windowMs {
				valid = append(valid, ts)
			}
		}
		r.timestamps = valid

		if len(r.timestamps) < limit || len(r.timestamps) == 0 {
			r.timestamps = append(r.timestamps, now)
			r.mu.Unlock()
			return nil
		}

		oldest := r.timestamps[0]
		waitMs := max(r.windowMs-(now-oldest), 5)
		r.mu.Unlock()

		timer := time.NewTimer(time.Duration(waitMs) * time.Millisecond)
		select {
		case <-ctx.Done():
			if !stopRateLimitTimer(timer) {
				drainRateLimitTimer(timer)
			}
			return ctx.Err()
		case <-timer.C:
		}
	}
}
