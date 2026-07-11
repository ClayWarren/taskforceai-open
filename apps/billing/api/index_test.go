package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	billinghandler "github.com/TaskForceAI/billing-service/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetBillingHandlerMuxForTest() {
	handlerMux = nil
	muxOnce = sync.Once{}
}

func authenticatedBillingHealthRequest(target string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{ID: 42})
	return req.WithContext(ctx)
}

func TestNewRouter(t *testing.T) {
	router, api := NewRouter()
	assert.NotNil(t, router)
	assert.NotNil(t, api)
}

func TestIsWebhookPath(t *testing.T) {
	assert.True(t, isWebhookPath("/api/v1/payments/webhook"))
	assert.True(t, isWebhookPath("/api/v1/payments/webhook/revenuecat"))
	assert.False(t, isWebhookPath("/api/v1/payments/webhook/other"))
	assert.False(t, isWebhookPath("/api/v1/billing/health"))
}

func TestIsDeepHealthCheck(t *testing.T) {
	tests := []struct {
		url      string
		expected bool
	}{
		{"/health?deep=1", true},
		{"/health?deep=true", true},
		{"/health?deep=full", true},
		{"/health?deep=TRUE", true},
		{"/health?deep=0", false},
		{"/health?deep=false", false},
		{"/health", false},
		{"/health?deep=", false},
	}

	for _, tt := range tests {
		req := httptest.NewRequest(http.MethodGet, tt.url, nil)
		assert.Equal(t, tt.expected, adapterhandler.IsDeepHealthCheck(req), "URL: %s", tt.url)
	}
}

func TestHandleHealth_Shallow(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/health", nil)
	w := httptest.NewRecorder()

	handleHealth(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var report adapterhandler.HealthReport
	err := json.NewDecoder(w.Body).Decode(&report)
	require.NoError(t, err)
	assert.Equal(t, "operational", report.Status)
	assert.NotNil(t, report.Services["database"])
	assert.Equal(t, "connected", report.Services["database"].Status)
}

func TestHandleHealth_Deep_NotConfigured(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	req := authenticatedBillingHealthRequest("/api/v1/billing/health?deep=true")
	w := httptest.NewRecorder()

	handleHealth(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	var report adapterhandler.HealthReport
	err := json.NewDecoder(w.Body).Decode(&report)
	require.NoError(t, err)
	assert.Equal(t, "degraded", report.Status)
	assert.NotNil(t, report.Services["database"])
	assert.Equal(t, "not_configured", report.Services["database"].Status)
}

func TestHandleHealth_Deep_ConfiguredFailure(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://mock")

	originalGetPool := getPool
	getPool = func(ctx context.Context) (*pgxpool.Pool, error) {
		return nil, assert.AnError
	}
	t.Cleanup(func() { getPool = originalGetPool })

	req := authenticatedBillingHealthRequest("/api/v1/billing/health?deep=true")
	w := httptest.NewRecorder()

	handleHealth(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	var report adapterhandler.HealthReport
	err := json.NewDecoder(w.Body).Decode(&report)
	require.NoError(t, err)
	assert.Equal(t, "degraded", report.Status)
	assert.NotNil(t, report.Services["database"])
	assert.Equal(t, "error", report.Services["database"].Status)
}

func TestHandler_BeforeInitHealth(t *testing.T) {
	// Bypass standard init and invoke health check direct
	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/health", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "operational")
}

func TestHandler_MuxInitAndRequest(t *testing.T) {
	originalHandlerMux := handlerMux
	resetBillingHandlerMuxForTest()
	defer func() {
		handlerMux = originalHandlerMux
		resetBillingHandlerMuxForTest()
	}()

	// Mock DB queries so the optauth middleware doesn't fail
	originalGetQueries := billinghandler.GetQueries
	billinghandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, assert.AnError
	}
	defer func() {
		billinghandler.GetQueries = originalGetQueries
	}()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/nonexistent", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestNewRouter_CORSPreflightHandled(t *testing.T) {
	router, _ := NewRouter()

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/billing/balance", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", http.MethodGet)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Equal(t, "http://localhost:3000", w.Header().Get("Access-Control-Allow-Origin"))
}

func TestNewRouter_OptionalAuthWithQueries(t *testing.T) {
	dbMock := dbtest.NewMockPool(t)

	originalGetQueries := billinghandler.GetQueries
	billinghandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(dbMock), nil
	}
	t.Cleanup(func() { billinghandler.GetQueries = originalGetQueries })

	router, _ := NewRouter()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "billing-service", w.Header().Get("X-TaskForce-Service"))
}

func TestNewRouter_AutoRechargeRouteEnforcesCSRF(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	origValidateToken := adapterhandler.ValidateToken
	adapterhandler.ValidateToken = func(string) (jwt.MapClaims, error) {
		return jwt.MapClaims{"id": float64(1), "email": "user@example.com"}, nil
	}
	t.Cleanup(func() { adapterhandler.ValidateToken = origValidateToken })

	origRevoked := adapterhandler.IsTokenRevoked
	adapterhandler.IsTokenRevoked = func(_ context.Context, _ string) bool { return false }
	t.Cleanup(func() { adapterhandler.IsTokenRevoked = origRevoked })

	router, _ := NewRouter()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/billing/auto-recharge", bytes.NewBufferString(`{"enabled":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "session_token", Value: "token-from-cookie"})
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestNewRouter_LegacyPostRouteEnforcesCSRF(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	origValidateToken := adapterhandler.ValidateToken
	adapterhandler.ValidateToken = func(string) (jwt.MapClaims, error) {
		return jwt.MapClaims{"id": float64(1), "email": "user@example.com"}, nil
	}
	t.Cleanup(func() { adapterhandler.ValidateToken = origValidateToken })

	origRevoked := adapterhandler.IsTokenRevoked
	adapterhandler.IsTokenRevoked = func(_ context.Context, _ string) bool { return false }
	t.Cleanup(func() { adapterhandler.IsTokenRevoked = origRevoked })

	router, _ := NewRouter()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/payments/create-subscription", bytes.NewBufferString(`{"price_id":"price_123"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "session_token", Value: "token-from-cookie"})
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}
