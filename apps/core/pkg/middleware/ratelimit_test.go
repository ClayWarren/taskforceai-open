package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

// MockRedis is a mock of the Redis Cmdable interface.
type MockRedis struct {
	mock.Mock
}

func (m *MockRedis) Get(ctx context.Context, key string) (string, error) {
	args := m.Called(ctx, key)
	return args.String(0), args.Error(1)
}

func (m *MockRedis) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	args := m.Called(ctx, key, value, ttl)
	return args.Error(0)
}

func (m *MockRedis) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	args := m.Called(ctx, key, value, ttl)
	return args.Bool(0), args.Error(1)
}

func (m *MockRedis) Expire(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	args := m.Called(ctx, key, ttl)
	return args.Bool(0), args.Error(1)
}

func (m *MockRedis) TTL(ctx context.Context, key string) (time.Duration, error) {
	args := m.Called(ctx, key)
	if ttl, ok := args.Get(0).(time.Duration); ok {
		return ttl, args.Error(1)
	}
	return time.Minute, args.Error(1)
}

func (m *MockRedis) Incr(ctx context.Context, key string) (int, error) {
	args := m.Called(ctx, key)
	return args.Int(0), args.Error(1)
}

func (m *MockRedis) Del(ctx context.Context, key string) (bool, error) {
	args := m.Called(ctx, key)
	return args.Bool(0), args.Error(1)
}

func (m *MockRedis) XAdd(ctx context.Context, stream string, values map[string]any) (string, error) {
	args := m.Called(ctx, stream, values)
	return args.String(0), args.Error(1)
}

func (m *MockRedis) XRead(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
	args := m.Called(ctx, stream, lastID, count)
	val, _ := args.Get(0).([]goredis.XMessage)
	return val, args.Error(1)
}

func (m *MockRedis) XTrimMaxLen(ctx context.Context, stream string, maxLen int64) (int64, error) {
	args := m.Called(ctx, stream, maxLen)
	val, _ := args.Get(0).(int64)
	return val, args.Error(1)
}

func (m *MockRedis) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	args := m.Called(ctx, fn, keys)
	return args.Error(0)
}

func (m *MockRedis) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	callArgs := m.Called(ctx, script, keys, args)
	cmd := goredis.NewCmd(ctx)
	if err := callArgs.Error(1); err != nil {
		cmd.SetErr(err)
		return cmd
	}
	cmd.SetVal(callArgs.Get(0))
	return cmd
}

func TestWithRateLimit_NoRedis(t *testing.T) {
	infraredis.ResetClient()
	infraredis.SetClient(nil)
	t.Cleanup(infraredis.ResetClient)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := WithRateLimit(10, time.Minute)(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	resp := httptest.NewRecorder()

	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
	assert.Equal(t, "60", resp.Header().Get("Retry-After"))
}

func TestWithRateLimit_BypassPublicOperationalEndpointsWhenRedisUnavailable(t *testing.T) {
	infraredis.ResetClient()
	infraredis.SetClient(nil)
	t.Cleanup(infraredis.ResetClient)

	for _, path := range []string{"/api/v1/health", "/api/v1/models"} {
		nextCalled := false
		nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			nextCalled = true
			w.WriteHeader(http.StatusOK)
		})

		handler := WithRateLimit(10, time.Minute)(nextHandler)

		req := httptest.NewRequest(http.MethodGet, path, nil)
		resp := httptest.NewRecorder()
		handler.ServeHTTP(resp, req)

		assert.True(t, nextCalled, "expected next handler for %s", path)
		assert.Equal(t, http.StatusOK, resp.Code)
	}
}

func TestWithRateLimit_StatusRequiresRedis(t *testing.T) {
	infraredis.ResetClient()
	infraredis.SetClient(nil)
	t.Cleanup(infraredis.ResetClient)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("status endpoint should not bypass the limiter when Redis is unavailable")
	})
	handler := WithRateLimit(10, time.Minute)(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/status", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
	assert.Equal(t, "60", resp.Header().Get("Retry-After"))
}

func TestWithRateLimit_StatusConsumesSharedBucket(t *testing.T) {
	infraredis.SetClient(infraredis.NewMockClient())
	t.Cleanup(infraredis.ResetClient)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := WithRateLimit(1, time.Minute)(nextHandler)

	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/v1/status", nil))

	second := httptest.NewRecorder()
	handler.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/api/v1/status", nil))

	assert.Equal(t, http.StatusOK, first.Code)
	assert.Equal(t, "1", first.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "0", first.Header().Get("X-RateLimit-Remaining"))
	assert.Equal(t, http.StatusTooManyRequests, second.Code)
	assert.Equal(t, "1", second.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "0", second.Header().Get("X-RateLimit-Remaining"))
}

func TestWithRateLimit_Allowed(t *testing.T) {
	mockRedis := infraredis.NewMockClient()
	infraredis.SetClient(mockRedis)
	t.Cleanup(infraredis.ResetClient)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := WithRateLimit(10, time.Minute)(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	resp := httptest.NewRecorder()

	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, "10", resp.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "9", resp.Header().Get("X-RateLimit-Remaining"))
}

func TestWithRateLimit_Denied(t *testing.T) {
	mockRedis := infraredis.NewMockClient()
	for range 10 {
		_, _, _, err := mockRedis.CheckRateLimit(
			context.Background(), "core_rl:u:ip:unknown", 10, time.Minute,
		)
		require.NoError(t, err)
	}
	infraredis.SetClient(mockRedis)
	t.Cleanup(infraredis.ResetClient)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Next handler should not be called")
	})

	handler := WithRateLimit(10, time.Minute)(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	resp := httptest.NewRecorder()

	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusTooManyRequests, resp.Code)
	assert.Equal(t, "10", resp.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "0", resp.Header().Get("X-RateLimit-Remaining"))
	assert.NotEmpty(t, resp.Header().Get("Retry-After"))
}

func TestWithRateLimit_RedisError_FailsClosed(t *testing.T) {
	mockRedis := new(MockRedis)
	infraredis.SetClient(mockRedis)
	t.Cleanup(infraredis.ResetClient)

	mockRedis.On("Eval", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil, assert.AnError)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := WithRateLimit(10, time.Minute)(nextHandler)

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	resp := httptest.NewRecorder()

	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
	assert.Equal(t, "60", resp.Header().Get("Retry-After"))
	mockRedis.AssertExpectations(t)
}

func TestGetRequestIdentity(t *testing.T) {
	// Test IP headers
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 5.6.7.8")
	assert.Equal(t, "ip:5.6.7.8", getRequestIdentity(req))

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Real-IP", "2.3.4.5")
	assert.Equal(t, "ip:2.3.4.5", getRequestIdentity(req))

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	assert.Equal(t, "ip:unknown", getRequestIdentity(req))
}

func TestWithRateLimit_DifferentAuthenticatedUsersDoNotShareBucket(t *testing.T) {
	infraredis.SetClient(infraredis.NewMockClient())
	t.Cleanup(infraredis.ResetClient)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := WithRateLimit(1, time.Minute)(nextHandler)

	reqA := httptest.NewRequest(http.MethodGet, "/test", nil)
	reqA.Header.Set("X-Forwarded-For", "1.2.3.4")
	reqA = reqA.WithContext(context.WithValue(reqA.Context(), adapterhandler.UserContextKey, &auth.AuthenticatedUser{ID: 101}))
	respA := httptest.NewRecorder()
	handler.ServeHTTP(respA, reqA)

	reqB := httptest.NewRequest(http.MethodGet, "/test", nil)
	reqB.Header.Set("X-Forwarded-For", "1.2.3.4")
	reqB = reqB.WithContext(context.WithValue(reqB.Context(), adapterhandler.UserContextKey, &auth.AuthenticatedUser{ID: 202}))
	respB := httptest.NewRecorder()
	handler.ServeHTTP(respB, reqB)

	assert.Equal(t, http.StatusOK, respA.Code)
	assert.Equal(t, http.StatusOK, respB.Code)
}

func TestWithRateLimit_SameAuthenticatedUserIsLimitedAcrossPaths(t *testing.T) {
	infraredis.SetClient(infraredis.NewMockClient())
	t.Cleanup(infraredis.ResetClient)

	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := WithRateLimit(1, time.Minute)(nextHandler)

	reqA := httptest.NewRequest(http.MethodGet, "/path-a", nil)
	reqA.Header.Set("X-Forwarded-For", "9.8.7.6")
	reqA = reqA.WithContext(context.WithValue(reqA.Context(), adapterhandler.UserContextKey, &auth.AuthenticatedUser{ID: 303}))
	respA := httptest.NewRecorder()
	handler.ServeHTTP(respA, reqA)

	reqB := httptest.NewRequest(http.MethodGet, "/path-b", nil)
	reqB.Header.Set("X-Forwarded-For", "9.8.7.6")
	reqB = reqB.WithContext(context.WithValue(reqB.Context(), adapterhandler.UserContextKey, &auth.AuthenticatedUser{ID: 303}))
	respB := httptest.NewRecorder()
	handler.ServeHTTP(respB, reqB)

	assert.Equal(t, http.StatusOK, respA.Code)
	assert.Equal(t, http.StatusTooManyRequests, respB.Code)
}
