package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/inngest/inngestgo"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/db"
	coreusage "github.com/TaskForceAI/core/pkg/usage"
	enginehandler "github.com/TaskForceAI/go-engine/pkg/handler"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

type noopDBTX struct{}

func (noopDBTX) Exec(ctx context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (noopDBTX) Query(ctx context.Context, query string, args ...any) (pgx.Rows, error) {
	return nil, errors.New("query not implemented")
}

func (noopDBTX) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	return pgx.Row(nil)
}

func testQueries() *db.Queries {
	return db.New(noopDBTX{})
}

func TestVoiceLimiterProvider(t *testing.T) {
	original := enginehandler.RedisClientGetter
	t.Cleanup(func() { enginehandler.RedisClientGetter = original })

	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	}
	_, err := voiceLimiterProvider()
	require.ErrorContains(t, err, "redis unavailable")

	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) { return nil, nil }
	_, err = voiceLimiterProvider()
	require.ErrorContains(t, err, "redis client is nil")

	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) { return redis.NewMockClient(), nil }
	limiter, err := voiceLimiterProvider()
	require.NoError(t, err)
	assert.NotNil(t, limiter)
}

func TestVoiceUsageWriter(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	}
	require.ErrorContains(t, voiceUsageWriter(context.Background(), coreusage.EventRow{}), "db unavailable")

	enginehandler.GetQueries = func(context.Context) (*db.Queries, error) { return testQueries(), nil }
	require.NoError(t, voiceUsageWriter(context.Background(), coreusage.EventRow{Source: "voice"}))
}

type getErrorRedis struct {
	*redis.MockClient
	err error
}

func (c *getErrorRedis) Get(ctx context.Context, key string) (string, error) {
	return "", c.err
}

func TestNewRouter_Health(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return testQueries(), nil
	}
	restore(t, &enginehandler.RedisClientGetter)
	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) {
		m := redis.NewMockClient()
		_ = m.Set(context.Background(), "health_ping", []byte("pong"), time.Minute)
		return m, nil
	}

	router, _ := NewRouter(nil)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/health", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestNewRouter_DoesNotExposeProcessLocalTeamAPI(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(ctx context.Context) (*db.Queries, error) { return testQueries(), nil }
	restore(t, &enginehandler.RedisClientGetter)
	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) { return redis.NewMockClient(), nil }

	_, api := NewRouter(nil)
	for path := range api.OpenAPI().Paths {
		assert.NotContains(t, path, "/api/v1/team")
	}
}

func TestNewEngineAPIRedisClient(t *testing.T) {
	original := getRedisClientForEngineAPI
	t.Cleanup(func() { getRedisClientForEngineAPI = original })

	expected := redis.NewMockClient()
	getRedisClientForEngineAPI = func() (redis.Cmdable, error) {
		return expected, nil
	}

	client, err := newEngineAPIRedisClient()
	require.NoError(t, err)
	require.Same(t, expected, client)

	getRedisClientForEngineAPI = func() (redis.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	}

	client, err = newEngineAPIRedisClient()
	require.Nil(t, client)
	require.ErrorContains(t, err, "redis unavailable")
}

func TestNewRouter_Ready(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return testQueries(), nil
	}
	restore(t, &enginehandler.RedisClientGetter)
	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) {
		return redis.NewMockClient(), nil
	}

	router, _ := NewRouter(nil)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/ready", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "ready")
}

func TestGetHealthReport_DeepError(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("db fail")
	}
	restore(t, &enginehandler.RedisClientGetter)
	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) {
		return nil, errors.New("redis fail")
	}

	report := enginehandler.GetHealthReport(context.Background(), true)
	assert.Equal(t, "error", report.Services["database"].Status)
	assert.Equal(t, "error", report.Services["redis"].Status)
}

func TestGetHealthReport_DeepRedisErrorSanitized(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return testQueries(), nil
	}
	restore(t, &enginehandler.RedisClientGetter)
	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) {
		return &getErrorRedis{
			MockClient: redis.NewMockClient(),
			err:        errors.New("ERR invalid password for redis://10.0.0.5:6379"),
		}, nil
	}

	report := enginehandler.GetHealthReport(context.Background(), true)
	assert.Equal(t, "degraded", report.Services["redis"].Status)
	assert.Equal(t, "redis connection degraded", report.Services["redis"].Error)
	assert.NotContains(t, report.Services["redis"].Error, "10.0.0.5")
}

func TestHandler_NotFound(t *testing.T) {
	// Reset global handler state so sync.Once re-initializes with our mocks.
	handlerMux = nil
	muxOnce = sync.Once{}
	enginehandler.SetEngineReadiness(false, "startup")

	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return testQueries(), nil
	}
	restore(t, &enginehandler.RedisClientGetter)
	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) {
		m := redis.NewMockClient()
		_ = m.Set(context.Background(), "health_ping", []byte("pong"), time.Minute)
		return m, nil
	}
	t.Cleanup(func() {
		handlerMux = nil
		muxOnce = sync.Once{}
		enginehandler.SetEngineReadiness(false, "startup")
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/unknown", nil)
	resp := httptest.NewRecorder()
	Handler(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestInngestSignatureVerifier_InvalidSignature(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("INNGEST_SIGNING_KEY", "test-signing-key")

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := enginehandler.InngestSignatureVerifier(next)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/inngest", strings.NewReader(`{"event":"ping"}`))
	req.Header.Set("X-Inngest-Signature", "s=invalid")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestIsDeepHealthCheck(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/?deep=true", nil)
	assert.True(t, enginehandler.IsDeepHealthCheck(req))

	req = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/?deep=1", nil)
	assert.True(t, enginehandler.IsDeepHealthCheck(req))

	req = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	assert.False(t, enginehandler.IsDeepHealthCheck(req))
}

func TestNewRouter_RedisFailure(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return testQueries(), nil
	}
	restore(t, &enginehandler.RedisClientGetter)
	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) {
		return nil, errors.New("redis down")
	}

	router, _ := NewRouter(nil)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/run", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestNewRouter_StreamRouteMounted(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return testQueries(), nil
	}
	restore(t, &enginehandler.RedisClientGetter)
	enginehandler.RedisClientGetter = func() (redis.Cmdable, error) {
		return redis.NewMockClient(), nil
	}

	router, _ := NewRouter(nil)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodOptions, "/api/v1/stream/task_1", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
}

func TestNewRouter_DBFailure(t *testing.T) {
	restore(t, &enginehandler.GetQueries)
	enginehandler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	}

	// NewRouter should still return a router, but engine readiness will be false
	router, _ := NewRouter(nil)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/health", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	// In NewRouter, if DB is down, it calls setEngineReadiness(false, "database_unavailable")
	// and routes check getEngineReadiness().
	req = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/run", nil)
	resp = httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestHandler_InitializesRouterAndAsyncObservability(t *testing.T) {
	handlerMux = nil
	muxOnce = sync.Once{}
	enginehandler.SetEngineReadiness(true, "ok")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/health", nil)
	resp := httptest.NewRecorder()
	Handler(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)

	time.Sleep(50 * time.Millisecond)
}

func TestHandler_Health(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/health", nil)
	resp := httptest.NewRecorder()
	Handler(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestHandler_Ready(t *testing.T) {
	enginehandler.SetEngineReadiness(true, "ok")
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/ready", nil)
	resp := httptest.NewRecorder()
	Handler(resp, req)
	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestInngestSignatureVerifier_MissingSignature(t *testing.T) {
	t.Setenv("INNGEST_SIGNING_KEY", "key")
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {})
	h := enginehandler.InngestSignatureVerifier(next)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/inngest", nil)
	resp := httptest.NewRecorder()
	h.ServeHTTP(resp, req)
	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestInngestSignatureVerifier_MissingSigningKeyInProduction(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("INNGEST_SIGNING_KEY", "")

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := enginehandler.InngestSignatureVerifier(next)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/inngest", strings.NewReader(`{"event":"ping"}`))
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestInngestSignatureVerifier_ValidSignature(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("INNGEST_SIGNING_KEY", "test-signing-key")

	body := `{"event":"ping"}`
	signature, err := inngestgo.Sign(context.Background(), time.Now(), []byte("test-signing-key"), []byte(body))
	require.NoError(t, err)

	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})
	handler := enginehandler.InngestSignatureVerifier(next)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/inngest", strings.NewReader(body))
	req.Header.Set("X-Inngest-Signature", signature)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.True(t, nextCalled)
}

func TestInngestSignatureVerifier_RequestBodyTooLarge(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("INNGEST_SIGNING_KEY", "test-signing-key")

	body := strings.Repeat("a", (1<<20)+1)

	nextCalled := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		nextCalled = true
		w.WriteHeader(http.StatusNoContent)
	})
	handler := enginehandler.InngestSignatureVerifier(next)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/inngest", strings.NewReader(body))
	req.Header.Set("X-Inngest-Signature", "s=present")
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, resp.Code)
	assert.False(t, nextCalled)
}
