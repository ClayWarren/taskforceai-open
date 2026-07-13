package handler

import (
	"net/http"
	"os"
	"strings"
	"time"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	ratelimit "github.com/TaskForceAI/infrastructure/ratelimit/pkg"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var (
	authRateLimitMeter              = otel.Meter("auth-service")
	authRateLimitFailOpenCounter, _ = authRateLimitMeter.Int64Counter(
		"auth.rate_limit.fail_open.total",
		metric.WithDescription("Number of requests allowed because auth rate limiter dependencies were unavailable"),
	)
	authRateLimitAllowedCounter, _ = authRateLimitMeter.Int64Counter(
		"auth.rate_limit.allowed.total",
		metric.WithDescription("Number of requests allowed by the auth rate limiter"),
	)
	authRateLimitDeniedCounter, _ = authRateLimitMeter.Int64Counter(
		"auth.rate_limit.denied.total",
		metric.WithDescription("Number of requests denied by the auth rate limiter"),
	)
)

func isProductionEnv() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_ENV")), "production") ||
		strings.EqualFold(strings.TrimSpace(os.Getenv("GO_ENV")), "production") ||
		strings.TrimSpace(os.Getenv("VERCEL")) != ""
}

// WithRateLimit returns a middleware that rate limits requests based on Client IP.
// limit: number of allowed requests per window
// window: duration of the rate limit window
func WithRateLimit(limit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// 1. Get Redis Client
			redis := GetRedisClient()
			if redis == nil {
				GetLogger().Warn("Redis unavailable, skipping rate limit check", nil)
				if authRateLimitFailOpenCounter != nil {
					authRateLimitFailOpenCounter.Add(r.Context(), 1, metric.WithAttributes(
						attribute.String("reason", "redis_unavailable"),
						attribute.String("path", r.URL.Path),
					))
				}
				if isProductionEnv() {
					JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			// 2. Initialize Limiter
			cmdable, ok := redis.(infraredis.Cmdable)
			if !ok {
				GetLogger().Warn("Redis client does not support rate limiting", nil)
				if authRateLimitFailOpenCounter != nil {
					authRateLimitFailOpenCounter.Add(r.Context(), 1, metric.WithAttributes(
						attribute.String("reason", "redis_unsupported"),
						attribute.String("path", r.URL.Path),
					))
				}
				if isProductionEnv() {
					JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
					return
				}
				next.ServeHTTP(w, r)
				return
			}
			limiter := ratelimit.NewRedisLimiter(cmdable, "auth_rl")

			// 3. Extract IP for identifying the requester
			ipPtr := GetClientIP(r)
			ip := "unknown"
			if ipPtr != nil {
				ip = *ipPtr
			}

			// 4. Check Limit
			// Use a composite key of the path and IP to allow different limits per endpoint
			key := r.URL.Path + ":" + ip
			result, err := limiter.Check(r.Context(), key, limit, window)
			if err != nil {
				GetLogger().Error("Rate limit check failed", map[string]any{"error": err.Error(), "ip": ip})
				if authRateLimitFailOpenCounter != nil {
					authRateLimitFailOpenCounter.Add(r.Context(), 1, metric.WithAttributes(
						attribute.String("reason", "check_error"),
						attribute.String("path", r.URL.Path),
					))
				}
				if isProductionEnv() {
					JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			// 5. Handle Result
			if !result.Allowed {
				if authRateLimitDeniedCounter != nil {
					authRateLimitDeniedCounter.Add(r.Context(), 1, metric.WithAttributes(
						attribute.String("path", r.URL.Path),
						attribute.String("ip", ip),
					))
				}
				GetLogger().Warn("Rate limit exceeded", map[string]any{
					"ip":    ip,
					"path":  r.URL.Path,
					"limit": limit,
				})

				adapterhandler.SetRateLimitDeniedHeaders(w, limit, result.ResetTime)

				adapterhandler.JSONError(w, http.StatusTooManyRequests, "Too many requests. Please try again later.")
				return
			}

			if authRateLimitAllowedCounter != nil {
				authRateLimitAllowedCounter.Add(r.Context(), 1, metric.WithAttributes(
					attribute.String("path", r.URL.Path),
					attribute.String("ip", ip),
				))
			}
			adapterhandler.SetRateLimitHeaders(w, limit, result.Remaining, result.ResetTime)

			next.ServeHTTP(w, r)
		})
	}
}
