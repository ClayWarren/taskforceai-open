package handler

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var (
	errRateLimiterUnavailable = errors.New("developer rate limiter unavailable")
	errRateLimitIdentityUnset = errors.New("developer rate limit identity unavailable")
)

type RateLimitResult struct {
	Allowed   bool
	Remaining int
	ResetTime time.Time
}

type RateLimitChecker interface {
	Check(ctx any, key string, limit int, window time.Duration) (*RateLimitResult, error)
	CheckOrg(ctx any, orgID int32, limit int, window time.Duration) (*RateLimitResult, error)
}

type Logger interface {
	Error(msg string, args ...any)
	Warn(msg string, args ...any)
}

type RateLimitDeps struct {
	GetRedis    func() any
	GetOrgID    func(r *http.Request) int
	GetUserID   func(r *http.Request) int
	GetClientIP func(r *http.Request) *string
	GetLogger   func() Logger
	JSONError   func(w http.ResponseWriter, code int, message string)
	NewLimiter  func(redis any, prefix string) RateLimitChecker
}

var defaultRateLimitDeps = &RateLimitDeps{}

func SetRateLimitDeps(deps *RateLimitDeps) {
	if deps == nil {
		return
	}
	if deps.GetRedis != nil {
		defaultRateLimitDeps.GetRedis = deps.GetRedis
	}
	if deps.GetOrgID != nil {
		defaultRateLimitDeps.GetOrgID = deps.GetOrgID
	}
	if deps.GetUserID != nil {
		defaultRateLimitDeps.GetUserID = deps.GetUserID
	}
	if deps.GetClientIP != nil {
		defaultRateLimitDeps.GetClientIP = deps.GetClientIP
	}
	if deps.GetLogger != nil {
		defaultRateLimitDeps.GetLogger = deps.GetLogger
	}
	if deps.JSONError != nil {
		defaultRateLimitDeps.JSONError = deps.JSONError
	}
	if deps.NewLimiter != nil {
		defaultRateLimitDeps.NewLimiter = deps.NewLimiter
	}
}

var (
	rateLimitMeter              = otel.Meter("developer-service")
	rateLimitFailOpenCounter, _ = rateLimitMeter.Int64Counter(
		"developer.rate_limit.fail_open.total",
		metric.WithDescription("Number of requests allowed because developer API rate limiting dependencies were unavailable"),
	)
	rateLimitAllowedCounter, _ = rateLimitMeter.Int64Counter(
		"developer.rate_limit.allowed.total",
		metric.WithDescription("Number of requests allowed by developer API rate limiter"),
	)
	rateLimitDeniedCounter, _ = rateLimitMeter.Int64Counter(
		"developer.rate_limit.denied.total",
		metric.WithDescription("Number of requests denied by developer API rate limiter"),
	)
)

func checkAnonRateLimit(r *http.Request, deps *RateLimitDeps, limit int, window time.Duration) (*RateLimitResult, error) {
	return checkAnonRateLimitForScope(r, deps, "", limit, window)
}

func checkAnonRateLimitForScope(r *http.Request, deps *RateLimitDeps, scope string, limit int, window time.Duration) (*RateLimitResult, error) {
	var ip string
	if deps.GetClientIP != nil {
		if ipPtr := deps.GetClientIP(r); ipPtr != nil {
			ip = *ipPtr
		}
	}
	if ip == "" {
		ip = "unknown"
	}
	key := fmt.Sprintf("anon:%s:%s", rateLimitIdentityScope(r, scope), ip)

	var limiter RateLimitChecker
	if deps.NewLimiter != nil && deps.GetRedis != nil {
		redis := deps.GetRedis()
		limiter = deps.NewLimiter(redis, rateLimitPrefix(scope))
	}
	if limiter == nil {
		return nil, errRateLimiterUnavailable
	}
	return limiter.Check(r.Context(), key, anonLimit(limit), window)
}

func checkUnscopedAuthenticatedRateLimit(r *http.Request, deps *RateLimitDeps, limit int, window time.Duration) (*RateLimitResult, error) {
	return checkUnscopedAuthenticatedRateLimitForScope(r, deps, "", limit, window)
}

func checkUnscopedAuthenticatedRateLimitForScope(r *http.Request, deps *RateLimitDeps, scope string, limit int, window time.Duration) (*RateLimitResult, error) {
	if deps.GetUserID == nil {
		return nil, errRateLimitIdentityUnset
	}
	userID := deps.GetUserID(r)
	if userID <= 0 {
		return nil, errRateLimitIdentityUnset
	}
	identity := fmt.Sprintf("user:%d", userID)
	key := fmt.Sprintf("auth:%s:%s", rateLimitIdentityScope(r, scope), identity)

	var limiter RateLimitChecker
	if deps.NewLimiter != nil && deps.GetRedis != nil {
		redis := deps.GetRedis()
		limiter = deps.NewLimiter(redis, rateLimitPrefix(scope))
	}
	if limiter == nil {
		return nil, errRateLimiterUnavailable
	}
	return limiter.Check(r.Context(), key, limit, window)
}

func isUnscopedAuthenticatedRequest(r *http.Request, deps *RateLimitDeps) bool {
	if deps.GetUserID == nil {
		return false
	}
	return deps.GetUserID(r) > 0
}

func anonLimit(limit int) int {
	if limit <= 0 {
		return 1
	}
	reduced := limit / 5
	if reduced < 1 {
		return 1
	}
	return reduced
}

func anonRateLimitScope(path string) string {
	normalized := strings.TrimSpace(path)
	if normalized == "" || normalized == "/" {
		return "/"
	}

	trimmed := strings.Trim(normalized, "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) >= 4 && parts[0] == "api" && parts[1] == "v1" && parts[2] == "developer" {
		return "/" + strings.Join(parts[:4], "/")
	}

	return "/" + parts[0]
}

func rateLimitIdentityScope(r *http.Request, scope string) string {
	if scope != "" {
		return scope
	}
	return anonRateLimitScope(r.URL.Path)
}

func rateLimitPrefix(scope string) string {
	if scope == "" {
		return "dev_org_rl"
	}
	return "dev_org_rl:" + scope
}

func handleRateLimitDenied(w http.ResponseWriter, r *http.Request, deps *RateLimitDeps, result *RateLimitResult, orgID int, limit int) {
	recordRateLimit(rateLimitDeniedCounter, r,
		attribute.String("path", r.URL.Path), attribute.Int("org_id", orgID))
	if deps.GetLogger != nil {
		deps.GetLogger().Warn("Developer API rate limit exceeded", "org_id", orgID, "path", r.URL.Path, "limit", limit)
	}

	retryAfter := retryAfterSeconds(result.ResetTime, time.Now())
	w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
	w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", limit))
	w.Header().Set("X-RateLimit-Remaining", "0")
	w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", result.ResetTime.Unix()))

	if deps.JSONError != nil {
		deps.JSONError(w, http.StatusTooManyRequests, "Developer API rate limit exceeded. Upgrade your plan for higher limits.")
	} else {
		w.WriteHeader(http.StatusTooManyRequests)
	}
}

func retryAfterSeconds(resetTime, now time.Time) int {
	return max(int(math.Ceil(resetTime.Sub(now).Seconds())), 1)
}

func recordRateLimit(counter metric.Int64Counter, r *http.Request, attrs ...attribute.KeyValue) {
	if counter != nil {
		counter.Add(r.Context(), 1, metric.WithAttributes(attrs...))
	}
}

func WithOrgRateLimit(limit int, window time.Duration) func(http.Handler) http.Handler {
	return withOrgRateLimitScopeDeps("", limit, window, defaultRateLimitDeps)
}

// WithOrgRateLimitScope applies a named rate-limit budget shared by every route
// using the same scope. Distinct scopes use distinct Redis namespaces.
func WithOrgRateLimitScope(scope string, limit int, window time.Duration) func(http.Handler) http.Handler {
	return withOrgRateLimitScopeDeps(scope, limit, window, defaultRateLimitDeps)
}

func WithOrgRateLimitDeps(limit int, window time.Duration, deps *RateLimitDeps) func(http.Handler) http.Handler {
	return withOrgRateLimitScopeDeps("", limit, window, deps)
}

func withOrgRateLimitScopeDeps(scope string, limit int, window time.Duration, deps *RateLimitDeps) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if deps == nil {
				next.ServeHTTP(w, r)
				return
			}

			var redis any
			if deps.GetRedis != nil {
				redis = deps.GetRedis()
			}

			if redis == nil {
				recordRateLimit(rateLimitFailOpenCounter, r,
					attribute.String("reason", "redis_unavailable"), attribute.String("path", r.URL.Path))
				next.ServeHTTP(w, r)
				return
			}

			var limiter RateLimitChecker
			if deps.NewLimiter != nil {
				limiter = deps.NewLimiter(redis, rateLimitPrefix(scope))
			} else {
				next.ServeHTTP(w, r)
				return
			}
			if limiter == nil {
				recordRateLimit(rateLimitFailOpenCounter, r,
					attribute.String("reason", "limiter_unavailable"), attribute.String("path", r.URL.Path))
				next.ServeHTTP(w, r)
				return
			}

			var orgID int
			if deps.GetOrgID != nil {
				orgID = deps.GetOrgID(r)
			}

			var result *RateLimitResult
			var err error
			effectiveLimit := limit

			switch {
			case orgID != 0:
				if orgID < math.MinInt32 || orgID > math.MaxInt32 {
					http.Error(w, "organization id out of range", http.StatusBadRequest)
					return
				}
				orgIDInt32 := int32(orgID) // #nosec G115 -- bounded by math.MinInt32/math.MaxInt32 above.
				result, err = limiter.CheckOrg(r.Context(), orgIDInt32, limit, window)
			case isUnscopedAuthenticatedRequest(r, deps):
				result, err = checkUnscopedAuthenticatedRateLimitForScope(r, deps, scope, limit, window)
			default:
				effectiveLimit = anonLimit(limit)
				result, err = checkAnonRateLimitForScope(r, deps, scope, limit, window)
			}

			if err != nil {
				if deps.GetLogger != nil {
					deps.GetLogger().Error("Org rate limit check failed", "error", err.Error())
				}
				recordRateLimit(rateLimitFailOpenCounter, r,
					attribute.String("reason", "check_error"), attribute.String("path", r.URL.Path))
				next.ServeHTTP(w, r)
				return
			}
			if result == nil {
				recordRateLimit(rateLimitFailOpenCounter, r,
					attribute.String("reason", "missing_result"), attribute.String("path", r.URL.Path))
				next.ServeHTTP(w, r)
				return
			}

			if !result.Allowed {
				handleRateLimitDenied(w, r, deps, result, orgID, effectiveLimit)
				return
			}

			recordRateLimit(rateLimitAllowedCounter, r,
				attribute.String("path", r.URL.Path), attribute.Int("org_id", orgID))

			w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", effectiveLimit))
			w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", result.Remaining))
			w.Header().Set("X-RateLimit-Reset", fmt.Sprintf("%d", result.ResetTime.Unix()))

			next.ServeHTTP(w, r)
		})
	}
}
