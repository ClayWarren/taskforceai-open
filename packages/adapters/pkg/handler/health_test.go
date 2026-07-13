package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHealthReport(t *testing.T) {
	report := NewHealthReport("1.0.0")
	assert.Equal(t, "operational", report.Status)
	assert.Equal(t, "1.0.0", report.Version)
	assert.NotEmpty(t, report.Timestamp)
	assert.Empty(t, report.Services)

	// Add healthy service
	latency := int64(10)
	report.AddService("db", &ServiceHealth{
		Status:    "connected",
		LatencyMs: &latency,
	})
	assert.Equal(t, "operational", report.Status)
	assert.Equal(t, "connected", report.Services["db"].Status)

	// Add unhealthy service
	report.AddService("cache", &ServiceHealth{
		Status: "error",
		Error:  "timeout",
	})
	assert.Equal(t, "degraded", report.Status)
	assert.Equal(t, "error", report.Services["cache"].Status)
}

func TestWriteHealthResponse(t *testing.T) {
	// 1. Healthy
	t.Run("Healthy", func(t *testing.T) {
		report := NewHealthReport("1.0.0")
		w := httptest.NewRecorder()
		WriteHealthResponse(w, report)
		assert.Equal(t, http.StatusOK, w.Code)

		var parsed HealthReport
		err := json.NewDecoder(w.Body).Decode(&parsed)
		require.NoError(t, err)
		assert.Equal(t, "operational", parsed.Status)
	})

	// 2. Degraded
	t.Run("Degraded", func(t *testing.T) {
		report := NewHealthReport("1.0.0")
		report.Status = "degraded" // Simulate degraded manually or via AddService

		w := httptest.NewRecorder()
		WriteHealthResponse(w, report)
		assert.Equal(t, http.StatusServiceUnavailable, w.Code)

		var parsed HealthReport
		err := json.NewDecoder(w.Body).Decode(&parsed)
		require.NoError(t, err)
		assert.Equal(t, "degraded", parsed.Status)
	})
}

func TestIsDeepHealthCheck(t *testing.T) {
	for _, raw := range []string{"1", "true", "full", " TRUE "} {
		req := httptest.NewRequest(http.MethodGet, "/health?deep="+url.QueryEscape(raw), nil)
		assert.True(t, IsDeepHealthCheck(req))
	}
	req := httptest.NewRequest(http.MethodGet, "/health?deep=false", nil)
	assert.False(t, IsDeepHealthCheck(req))
}

func TestRequireAuthenticatedDeepHealth(t *testing.T) {
	shallowReq := httptest.NewRequest(http.MethodGet, "/health", nil)
	assert.True(t, RequireAuthenticatedDeepHealth(httptest.NewRecorder(), shallowReq))

	deepReq := httptest.NewRequest(http.MethodGet, "/health?deep=true", nil)
	deepResp := httptest.NewRecorder()
	assert.False(t, RequireAuthenticatedDeepHealth(deepResp, deepReq))
	assert.Equal(t, http.StatusUnauthorized, deepResp.Code)

	ctx := context.WithValue(deepReq.Context(), UserContextKey, &auth.AuthenticatedUser{ID: 42})
	assert.True(t, RequireAuthenticatedDeepHealth(httptest.NewRecorder(), deepReq.WithContext(ctx)))
}

func TestCheckDatabasePoolAcquisitionError(t *testing.T) {
	health := CheckDatabase(context.Background(), func(context.Context) (*pgxpool.Pool, error) {
		return nil, errors.New("db unavailable")
	})

	assert.Equal(t, "error", health.Status)
	assert.Equal(t, "database connection unhealthy", health.Error)
	assert.NotNil(t, health.LatencyMs)
}

func TestCheckDatabaseNilPoolIsConnected(t *testing.T) {
	health := CheckDatabase(context.Background(), func(context.Context) (*pgxpool.Pool, error) {
		return nil, nil
	})

	assert.Equal(t, "connected", health.Status)
	assert.Empty(t, health.Error)
	assert.NotNil(t, health.LatencyMs)
}

func TestCheckDatabasePingError(t *testing.T) {
	originalPing := pingHealthDBPool
	pingHealthDBPool = func(*pgxpool.Pool, context.Context) error {
		return errors.New("ping failed")
	}
	t.Cleanup(func() { pingHealthDBPool = originalPing })

	health := CheckDatabase(context.Background(), func(context.Context) (*pgxpool.Pool, error) {
		return &pgxpool.Pool{}, nil
	})

	assert.Equal(t, "error", health.Status)
	assert.Equal(t, "database connection unhealthy", health.Error)
}

func TestAddDatabaseHealthShallowDoesNotAcquirePool(t *testing.T) {
	report := NewHealthReport("1.0.0")
	req := httptest.NewRequest(http.MethodGet, "/health", nil)

	AddDatabaseHealth(report, req, func(context.Context) (*pgxpool.Pool, error) {
		t.Fatal("shallow health check should not acquire a database pool")
		return nil, nil
	})

	require.Contains(t, report.Services, "database")
	assert.Equal(t, "connected", report.Services["database"].Status)
	assert.Equal(t, "operational", report.Status)
}

func TestAddDatabaseHealthDeepUnconfiguredUsesOptions(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	report := NewHealthReport("1.0.0")
	req := httptest.NewRequest(http.MethodGet, "/health?deep=true", nil)

	AddDatabaseHealthWithOptions(report, req, func(context.Context) (*pgxpool.Pool, error) {
		t.Fatal("unconfigured deep health check should not acquire a database pool")
		return nil, nil
	}, DatabaseHealthOptions{
		UnconfiguredStatus: "skipped",
		UnconfiguredError:  "DATABASE_URL is not configured",
	})

	require.Contains(t, report.Services, "database")
	assert.Equal(t, "skipped", report.Services["database"].Status)
	assert.Equal(t, "DATABASE_URL is not configured", report.Services["database"].Error)
	assert.Equal(t, "degraded", report.Status)
}

func TestAddDatabaseHealthDeepUnconfiguredDefaultsStatus(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	report := NewHealthReport("1.0.0")
	req := httptest.NewRequest(http.MethodGet, "/health?deep=true", nil)

	AddDatabaseHealthWithOptions(report, req, func(context.Context) (*pgxpool.Pool, error) {
		t.Fatal("unconfigured deep health check should not acquire a database pool")
		return nil, nil
	}, DatabaseHealthOptions{})

	require.Contains(t, report.Services, "database")
	assert.Equal(t, "connected", report.Services["database"].Status)
}

func TestAddDatabaseHealthDeepConfiguredUsesPoolCheck(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://user:pass@example.com/db")
	report := NewHealthReport("1.0.0")
	req := httptest.NewRequest(http.MethodGet, "/health?deep=full", nil)

	AddDatabaseHealth(report, req, func(context.Context) (*pgxpool.Pool, error) {
		return nil, errors.New("db unavailable")
	})

	require.Contains(t, report.Services, "database")
	assert.Equal(t, "error", report.Services["database"].Status)
	assert.Equal(t, "database connection unhealthy", report.Services["database"].Error)
	assert.Equal(t, "degraded", report.Status)
}

func TestWriteDatabaseHealthWithOptions(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	req := httptest.NewRequest(http.MethodGet, "/health?deep=true", nil)
	resp := httptest.NewRecorder()

	WriteDatabaseHealthWithOptions(resp, req, "2.0.0", func(context.Context) (*pgxpool.Pool, error) {
		t.Fatal("unconfigured health response should not acquire a database pool")
		return nil, nil
	}, DatabaseHealthOptions{UnconfiguredStatus: "connected"})

	assert.Equal(t, http.StatusOK, resp.Code)
	var parsed HealthReport
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&parsed))
	assert.Equal(t, "2.0.0", parsed.Version)
	assert.Equal(t, "connected", parsed.Services["database"].Status)
}

func TestWriteDatabaseHealth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	resp := httptest.NewRecorder()

	WriteDatabaseHealth(resp, req, "3.0.0", func(context.Context) (*pgxpool.Pool, error) {
		t.Fatal("shallow health response should not acquire a database pool")
		return nil, nil
	})

	assert.Equal(t, http.StatusOK, resp.Code)
	var parsed HealthReport
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&parsed))
	assert.Equal(t, "3.0.0", parsed.Version)
	assert.Equal(t, "connected", parsed.Services["database"].Status)
}
