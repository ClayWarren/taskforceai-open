package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	devhandler "github.com/TaskForceAI/developer-service/pkg/handler"
	ratelimit "github.com/TaskForceAI/infrastructure/ratelimit/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func authenticatedDeveloperHealthRequest(target string) *http.Request {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, target, nil)
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, &auth.AuthenticatedUser{ID: 42})
	return req.WithContext(ctx)
}

func TestHandleDebug_Disabled(t *testing.T) {
	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "")
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/debug", nil)
	w := httptest.NewRecorder()

	adapterhandler.HandleDebug(w, req)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHandleDebug_Enabled(t *testing.T) {
	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "true")
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/debug", nil)
	w := httptest.NewRecorder()

	adapterhandler.HandleDebug(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]any
	err := json.NewDecoder(w.Body).Decode(&resp)
	require.NoError(t, err)
	assert.Equal(t, "/api/v1/developer/debug", resp["received_path"])
}

func TestHandleHealthCheck_NoDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/health", nil)
	w := httptest.NewRecorder()

	handleHealthCheck(w, req)
	assert.Equal(t, http.StatusOK, w.Code)

	var report adapterhandler.HealthReport
	err := json.NewDecoder(w.Body).Decode(&report)
	require.NoError(t, err)
	assert.Equal(t, "operational", report.Status)
	assert.NotNil(t, report.Services["database"])
	assert.Equal(t, "connected", report.Services["database"].Status)
}

func TestHandleHealthCheck_DeepRequiresAuthentication(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/health?deep=true", nil)
	w := httptest.NewRecorder()

	handleHealthCheck(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestNewRouter_UsesQueriesProvider(t *testing.T) {
	// Note: NewRouter now registers handlers unconditionally and resolves dependencies lazily.
	// This test confirms the router and API objects are created correctly.
	router, api := NewRouter()
	assert.NotNil(t, router)
	assert.NotNil(t, api)
}

func TestWithDeveloperDashboardRateLimits_RoutesBudgets(t *testing.T) {
	tests := []struct {
		name      string
		method    string
		path      string
		wantRead  int
		wantWrite int
	}{
		{name: "list keys", method: http.MethodGet, path: "/api/v1/developer/keys", wantRead: 1},
		{name: "usage", method: http.MethodGet, path: "/api/v1/developer/usage", wantRead: 1},
		{name: "create key", method: http.MethodPost, path: "/api/v1/developer/keys", wantWrite: 1},
		{name: "revoke key", method: http.MethodDelete, path: "/api/v1/developer/keys", wantWrite: 1},
		{name: "health bypass", method: http.MethodGet, path: "/api/v1/developer/health"},
		{name: "engine proxy bypass", method: http.MethodPost, path: "/api/v1/developer/run"},
		{name: "preflight bypass", method: http.MethodOptions, path: "/api/v1/developer/keys"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			readCalls := 0
			writeCalls := 0
			nextCalls := 0
			marker := func(calls *int) func(http.Handler) http.Handler {
				return func(next http.Handler) http.Handler {
					return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						*calls++
						next.ServeHTTP(w, r)
					})
				}
			}

			handler := withDeveloperDashboardRateLimits(marker(&readCalls), marker(&writeCalls))(
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					nextCalls++
					w.WriteHeader(http.StatusNoContent)
				}),
			)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))

			assert.Equal(t, tc.wantRead, readCalls)
			assert.Equal(t, tc.wantWrite, writeCalls)
			assert.Equal(t, 1, nextCalls)
			assert.Equal(t, http.StatusNoContent, w.Code)
		})
	}
}

func TestHandler_WritesHealthResponse(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/health", nil)
	w := httptest.NewRecorder()

	Handler(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.NotEmpty(t, w.Header().Get("X-Content-Type-Options"))
}

func TestIsDeepHealthCheck(t *testing.T) {
	tests := []struct {
		query    string
		expected bool
	}{
		{"deep=1", true},
		{"deep=true", true},
		{"deep=TRUE", true},
		{"deep=full", true},
		{"deep=FULL", true},
		{"deep=0", false},
		{"deep=false", false},
		{"deep=", false},
		{"", false},
		{"other=value", false},
	}

	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/health?"+tt.query, nil)
			result := adapterhandler.IsDeepHealthCheck(req)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestNewRouter_SetsServiceHeader(t *testing.T) {
	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/health", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, "developer-service", w.Header().Get("X-TaskForce-Service"))
}

func TestNewRouter_HandlesCORSPreflight(t *testing.T) {
	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodOptions, "/api/v1/developer/keys", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Equal(t, "http://localhost:3000", w.Header().Get("Access-Control-Allow-Origin"))
}

func TestNewRouter_404NotFound(t *testing.T) {
	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/nonexistent", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestNewRouter_ProxiesOrchestrationRoutes(t *testing.T) {
	router, _ := NewRouter()

	routes := []string{
		"/api/v1/developer/run",
		"/api/v1/developer/status",
		"/api/v1/developer/results",
		"/api/v1/developer/threads",
	}

	for _, route := range routes {
		t.Run(route, func(t *testing.T) {
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, route, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			assert.NotEqual(t, http.StatusNotFound, w.Code, "route %s should not return 404", route)
		})
	}
}

func TestNewRouter_RejectsInvalidBearerForEngineProxy(t *testing.T) {
	withTokenValidation(t, func(string) (jwt.MapClaims, error) {
		return nil, assert.AnError
	})

	proxied := false
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxied = true
		w.WriteHeader(http.StatusNoContent)
	}))
	defer engine.Close()

	t.Setenv("ENGINE_SERVICE_URL", engine.URL)
	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/developer/run", bytes.NewBufferString(`{"prompt":"test"}`))
	req.Header.Set("Authorization", "Bearer invalid-token")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.False(t, proxied)
}

func TestNewRouter_RequiresAuthForEngineProxy(t *testing.T) {
	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/run", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestNewRouter_AllowsValidBearerForEngineProxy(t *testing.T) {
	withTokenValidation(t, func(string) (jwt.MapClaims, error) {
		return jwt.MapClaims{"id": float64(1), "email": "test@example.com"}, nil
	})

	proxied := false
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxied = true
		w.WriteHeader(http.StatusNoContent)
	}))
	defer engine.Close()

	t.Setenv("ENGINE_SERVICE_URL", engine.URL)
	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/developer/run", bytes.NewBufferString(`{"prompt":"test"}`))
	req.Header.Set("Authorization", "Bearer valid-token")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.True(t, proxied)
}

func TestHandler_DoesNotHonorQueryPathOverrideOnConcretePath(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/keys?__path=v1/developer/health", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestGetRateLimitRedisClient_UsesDeveloperEnvFallback(t *testing.T) {
	rateLimitRedisClient = nil
	rateLimitRedisOnce = sync.Once{}
	adapterhandler.SetRedisClient(nil)
	redis.ResetClient()

	t.Setenv("REDIS_URL", "redis://localhost:6379")

	client := getRateLimitRedisClient()
	assert.NotNil(t, client)
}

func TestGetRateLimitRedisClient_UsesSharedClient(t *testing.T) {
	rateLimitRedisClient = nil
	rateLimitRedisOnce = sync.Once{}

	sharedClient := &mockRedisClient{}
	adapterhandler.SetRedisClient(sharedClient)
	t.Cleanup(func() { adapterhandler.SetRedisClient(nil) })

	client := getRateLimitRedisClient()
	assert.Equal(t, sharedClient, client)
}

func TestGetRateLimitRedisClient_ReturnsNilWhenFallbackUnavailable(t *testing.T) {
	rateLimitRedisClient = nil
	rateLimitRedisOnce = sync.Once{}
	adapterhandler.SetRedisClient(nil)
	redis.ResetClient()

	t.Setenv("REDIS_URL", "")

	client := getRateLimitRedisClient()
	assert.Nil(t, client)
}

func TestShouldProxyEnginePath_BoundaryMatching(t *testing.T) {
	assert.True(t, shouldProxyEnginePath("/api/v1/developer/run"))
	assert.True(t, shouldProxyEnginePath("/api/v1/developer/status/abc"))
	assert.True(t, shouldProxyEnginePath("/api/v1/developer/results/123"))
	assert.True(t, shouldProxyEnginePath("/api/v1/developer/threads/1"))
	assert.True(t, shouldProxyEnginePath("/api/v1/developer/storage"))
	assert.True(t, shouldProxyEnginePath("/api/v1/developer/files"))
	assert.True(t, shouldProxyEnginePath("/api/v1/developer/files/file-1/content"))

	assert.False(t, shouldProxyEnginePath("/api/v1/developer/runaway"))
	assert.False(t, shouldProxyEnginePath("/api/v1/developer/status-bypass"))
	assert.False(t, shouldProxyEnginePath("/api/v1/developer/resultsX"))
	assert.False(t, shouldProxyEnginePath("/api/v1/developer/threads2"))
	assert.False(t, shouldProxyEnginePath("/api/v1/developer/storage-extra"))
	assert.False(t, shouldProxyEnginePath("/api/v1/developer/filesX"))
}

func TestHandler_BeforeInitHealthAppliesRateLimit(t *testing.T) {
	devhandler.SetRateLimitDeps(&devhandler.RateLimitDeps{
		GetRedis: func() any { return struct{}{} },
		GetOrgID: func(r *http.Request) int { return 1 },
		JSONError: func(w http.ResponseWriter, code int, message string) {
			w.WriteHeader(code)
		},
		NewLimiter: func(redis any, prefix string) devhandler.RateLimitChecker {
			return deniedRateLimitChecker{}
		},
	})
	t.Cleanup(func() {
		initRateLimitDeps()
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/health", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusTooManyRequests, w.Code)
}

type deniedRateLimitChecker struct{}

func (deniedRateLimitChecker) Check(ctx any, key string, limit int, window time.Duration) (*devhandler.RateLimitResult, error) {
	return &devhandler.RateLimitResult{
		Allowed:   false,
		Remaining: 0,
		ResetTime: time.Now().Add(time.Minute),
	}, nil
}

func (deniedRateLimitChecker) CheckOrg(ctx any, orgID int32, limit int, window time.Duration) (*devhandler.RateLimitResult, error) {
	return &devhandler.RateLimitResult{
		Allowed:   false,
		Remaining: 0,
		ResetTime: time.Now().Add(time.Minute),
	}, nil
}

func TestHandler_BeforeInitPath(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/health", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "operational")
}

func TestRateLimiterAdapter_ReturnsLimiterErrors(t *testing.T) {
	adapter := &rateLimiterAdapter{limiter: errorRateLimiter{}}

	result, err := adapter.Check(context.Background(), "key", 10, time.Minute)
	require.Error(t, err)
	assert.Nil(t, result)

	result, err = adapter.CheckOrg(context.Background(), 42, 10, time.Minute)
	require.Error(t, err)
	assert.Nil(t, result)
}

type errorRateLimiter struct{}

func (errorRateLimiter) Check(context.Context, string, int, time.Duration) (*ratelimit.RateLimitResult, error) {
	return nil, assert.AnError
}

func (errorRateLimiter) CheckOrg(context.Context, int32, int, time.Duration) (*ratelimit.RateLimitResult, error) {
	return nil, assert.AnError
}

func TestHandleHealthCheck_DeepCheck(t *testing.T) {
	req := authenticatedDeveloperHealthRequest("/api/v1/developer/health?deep=1")
	w := httptest.NewRecorder()

	handleHealthCheck(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestNewRouter_NotFoundLogging(t *testing.T) {
	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/unknown-route", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestNewRouter_OptionalAuthMiddleware(t *testing.T) {
	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/debug", nil)
	req.Header.Set("X-Debug-Endpoints-Enabled", "true")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.NotEqual(t, http.StatusUnauthorized, w.Code)
}

func TestNewRouter_UsesOptionalAuthWhenDatabaseUnavailable(t *testing.T) {
	restore(t, &devhandler.GetQueries)
	devhandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, assert.AnError
	}

	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/debug", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestNewRouter_RequiresCSRFForCookieAuthenticatedWrites(t *testing.T) {
	withTokenValidation(t, func(tokenString string) (jwt.MapClaims, error) {
		return jwt.MapClaims{"id": float64(1), "email": "test@example.com"}, nil
	})

	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/developer/keys", bytes.NewBufferString("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "session_token", Value: "test-token"})

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestNewRateLimiterAdapter_NilRedis(t *testing.T) {
	result := newRateLimiterAdapter(nil, "test")
	assert.Nil(t, result)
}

func TestNewRateLimiterAdapter_WrongType(t *testing.T) {
	result := newRateLimiterAdapter("not-a-redis-client", "test")
	assert.Nil(t, result)
}

func TestSlogAdapter(t *testing.T) {
	adapter := slogAdapter{}
	adapter.Error("test error", "key", "value")
	adapter.Warn("test warn", "key", "value")
}

func TestHandler_InitHandler(t *testing.T) {
	restore(t, &serviceDeps)
	originalHandlerMux := handlerMux
	originalHandlerInitialized := originalHandlerMux != nil
	handlerMux = nil
	muxOnce = sync.Once{}
	defer func() {
		handlerMux = originalHandlerMux
		muxOnce = sync.Once{}
		if originalHandlerInitialized {
			muxOnce.Do(func() {})
		}
	}()

	tracerCalled := false
	meterCalled := false
	serviceDeps = &ServiceDeps{
		InitTracer: func(serviceName string) (func(), error) {
			tracerCalled = true
			return func() {}, nil
		},
		InitMeter: func(serviceName string) (func(), error) {
			meterCalled = true
			return func() {}, nil
		},
	}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/unknown", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.True(t, tracerCalled)
	assert.True(t, meterCalled)
}

func TestHandler_InitHandlerTelemetryErrors(t *testing.T) {
	restore(t, &serviceDeps)
	originalHandlerMux := handlerMux
	originalHandlerInitialized := originalHandlerMux != nil
	handlerMux = nil
	muxOnce = sync.Once{}
	defer func() {
		handlerMux = originalHandlerMux
		muxOnce = sync.Once{}
		if originalHandlerInitialized {
			muxOnce.Do(func() {})
		}
	}()

	serviceDeps = &ServiceDeps{
		InitTracer: func(serviceName string) (func(), error) {
			return nil, assert.AnError
		},
		InitMeter: func(serviceName string) (func(), error) {
			return nil, assert.AnError
		},
	}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/unknown", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

type mockRedisClient struct{}

func (m *mockRedisClient) Get(ctx context.Context, key string) (string, error) {
	return "", nil
}
func (m *mockRedisClient) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return nil
}
func (m *mockRedisClient) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	return true, nil
}
func (m *mockRedisClient) Del(ctx context.Context, key string) (bool, error) {
	return true, nil
}
func (m *mockRedisClient) Incr(ctx context.Context, key string) (int, error) {
	return 1, nil
}
func (m *mockRedisClient) Expire(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	return true, nil
}
func (m *mockRedisClient) TTL(ctx context.Context, key string) (time.Duration, error) {
	return time.Minute, nil
}
func (m *mockRedisClient) XAdd(ctx context.Context, stream string, values map[string]any) (string, error) {
	return "", nil
}
func (m *mockRedisClient) XRead(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
	return nil, nil
}
func (m *mockRedisClient) XTrimMaxLen(ctx context.Context, stream string, maxLen int64) (int64, error) {
	return 0, nil
}
func (m *mockRedisClient) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	return nil
}
func (m *mockRedisClient) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	if len(args) < 3 {
		cmd.SetErr(assert.AnError)
		return cmd
	}

	windowMillis := args[0].(int64)
	limit := args[1].(int)
	now := time.Now().UnixMilli()
	cmd.SetVal([]any{int64(1), int64(limit - 1), now + windowMillis})
	return cmd
}

var _ redis.Cmdable = (*mockRedisClient)(nil)

func TestRateLimiterAdapter_Check(t *testing.T) {
	mockRedis := &mockRedisClient{}
	limiter := newRateLimiterAdapter(mockRedis, "test")
	assert.NotNil(t, limiter)

	result, err := limiter.Check(context.Background(), "test-key", 100, time.Minute)
	require.NoError(t, err)
	assert.NotNil(t, result)
}

func TestRateLimiterAdapter_CheckOrg(t *testing.T) {
	mockRedis := &mockRedisClient{}
	limiter := newRateLimiterAdapter(mockRedis, "test")
	assert.NotNil(t, limiter)

	result, err := limiter.CheckOrg(context.Background(), 123, 100, time.Minute)
	require.NoError(t, err)
	assert.NotNil(t, result)
}

func TestInitRateLimitDeps(t *testing.T) {
	initRateLimitDeps()
}

func TestEnsureProxyEngineAuth_Authenticated(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/run", nil)
	user := &auth.AuthenticatedUser{ID: 123}
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, user))
	w := httptest.NewRecorder()

	authReq, ok := ensureProxyEngineAuth(w, req)
	assert.True(t, ok)
	assert.Equal(t, req, authReq)
}

func TestEnsureProxyEngineAuth_NoAPIKey(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/run", nil)
	w := httptest.NewRecorder()

	authReq, ok := ensureProxyEngineAuth(w, req)
	assert.False(t, ok)
	assert.Nil(t, authReq)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestEnsureProxyEngineAuth_DatabaseError(t *testing.T) {
	restore(t, &devhandler.GetQueries)
	devhandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, assert.AnError
	}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/run", nil)
	req.Header.Set("x-api-key", "test-key")
	w := httptest.NewRecorder()

	authReq, ok := ensureProxyEngineAuth(w, req)
	assert.False(t, ok)
	assert.Nil(t, authReq)
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestEnsureProxyEngineAuth_WithAPIKeyRejected(t *testing.T) {
	restore(t, &devhandler.GetQueries)
	devhandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}
	restore(t, &devhandler.WithAPIKeyIdentity)
	devhandler.WithAPIKeyIdentity = func(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
		}
	}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/run", nil)
	req.Header.Set("x-api-key", "invalid-key")
	w := httptest.NewRecorder()

	authReq, ok := ensureProxyEngineAuth(w, req)
	assert.False(t, ok)
	assert.Nil(t, authReq)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestEnsureProxyEngineAuth_WithAPIKeyAccepted(t *testing.T) {
	restore(t, &devhandler.GetQueries)
	devhandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}
	restore(t, &devhandler.WithAPIKeyIdentity)
	devhandler.WithAPIKeyIdentity = func(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			next(w, r)
		}
	}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/run", nil)
	req.Header.Set("x-api-key", "valid-key")
	w := httptest.NewRecorder()

	authReq, ok := ensureProxyEngineAuth(w, req)
	assert.True(t, ok)
	assert.NotNil(t, authReq)
}

func TestNewRouter_ProxiesDeveloperEngineFallbackRoutes(t *testing.T) {
	restore(t, &adapterhandler.ProxyEngineHandler)
	adapterhandler.ProxyEngineHandler = func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Proxied-To", "engine")
		w.WriteHeader(http.StatusAccepted)
	}

	router, _ := NewRouter()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/run/test", nil)
	user := &auth.AuthenticatedUser{ID: 123}
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, user))
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusAccepted, w.Code)
	assert.Equal(t, "engine", w.Header().Get("X-Proxied-To"))
}

func TestNewRouter_ProxiesDeveloperEngineFallbackRoutesWithAPIKey(t *testing.T) {
	restore(t, &devhandler.GetQueries)
	devhandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}
	restore(t, &devhandler.WithAPIKeyIdentity)
	devhandler.WithAPIKeyIdentity = func(q *db.Queries, next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			user := &auth.AuthenticatedUser{ID: 456, Email: "developer@example.com"}
			ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
			next(w, r.WithContext(ctx))
		}
	}
	restore(t, &adapterhandler.ProxyEngineHandler)
	adapterhandler.ProxyEngineHandler = func(w http.ResponseWriter, r *http.Request) {
		user := adapterhandler.GetAuthenticatedUser(r)
		if !assert.NotNil(t, user) {
			return
		}
		assert.Equal(t, 456, user.ID)
		w.Header().Set("X-Proxied-To", "engine")
		w.WriteHeader(http.StatusAccepted)
	}

	router, _ := NewRouter()

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/developer/run", bytes.NewBufferString(`{"prompt":"test"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", "tfai_valid")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusAccepted, w.Code)
	assert.Equal(t, "engine", w.Header().Get("X-Proxied-To"))
}

func TestNewRouter_DoesNotProxyNearDeveloperEnginePrefixes(t *testing.T) {
	restore(t, &adapterhandler.ProxyEngineHandler)
	adapterhandler.ProxyEngineHandler = func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}

	router, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/runaway", nil)
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestHandleHealthCheck_DeepCheckWithDB(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://mock")
	restore(t, &devhandler.GetPool)
	devhandler.GetPool = func(ctx context.Context) (*pgxpool.Pool, error) {
		return nil, assert.AnError
	}

	req := authenticatedDeveloperHealthRequest("/api/v1/developer/health?deep=true")
	w := httptest.NewRecorder()

	handleHealthCheck(w, req)
	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	var report adapterhandler.HealthReport
	err := json.NewDecoder(w.Body).Decode(&report)
	require.NoError(t, err)
	assert.Equal(t, "degraded", report.Status)
}

func TestRateLimiterAdapter_CanceledContext(t *testing.T) {
	limiter := &rateLimiterAdapter{}
	res, err := limiter.Check("not-a-context", "key", 10, time.Minute)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "context.Context")
	assert.Nil(t, res)

	resOrg, err := limiter.CheckOrg("not-a-context", 123, 10, time.Minute)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "context.Context")
	assert.Nil(t, resOrg)
}
