package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/inngest/inngestgo"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	handlerutil "github.com/TaskForceAI/adapters/pkg/handler"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

type fakeRedisClient struct {
	get func(ctx context.Context, key string) (string, error)
}

func (f fakeRedisClient) Get(ctx context.Context, key string) (string, error) {
	return f.get(ctx, key)
}

func (fakeRedisClient) Set(context.Context, string, []byte, time.Duration) error {
	return nil
}

func (fakeRedisClient) SetNX(context.Context, string, []byte, time.Duration) (bool, error) {
	return false, nil
}

func (fakeRedisClient) Expire(context.Context, string, time.Duration) (bool, error) {
	return false, nil
}

func (fakeRedisClient) TTL(context.Context, string) (time.Duration, error) {
	return time.Minute, nil
}

func (fakeRedisClient) Incr(context.Context, string) (int, error) {
	return 0, nil
}

func (fakeRedisClient) Del(context.Context, string) (bool, error) {
	return false, nil
}

func (fakeRedisClient) XAdd(context.Context, string, map[string]any) (string, error) {
	return "", nil
}

func (fakeRedisClient) XRead(context.Context, string, string, int64) ([]goredis.XMessage, error) {
	return nil, nil
}

func (fakeRedisClient) XTrimMaxLen(context.Context, string, int64) (int64, error) {
	return 0, nil
}

func (fakeRedisClient) Watch(context.Context, func(*goredis.Tx) error, ...string) error {
	return nil
}

func (fakeRedisClient) Eval(context.Context, string, []string, ...any) *goredis.Cmd {
	return goredis.NewCmd(context.Background())
}

func restoreHandlerDependencies(t *testing.T) {
	t.Helper()
	originalGetQueries := GetQueries
	originalRedisClientGetter := RedisClientGetter
	originalWithFlexibleAuth := WithFlexibleAuth
	t.Cleanup(func() {
		GetQueries = originalGetQueries
		RedisClientGetter = originalRedisClientGetter
		WithFlexibleAuth = originalWithFlexibleAuth
		SetEngineReadiness(false, "startup")
	})
}

func TestIsHealthRedisKeyNotFound(t *testing.T) {
	assert.False(t, isHealthRedisKeyNotFound(nil))
	assert.True(t, isHealthRedisKeyNotFound(errors.New("redis: nil")))
	assert.True(t, isHealthRedisKeyNotFound(errors.New("KEY NOT FOUND")))
	assert.False(t, isHealthRedisKeyNotFound(errors.New("connection refused")))
}

func TestIsDeepHealthCheck(t *testing.T) {
	for _, raw := range []string{"1", "true", "full", " TRUE "} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/health?deep="+url.QueryEscape(raw), nil)
		assert.True(t, IsDeepHealthCheck(req), raw)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health?deep=false", nil)
	assert.False(t, IsDeepHealthCheck(req))
}

func TestReadinessStateRoundTrip(t *testing.T) {
	restoreHandlerDependencies(t)

	SetEngineReadiness(true, "ok")
	ready, reason := GetEngineReadiness()

	assert.True(t, ready)
	assert.Equal(t, "ok", reason)
}

func TestGetHealthReportShallow(t *testing.T) {
	report := GetHealthReport(context.Background(), false)

	assert.Equal(t, "1.0.0", report.Version)
	assert.Equal(t, "connected", report.Services["database"].Status)
	assert.Equal(t, "connected", report.Services["redis"].Status)
}

func TestGetHealthReportDeepRedisStates(t *testing.T) {
	tests := []struct {
		name        string
		redisErr    error
		wantStatus  string
		wantMessage string
	}{
		{name: "missing key remains connected", redisErr: errors.New("redis: nil"), wantStatus: "connected"},
		{name: "ping error degrades redis", redisErr: errors.New("timeout"), wantStatus: "degraded", wantMessage: "redis connection degraded"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			restoreHandlerDependencies(t)
			GetQueries = func(context.Context) (*db.Queries, error) {
				return nil, nil
			}
			RedisClientGetter = func() (redis.Cmdable, error) {
				return fakeRedisClient{get: func(context.Context, string) (string, error) {
					return "", tt.redisErr
				}}, nil
			}

			report := GetHealthReport(context.Background(), true)

			assert.Equal(t, "connected", report.Services["database"].Status)
			assert.Equal(t, tt.wantStatus, report.Services["redis"].Status)
			assert.Equal(t, tt.wantMessage, report.Services["redis"].Error)
			assert.NotNil(t, report.Services["redis"].LatencyMs)
		})
	}
}

func TestGetHealthReportDeepDependencyErrors(t *testing.T) {
	restoreHandlerDependencies(t)
	GetQueries = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("database down")
	}
	RedisClientGetter = func() (redis.Cmdable, error) {
		return nil, errors.New("redis down")
	}

	report := GetHealthReport(context.Background(), true)

	assert.Equal(t, "error", report.Services["database"].Status)
	assert.Equal(t, "database connection unhealthy", report.Services["database"].Error)
	assert.Equal(t, "error", report.Services["redis"].Status)
	assert.Equal(t, "redis connection unhealthy", report.Services["redis"].Error)
}

func TestProbeOperationalDependencies(t *testing.T) {
	restoreHandlerDependencies(t)
	GetQueries = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("database down")
	}
	RedisClientGetter = func() (redis.Cmdable, error) {
		return nil, errors.New("redis down")
	}

	databaseErr, redisErr := ProbeOperationalDependencies(context.Background())

	require.Error(t, databaseErr)
	require.Error(t, redisErr)
	assert.Equal(t, "database down", databaseErr.Error())
	assert.Equal(t, "redis down", redisErr.Error())
}

func TestHandlePreInitRoute(t *testing.T) {
	restoreHandlerDependencies(t)
	SetEngineReadiness(false, "warming")

	readyReq := httptest.NewRequest(http.MethodGet, "/api/v1/ready", nil)
	readyResp := httptest.NewRecorder()
	assert.True(t, HandlePreInitRoute(readyResp, readyReq))
	assert.Equal(t, http.StatusServiceUnavailable, readyResp.Code)
	assert.Contains(t, readyResp.Body.String(), "warming")

	healthReq := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	healthResp := httptest.NewRecorder()
	assert.True(t, HandlePreInitRoute(healthResp, healthReq))
	assert.Equal(t, http.StatusOK, healthResp.Code)

	deepHealthReq := httptest.NewRequest(http.MethodGet, "/api/v1/health?deep=true", nil)
	assert.False(t, HandlePreInitRoute(httptest.NewRecorder(), deepHealthReq))

	otherReq := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
	otherResp := httptest.NewRecorder()
	assert.False(t, HandlePreInitRoute(otherResp, otherReq))
}

func TestRegisterOperationalRoutes(t *testing.T) {
	restoreHandlerDependencies(t)
	GetQueries = func(context.Context) (*db.Queries, error) {
		return nil, nil
	}
	RedisClientGetter = func() (redis.Cmdable, error) {
		return fakeRedisClient{get: func(context.Context, string) (string, error) {
			return "", errors.New("redis: nil")
		}}, nil
	}
	SetEngineReadiness(false, "warming")

	router := chi.NewRouter()
	api := humachi.New(router, huma.DefaultConfig("Engine Ops", "1.0.0"))
	RegisterOperationalRoutes(api)

	healthReq := httptest.NewRequest(http.MethodGet, "/api/v1/health?deep=true", nil)
	healthResp := httptest.NewRecorder()
	router.ServeHTTP(healthResp, healthReq)
	assert.Equal(t, http.StatusUnauthorized, healthResp.Code)

	healthReq = healthReq.WithContext(context.WithValue(healthReq.Context(), handlerutil.UserContextKey, &auth.AuthenticatedUser{ID: 42}))
	healthResp = httptest.NewRecorder()
	router.ServeHTTP(healthResp, healthReq)
	assert.Equal(t, http.StatusOK, healthResp.Code)
	assert.Contains(t, healthResp.Body.String(), "database")

	readyReq := httptest.NewRequest(http.MethodGet, "/api/v1/ready", nil)
	readyResp := httptest.NewRecorder()
	router.ServeHTTP(readyResp, readyReq)
	assert.Equal(t, http.StatusServiceUnavailable, readyResp.Code)
	assert.Contains(t, readyResp.Body.String(), "warming")

	SetEngineReadiness(true, "")
	readyReq = httptest.NewRequest(http.MethodGet, "/api/v1/ready", nil)
	readyResp = httptest.NewRecorder()
	router.ServeHTTP(readyResp, readyReq)
	assert.Equal(t, http.StatusOK, readyResp.Code)
	assert.Contains(t, readyResp.Body.String(), "ready")
}

func TestWithServiceHeadersAndCORS(t *testing.T) {
	nextCalled := false
	handler := WithServiceHeadersAndCORS(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		nextCalled = true
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.True(t, nextCalled)
	assert.Equal(t, "engine-service", resp.Header().Get("X-TaskForce-Service"))
}

func TestReadinessMiddleware(t *testing.T) {
	restoreHandlerDependencies(t)
	nextCalled := false
	handler := ReadinessMiddleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		nextCalled = true
	}))

	SetEngineReadiness(false, "database_unavailable")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	assert.False(t, nextCalled)
	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)

	req = httptest.NewRequest(http.MethodGet, "/api/v1/ready", nil)
	resp = httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	assert.True(t, nextCalled)
}

func TestInngestSignatureVerifier(t *testing.T) {
	t.Setenv("INNGEST_SIGNING_KEY", "secret")
	body := "payload"
	signature, err := inngestgo.Sign(context.Background(), time.Now(), []byte("secret"), []byte(body))
	require.NoError(t, err)

	nextCalled := false
	handler := InngestSignatureVerifier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nextCalled = true
		readBody, err := io.ReadAll(r.Body)
		assert.NoError(t, err)
		assert.Equal(t, body, string(readBody))
		w.WriteHeader(http.StatusAccepted)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/inngest", strings.NewReader(body))
	req.Header.Set("X-Inngest-Signature", signature)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.True(t, nextCalled)
	assert.Equal(t, http.StatusAccepted, resp.Code)
}

func TestInngestSignatureVerifierRejectsInvalidRequests(t *testing.T) {
	tests := []struct {
		name       string
		env        string
		signature  string
		wantStatus int
	}{
		{name: "missing production key", env: "production", wantStatus: http.StatusServiceUnavailable},
		{name: "missing signature", env: "", wantStatus: http.StatusUnauthorized},
		{name: "invalid signature", env: "", signature: "t=1&s=bad", wantStatus: http.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("NODE_ENV", tt.env)
			if tt.name == "missing production key" {
				t.Setenv("INNGEST_SIGNING_KEY", "")
			} else {
				t.Setenv("INNGEST_SIGNING_KEY", "secret")
			}
			handler := InngestSignatureVerifier(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusAccepted)
			}))

			req := httptest.NewRequest(http.MethodPost, "/api/inngest", strings.NewReader("payload"))
			if tt.signature != "" {
				req.Header.Set("X-Inngest-Signature", tt.signature)
			}
			resp := httptest.NewRecorder()
			handler.ServeHTTP(resp, req)

			assert.Equal(t, tt.wantStatus, resp.Code)
		})
	}
}

func TestAuthMiddlewareBypassesOperationalRoutes(t *testing.T) {
	restoreHandlerDependencies(t)
	nextCalled := false
	handler := AuthMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		nextCalled = true
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.True(t, nextCalled)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestAuthMiddlewareDatabaseUnavailable(t *testing.T) {
	restoreHandlerDependencies(t)
	GetQueries = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("database down")
	}

	handler := AuthMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("next handler should not run")
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
	ready, reason := GetEngineReadiness()
	assert.False(t, ready)
	assert.Equal(t, "database_unavailable", reason)
}
