package handler

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

var (
	healthMeter           = otel.Meter("adapters-health")
	healthCheckTotal, _   = healthMeter.Int64Counter("service.health.check.total", metric.WithDescription("Total health checks by overall status"))
	healthServiceTotal, _ = healthMeter.Int64Counter("service.health.dependency.total", metric.WithDescription("Dependency health checks by dependency status"))
	healthLatencyMs, _    = healthMeter.Float64Histogram("service.health.dependency.latency_ms", metric.WithDescription("Dependency health check latency in milliseconds"), metric.WithUnit("ms"))
	pingHealthDBPool      = (*pgxpool.Pool).Ping
)

// HealthReport provides a standardized health response format.
type HealthReport struct {
	Status    string                    `json:"status"`
	Timestamp string                    `json:"timestamp"`
	Version   string                    `json:"version"`
	Services  map[string]*ServiceHealth `json:"services"`
}

// ServiceHealth represents the health of an individual service dependency.
type ServiceHealth struct {
	Status    string `json:"status"`
	LatencyMs *int64 `json:"latencyMs,omitempty"`
	Error     string `json:"error,omitempty"`
}

type DatabaseHealthOptions struct {
	UnconfiguredStatus string
	UnconfiguredError  string
}

// NewHealthReport creates a new HealthReport initialized as operational.
func NewHealthReport(version string) *HealthReport {
	return &HealthReport{
		Status:    "operational",
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Version:   version,
		Services:  make(map[string]*ServiceHealth),
	}
}

// CheckDatabase checks database connectivity by acquiring the pool and pinging.
// getPool should return (*pgxpool.Pool, error).
// A 2-second timeout is applied to prevent hanging on unresponsive databases.
func CheckDatabase(ctx context.Context, getPool func(context.Context) (*pgxpool.Pool, error)) *ServiceHealth {
	checkCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	dbStart := time.Now()
	pool, err := getPool(checkCtx)
	dbLatency := time.Since(dbStart).Milliseconds()
	health := &ServiceHealth{Status: "connected", LatencyMs: &dbLatency}
	if err != nil {
		health.Status = "error"
		slog.Error("Database health check: pool acquisition failed", "error", err)
		health.Error = "database connection unhealthy"
		return health
	}
	if pool != nil {
		if pingErr := pingHealthDBPool(pool, checkCtx); pingErr != nil {
			health.Status = "error"
			slog.Error("Database health check: ping failed", "error", pingErr)
			health.Error = "database connection unhealthy"
		}
	}
	return health
}

func IsDeepHealthCheck(r *http.Request) bool {
	raw := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("deep")))
	return raw == "1" || raw == "true" || raw == "full"
}

// RequireAuthenticatedDeepHealth keeps shallow liveness probes public while
// preventing anonymous callers from exercising or inspecting dependencies.
func RequireAuthenticatedDeepHealth(w http.ResponseWriter, r *http.Request) bool {
	if !IsDeepHealthCheck(r) || GetAuthenticatedUser(r) != nil {
		return true
	}
	JSONError(w, http.StatusUnauthorized, "Authentication required for deep health checks")
	return false
}

func AddDatabaseHealth(report *HealthReport, r *http.Request, getPool func(context.Context) (*pgxpool.Pool, error)) {
	AddDatabaseHealthWithOptions(report, r, getPool, DatabaseHealthOptions{})
}

func AddDatabaseHealthWithOptions(
	report *HealthReport,
	r *http.Request,
	getPool func(context.Context) (*pgxpool.Pool, error),
	options DatabaseHealthOptions,
) {
	if !IsDeepHealthCheck(r) {
		report.AddService("database", &ServiceHealth{Status: "connected"})
		return
	}
	if strings.TrimSpace(os.Getenv("DATABASE_URL")) == "" {
		status := options.UnconfiguredStatus
		if status == "" {
			status = "connected"
		}
		report.AddService("database", &ServiceHealth{
			Status: status,
			Error:  options.UnconfiguredError,
		})
		return
	}
	report.AddService("database", CheckDatabase(r.Context(), getPool))
}

func WriteDatabaseHealth(w http.ResponseWriter, r *http.Request, version string, getPool func(context.Context) (*pgxpool.Pool, error)) {
	WriteDatabaseHealthWithOptions(w, r, version, getPool, DatabaseHealthOptions{})
}

func WriteDatabaseHealthWithOptions(
	w http.ResponseWriter,
	r *http.Request,
	version string,
	getPool func(context.Context) (*pgxpool.Pool, error),
	options DatabaseHealthOptions,
) {
	report := NewHealthReport(version)
	AddDatabaseHealthWithOptions(report, r, getPool, options)
	WriteHealthResponse(w, report)
}

// WriteHealthResponse writes a JSON health response, using 503 if degraded.
func WriteHealthResponse(w http.ResponseWriter, report *HealthReport) {
	statusCode := http.StatusOK
	if report.Status == "degraded" {
		statusCode = http.StatusServiceUnavailable
	}
	if healthCheckTotal != nil {
		healthCheckTotal.Add(context.Background(), 1, metric.WithAttributes(
			attribute.String("status", report.Status),
			attribute.Int("status_code", statusCode),
		))
	}
	JSON(w, statusCode, report)
}

// AddService adds a service health entry to the report, marking the report
// as degraded if the service status indicates an error.
func (r *HealthReport) AddService(name string, health *ServiceHealth) {
	r.Services[name] = health
	if healthServiceTotal != nil {
		healthServiceTotal.Add(context.Background(), 1, metric.WithAttributes(
			attribute.String("dependency", name),
			attribute.String("status", health.Status),
		))
	}
	if healthLatencyMs != nil && health.LatencyMs != nil {
		healthLatencyMs.Record(context.Background(), float64(*health.LatencyMs), metric.WithAttributes(
			attribute.String("dependency", name),
			attribute.String("status", health.Status),
		))
	}
	if health.Status != "connected" {
		r.Status = "degraded"
	}
}
