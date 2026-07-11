package ratelimit

import (
	"context"
	"errors"
	"testing"
	"time"

	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type stubRateLimitChecker struct {
	allowed   bool
	remaining int
	reset     time.Time
	err       error
	gotKey    string
}

func (s *stubRateLimitChecker) CheckRateLimit(_ context.Context, key string, _ int, _ time.Duration) (bool, int, time.Time, error) {
	s.gotKey = key
	return s.allowed, s.remaining, s.reset, s.err
}

func TestNewRedisRateLimiterRejectsUnsupportedClient(t *testing.T) {
	require.Nil(t, NewRedisRateLimiter(struct{}{}, ""))
}

func TestNewRedisRateLimiterAcceptsInfrastructureRedisClient(t *testing.T) {
	limiter := NewRedisRateLimiter(infraredis.NewMockClient(), "")
	require.NotNil(t, limiter)
}

func TestNewRedisRateLimiterAcceptsCustomChecker(t *testing.T) {
	limiter := NewRedisRateLimiter(&stubRateLimitChecker{}, "custom")
	require.NotNil(t, limiter)
}

func TestRedisRateLimiter_Check(t *testing.T) {
	ctx := context.Background()

	t.Run("nil receiver", func(t *testing.T) {
		var r *RedisRateLimiter
		_, err := r.Check(ctx, "key", 5, time.Minute)
		require.Error(t, err)
	})

	t.Run("infrastructure limiter path", func(t *testing.T) {
		limiter := NewRedisRateLimiter(infraredis.NewMockClient(), "auth")
		res, err := limiter.Check(ctx, "key", 5, time.Minute)
		require.NoError(t, err)
		require.NotNil(t, res)
	})

	t.Run("no configured backend", func(t *testing.T) {
		_, err := (&RedisRateLimiter{}).Check(ctx, "key", 5, time.Minute)
		require.Error(t, err)
	})

	t.Run("checker error", func(t *testing.T) {
		limiter := NewRedisRateLimiter(&stubRateLimitChecker{err: errors.New("check failed")}, "auth")
		_, err := limiter.Check(ctx, "key", 5, time.Minute)
		require.Error(t, err)
	})

	t.Run("checker success", func(t *testing.T) {
		checker := &stubRateLimitChecker{allowed: true, remaining: 4}
		limiter := NewRedisRateLimiter(checker, "auth")
		res, err := limiter.Check(ctx, "key", 5, time.Minute)
		require.NoError(t, err)
		require.NotNil(t, res)
		assert.True(t, res.Allowed)
		assert.Equal(t, "auth:key", checker.gotKey)
	})
}
