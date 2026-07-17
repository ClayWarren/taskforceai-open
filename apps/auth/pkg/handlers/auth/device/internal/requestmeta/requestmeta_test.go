package requestmeta

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubChecker satisfies the unexported rateLimitChecker interface consumed by
// ratelimit.NewRedisRateLimiter.
type stubChecker struct {
	allowed bool
	err     error
}

func (s *stubChecker) CheckRateLimit(_ context.Context, _ string, _ int, _ time.Duration) (bool, int, time.Time, error) {
	return s.allowed, 0, time.Time{}, s.err
}

func newLimiter(t *testing.T, s *stubChecker) *ratelimit.RedisRateLimiter {
	t.Helper()
	limiter := ratelimit.NewRedisRateLimiter(s, "auth")
	require.NotNil(t, limiter)
	return limiter
}

func clearProdEnv(t *testing.T) {
	t.Setenv("NODE_ENV", "")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "")
	t.Setenv("VERCEL", "")
}

func TestClientIP(t *testing.T) {
	// Forwarded header wins.
	ip := ClientIP("203.0.113.7", "192.0.2.1:5678")
	require.NotNil(t, ip)
	assert.Equal(t, "203.0.113.7", *ip)

	// Falls back to the remote address host when no forwarded header exists.
	ip = ClientIP("", "192.0.2.9:5678")
	require.NotNil(t, ip)
	assert.Equal(t, "192.0.2.9", *ip)
}

func TestIsProductionEnv(t *testing.T) {
	t.Run("node env production", func(t *testing.T) {
		clearProdEnv(t)
		t.Setenv("NODE_ENV", "production")
		assert.True(t, IsProductionEnv(ProductionOnAnyVercel))
	})

	t.Run("go env production", func(t *testing.T) {
		clearProdEnv(t)
		t.Setenv("GO_ENV", "production")
		assert.True(t, IsProductionEnv(ProductionOnAnyVercel))
	})

	t.Run("vercel env production mode", func(t *testing.T) {
		clearProdEnv(t)
		t.Setenv("VERCEL_ENV", "production")
		assert.True(t, IsProductionEnv(ProductionOnVercelEnvProduction))
		assert.False(t, IsProductionEnv(ProductionOnAnyVercel))
	})

	t.Run("any vercel mode", func(t *testing.T) {
		clearProdEnv(t)
		t.Setenv("VERCEL", "1")
		assert.True(t, IsProductionEnv(ProductionOnAnyVercel))
	})

	t.Run("not production", func(t *testing.T) {
		clearProdEnv(t)
		assert.False(t, IsProductionEnv(ProductionOnAnyVercel))
		assert.False(t, IsProductionEnv(ProductionOnVercelEnvProduction))
	})
}

func TestCheckRateLimit(t *testing.T) {
	ctx := context.Background()
	ip := "192.0.2.1"
	policy := RateLimitPolicy{KeyPrefix: "signin", MaxRequests: 5, Endpoint: "signin", ProductionMode: ProductionOnAnyVercel}

	t.Run("nil limiter in development is allowed", func(t *testing.T) {
		clearProdEnv(t)
		require.NoError(t, CheckRateLimit(ctx, &ip, nil, policy))
	})

	t.Run("nil limiter in production is unavailable", func(t *testing.T) {
		clearProdEnv(t)
		t.Setenv("NODE_ENV", "production")
		require.Error(t, CheckRateLimit(ctx, &ip, nil, policy))
	})

	t.Run("nil ip skips check", func(t *testing.T) {
		clearProdEnv(t)
		require.NoError(t, CheckRateLimit(ctx, nil, newLimiter(t, &stubChecker{allowed: true}), policy))
	})

	t.Run("checker error continues in development", func(t *testing.T) {
		clearProdEnv(t)
		devPolicy := policy
		devPolicy.ContinueOnErrorInDevelopment = true
		limiter := newLimiter(t, &stubChecker{err: errors.New("redis down")})
		require.NoError(t, CheckRateLimit(ctx, &ip, limiter, devPolicy))
	})

	t.Run("checker error fails in production", func(t *testing.T) {
		clearProdEnv(t)
		t.Setenv("NODE_ENV", "production")
		limiter := newLimiter(t, &stubChecker{err: errors.New("redis down")})
		require.Error(t, CheckRateLimit(ctx, &ip, limiter, policy))
	})

	t.Run("allowed request passes", func(t *testing.T) {
		clearProdEnv(t)
		require.NoError(t, CheckRateLimit(ctx, &ip, newLimiter(t, &stubChecker{allowed: true}), policy))
	})

	t.Run("exceeded request is rejected", func(t *testing.T) {
		clearProdEnv(t)
		require.Error(t, CheckRateLimit(ctx, &ip, newLimiter(t, &stubChecker{allowed: false}), policy))
	})
}
