package ratelimit

import (
	"context"
	"fmt"
	"time"

	infraratelimit "github.com/TaskForceAI/infrastructure/ratelimit/pkg"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

const (
	CallbackMaxRequests    = 30
	SAMLMaxRequests        = 10
	SigninMaxRequests      = 30
	DeviceStartMaxRequests = 10
	DeviceTokenMaxRequests = 60
	DeviceAuthMaxRequests  = 10
)

type rateLimitChecker interface {
	CheckRateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error)
}

type RedisRateLimiter struct {
	limiter *infraratelimit.RedisLimiter
	checker rateLimitChecker
	prefix  string
}

func NewRedisRateLimiter(client any, prefix string) *RedisRateLimiter {
	if prefix == "" {
		prefix = "auth:rl"
	}
	if cmdable, ok := client.(infraredis.Cmdable); ok {
		return &RedisRateLimiter{limiter: infraratelimit.NewRedisLimiter(cmdable, prefix), prefix: prefix}
	}
	if checker, ok := client.(rateLimitChecker); ok {
		return &RedisRateLimiter{checker: checker, prefix: prefix}
	}
	return nil
}

func (r *RedisRateLimiter) Check(ctx context.Context, key string, limit int, window time.Duration) (*infraratelimit.RateLimitResult, error) {
	if r == nil {
		return nil, fmt.Errorf("auth ratelimit unavailable")
	}
	if r.limiter != nil {
		return r.limiter.Check(ctx, key, limit, window)
	}
	if r.checker == nil {
		return nil, fmt.Errorf("auth ratelimit client unavailable")
	}
	allowed, remaining, resetTime, err := r.checker.CheckRateLimit(ctx, r.prefix+":"+key, limit, window)
	if err != nil {
		return nil, err
	}
	return &infraratelimit.RateLimitResult{
		Allowed:   allowed,
		Remaining: remaining,
		ResetTime: resetTime,
	}, nil
}
