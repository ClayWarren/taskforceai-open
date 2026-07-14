package middleware

import (
	"fmt"
	"net/http"
	"time"

	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	ratelimit "github.com/TaskForceAI/infrastructure/ratelimit/pkg"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
)

var (
	coreRateLimitMeter                      = otel.Meter("core-service")
	coreRateLimitDependencyDeniedCounter, _ = coreRateLimitMeter.Int64Counter(
		"core.rate_limit.dependency_denied.total",
		metric.WithDescription("Number of requests denied because rate limiting dependencies were unavailable"),
	)
	coreRateLimitAllowedCounter, _ = coreRateLimitMeter.Int64Counter(
		"core.rate_limit.allowed.total",
		metric.WithDescription("Number of requests allowed by the core rate limiter"),
	)
	coreRateLimitDeniedCounter, _ = coreRateLimitMeter.Int64Counter(
		"core.rate_limit.denied.total",
		metric.WithDescription("Number of requests denied by the core rate limiter"),
	)
)

// WithRateLimit returns a middleware that rate limits requests.
// When a user is authenticated, limits are per-user; otherwise per-IP.
// Fails closed when Redis is unavailable to avoid bypassing abuse controls.
func WithRateLimit(limit int, window time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if shouldBypassRateLimit(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}

			redis, _ := infraredis.GetClient()
			if redis == nil {
				// Fail closed: missing Redis means we cannot enforce limits safely.
				if coreRateLimitDependencyDeniedCounter != nil {
					coreRateLimitDependencyDeniedCounter.Add(r.Context(), 1)
				}
				w.Header().Set("Retry-After", "60")
				handlerutil.JSONError(w, http.StatusServiceUnavailable, "Rate limit service unavailable. Please retry shortly.")
				return
			}

			limiter := ratelimit.NewRedisLimiter(redis, "core_rl")

			// Build identity key: prefer user ID when authenticated, fallback to IP.
			// Do not include path to avoid path-hopping around a global limit.
			identity := getRequestIdentity(r)
			key := identity

			result, err := limiter.Check(r.Context(), key, limit, window)
			if err != nil {
				// Fail closed on dependency errors to prevent bypassing limits.
				handlerutil.GetLogger().Error("Core rate limit check failed", map[string]any{
					"error": err.Error(),
				})
				if coreRateLimitDependencyDeniedCounter != nil {
					coreRateLimitDependencyDeniedCounter.Add(r.Context(), 1)
				}
				w.Header().Set("Retry-After", "60")
				handlerutil.JSONError(w, http.StatusServiceUnavailable, "Rate limit service unavailable. Please retry shortly.")
				return
			}

			if !result.Allowed {
				if coreRateLimitDeniedCounter != nil {
					coreRateLimitDeniedCounter.Add(r.Context(), 1)
				}
				handlerutil.SetRateLimitDeniedHeaders(w, limit, result.ResetTime)
				handlerutil.JSONError(w, http.StatusTooManyRequests, "Too many requests. Please try again later.")
				return
			}

			if coreRateLimitAllowedCounter != nil {
				coreRateLimitAllowedCounter.Add(r.Context(), 1)
			}
			handlerutil.SetRateLimitHeaders(w, limit, result.Remaining, result.ResetTime)
			next.ServeHTTP(w, r)
		})
	}
}

func shouldBypassRateLimit(path string) bool {
	switch path {
	case "/api/v1/health", "/api/v1/models":
		// These public endpoints must stay reachable during degraded startup and
		// should not depend on Redis-backed abuse-control state.
		return true
	default:
		return false
	}
}

// getRequestIdentity returns the user ID if authenticated, otherwise the client IP.
func getRequestIdentity(r *http.Request) string {
	if userID := handlerutil.GetUserID(r); userID != 0 {
		return fmt.Sprintf("user:%d", userID)
	}

	// Fallback to shared request metadata extraction for consistency across services.
	if ip := handlerutil.GetClientIP(r); ip != nil {
		return "ip:" + *ip
	}
	return "ip:unknown"
}
