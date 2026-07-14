package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
)

// isHealthRedisKeyNotFound reports whether a Redis error represents a missing key
// rather than a real connectivity problem. We check both the go-redis nil sentinel
// string and any custom "key not found" phrasing to avoid fragile single-string matching.
func isHealthRedisKeyNotFound(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "key not found") || strings.Contains(msg, "redis: nil")
}

// HandlePreInitRoute handles health and readiness checks before the full API is initialized.
func HandlePreInitRoute(w http.ResponseWriter, r *http.Request) bool {
	switch r.URL.Path {
	case "/api/v1/health":
		if IsDeepHealthCheck(r) {
			return false
		}
		handlerutil.WithSecurityHeaders(func(w http.ResponseWriter, r *http.Request) {
			report := GetHealthReport(r.Context(), false)
			handlerutil.JSON(w, http.StatusOK, report)
		})(w, r)
		return true
	case "/api/v1/ready":
		handlerutil.WithSecurityHeaders(func(w http.ResponseWriter, r *http.Request) {
			ready, reason := GetEngineReadiness()
			status := http.StatusOK
			body := map[string]any{"status": "ready"}
			if !ready {
				status = http.StatusServiceUnavailable
				body = map[string]any{"status": "not_ready", "reason": reason}
			}
			handlerutil.JSON(w, status, body)
		})(w, r)
		return true
	default:
		return false
	}
}

// RegisterOperationalRoutes registers health and readiness routes with Huma.
func RegisterOperationalRoutes(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "engine-health",
		Method:      http.MethodGet,
		Path:        "/api/v1/health",
		Summary:     "Engine service health check",
		Tags:        []string{"Operations"},
	}, func(ctx context.Context, input *struct {
		handlerutil.OptionalAuthContext
		Deep bool `query:"deep"`
	}) (*struct{ Body *handlerutil.HealthReport }, error) {
		if input.Deep && input.User == nil {
			return nil, huma.Error401Unauthorized("Authentication required for deep health checks")
		}
		report := GetHealthReport(ctx, input.Deep)
		return &struct{ Body *handlerutil.HealthReport }{Body: report}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "engine-ready",
		Method:      http.MethodGet,
		Path:        "/api/v1/ready",
		Summary:     "Engine readiness status",
		Tags:        []string{"Operations"},
	}, func(ctx context.Context, input *struct{}) (*struct {
		Body map[string]any
	}, error) {
		ready, reason := GetEngineReadiness()
		if !ready {
			return nil, huma.Error503ServiceUnavailable(reason)
		}
		return &struct {
			Body map[string]any
		}{Body: map[string]any{
			"status": "ready",
		}}, nil
	})
}

// GetHealthReport generates a health report for the service.
func GetHealthReport(ctx context.Context, deep bool) *handlerutil.HealthReport {
	report := handlerutil.NewHealthReport("1.0.0")
	if !deep {
		report.AddService("database", &handlerutil.ServiceHealth{Status: "connected"})
		report.AddService("redis", &handlerutil.ServiceHealth{Status: "connected"})
		return report
	}

	dbStart := time.Now()
	_, err := GetQueries(ctx)
	dbLatency := time.Since(dbStart).Milliseconds()
	dbHealth := &handlerutil.ServiceHealth{Status: "connected", LatencyMs: &dbLatency}
	if err != nil {
		dbHealth.Status = "error"
		handlerutil.GetLogger().ErrorContext(ctx, "Engine health check: DB query failed", "error", err)
		dbHealth.Error = "database connection unhealthy"
	}
	report.AddService("database", dbHealth)

	redisHealth := &handlerutil.ServiceHealth{Status: "connected"}
	rClient, err := RedisClientGetter()
	if err != nil {
		redisHealth.Status = "error"
		handlerutil.GetLogger().ErrorContext(ctx, "Engine health check: Redis connection failed", "error", err)
		redisHealth.Error = "redis connection unhealthy"
	} else {
		redisStart := time.Now()
		_, err = rClient.Get(ctx, "health_ping")
		redisLatency := time.Since(redisStart).Milliseconds()
		redisHealth.LatencyMs = &redisLatency
		if err != nil && !isHealthRedisKeyNotFound(err) {
			// 'key not found' is expected (the ping key may not exist).
			// Any other error signals the connection is degraded rather than fully connected.
			// We use 'degraded' rather than 'disconnected' to distinguish transient issues
			// (timeouts, auth failures) from a loss of the TCP connection itself.
			redisHealth.Status = "degraded"
			handlerutil.GetLogger().ErrorContext(ctx, "Engine health check: Redis ping failed", "error", err)
			redisHealth.Error = "redis connection degraded"
		}
	}
	report.AddService("redis", redisHealth)

	return report
}

// ProbeOperationalDependencies checks the dependencies used by readiness gating.
func ProbeOperationalDependencies(ctx context.Context) (databaseErr, redisErr error) {
	_, databaseErr = GetQueries(ctx)
	_, redisErr = RedisClientGetter()
	return databaseErr, redisErr
}

// IsDeepHealthCheck checks if a deep health check was requested.
func IsDeepHealthCheck(r *http.Request) bool {
	raw := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("deep")))
	return raw == "1" || raw == "true" || raw == "full"
}
