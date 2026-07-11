package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
)

type evalRateLimitRedis struct {
	*redis.MockClient
	mu      sync.Mutex
	entries map[string][]int64
}

type allowRateLimitRedis struct {
	*redis.MockClient
}

type errorRateLimitRedis struct {
	*redis.MockClient
}

type unsupportedRateLimitRedis struct{}

type discardRateLimitWriter struct {
	header http.Header
}

func (unsupportedRateLimitRedis) Get(context.Context, string) (string, error) {
	return "", nil
}

func (unsupportedRateLimitRedis) Set(context.Context, string, []byte, time.Duration) error {
	return nil
}

func (unsupportedRateLimitRedis) SetNX(context.Context, string, []byte, time.Duration) (bool, error) {
	return true, nil
}

func (unsupportedRateLimitRedis) Del(context.Context, string) (bool, error) {
	return true, nil
}

func (unsupportedRateLimitRedis) Incr(context.Context, string) (int, error) {
	return 1, nil
}

func newDiscardRateLimitWriter() *discardRateLimitWriter {
	return &discardRateLimitWriter{header: make(http.Header)}
}

func (w *discardRateLimitWriter) Header() http.Header {
	return w.header
}

func (w *discardRateLimitWriter) Write([]byte) (int, error) {
	return 0, nil
}

func (w *discardRateLimitWriter) WriteHeader(int) {}

func (w *discardRateLimitWriter) Reset() {
	for key := range w.header {
		delete(w.header, key)
	}
}

func (m *allowRateLimitRedis) Eval(ctx context.Context, _ string, _ []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	windowMillis := args[0].(int64)
	limit := args[1].(int)
	now := time.Now().UnixMilli()
	cmd.SetVal([]any{int64(1), int64(limit - 1), now + windowMillis})
	return cmd
}

func (m *errorRateLimitRedis) Eval(ctx context.Context, _ string, _ []string, _ ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	cmd.SetErr(assert.AnError)
	return cmd
}

func (m *errorRateLimitRedis) CheckRateLimit(context.Context, string, int, time.Duration) (bool, int, time.Time, error) {
	return false, 0, time.Now(), assert.AnError
}

func newEvalRateLimitRedis() *evalRateLimitRedis {
	return &evalRateLimitRedis{
		MockClient: redis.NewMockClient(),
		entries:    make(map[string][]int64),
	}
}

func (m *evalRateLimitRedis) Eval(ctx context.Context, _ string, keys []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	if len(keys) != 1 || len(args) < 3 {
		cmd.SetErr(assert.AnError)
		return cmd
	}

	windowMillis := args[0].(int64)
	limit := args[1].(int)
	now := time.Now().UnixMilli()
	cutoff := now - windowMillis
	key := keys[0]

	m.mu.Lock()
	defer m.mu.Unlock()

	entries := m.entries[key]
	active := entries[:0]
	for _, entry := range entries {
		if entry > cutoff {
			active = append(active, entry)
		}
	}

	reset := now + windowMillis
	if len(active) > 0 {
		reset = active[0] + windowMillis
	}
	if len(active) >= limit {
		m.entries[key] = active
		cmd.SetVal([]any{int64(0), int64(0), reset})
		return cmd
	}

	active = append(active, now)
	m.entries[key] = active
	cmd.SetVal([]any{int64(1), int64(limit - len(active)), reset})
	return cmd
}

func (m *evalRateLimitRedis) CheckRateLimit(_ context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
	windowMillis := window.Milliseconds()
	if windowMillis <= 0 {
		windowMillis = 1
	}
	now := time.Now().UnixMilli()
	cutoff := now - windowMillis

	m.mu.Lock()
	defer m.mu.Unlock()

	entries := m.entries[key]
	active := entries[:0]
	for _, entry := range entries {
		if entry > cutoff {
			active = append(active, entry)
		}
	}

	reset := now + windowMillis
	if len(active) > 0 {
		reset = active[0] + windowMillis
	}
	if len(active) >= limit {
		m.entries[key] = active
		return false, 0, time.UnixMilli(reset), nil
	}

	active = append(active, now)
	m.entries[key] = active
	remaining := limit - len(active)
	if remaining < 0 {
		remaining = 0
	}
	return true, remaining, time.UnixMilli(reset), nil
}

func TestWithRateLimit_RedisUnavailable(t *testing.T) {
	// Set redis client to nil to simulate unavailability
	SetRedisClient(nil)

	middleware := WithRateLimit(10, time.Minute)
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestWithRateLimit_RedisUnavailableProduction(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	SetRedisClient(nil)

	middleware := WithRateLimit(10, time.Minute)
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestWithRateLimit_UnsupportedRedisClient(t *testing.T) {
	for _, tc := range []struct {
		name      string
		nodeEnv   string
		wantCode  int
		wantNext  bool
		wantError string
	}{
		{name: "local fail open", wantCode: http.StatusOK, wantNext: true},
		{name: "production fail closed", nodeEnv: "production", wantCode: http.StatusServiceUnavailable, wantError: "Service unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("NODE_ENV", tc.nodeEnv)
			SetRedisClient(unsupportedRateLimitRedis{})
			t.Cleanup(func() { SetRedisClient(nil) })
			nextCalled := false

			middleware := WithRateLimit(10, time.Minute)
			handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				nextCalled = true
				w.WriteHeader(http.StatusOK)
			}))

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			assert.Equal(t, tc.wantCode, rr.Code)
			assert.Equal(t, tc.wantNext, nextCalled)
			if tc.wantError != "" {
				assert.Contains(t, rr.Body.String(), tc.wantError)
			}
		})
	}
}

func TestWithRateLimit_Allowed(t *testing.T) {
	mockRedis := newEvalRateLimitRedis()
	SetRedisClient(mockRedis)
	defer SetRedisClient(nil)

	middleware := WithRateLimit(10, time.Minute)
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("X-Real-IP", "1.1.1.1")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, "10", rr.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "9", rr.Header().Get("X-RateLimit-Remaining"))
}

func TestWithRateLimit_Denied(t *testing.T) {
	mockRedis := newEvalRateLimitRedis()
	SetRedisClient(mockRedis)
	defer SetRedisClient(nil)

	// Fill up the limit
	for range 10 {
		req := httptest.NewRequest(http.MethodGet, "/test", nil)
		req.Header.Set("X-Real-IP", "2.2.2.2")
		rr := httptest.NewRecorder()
		middleware := WithRateLimit(10, time.Minute)
		middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})).ServeHTTP(rr, req)
	}

	middleware := WithRateLimit(10, time.Minute)
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("X-Real-IP", "2.2.2.2")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusTooManyRequests, rr.Code)
	assert.Equal(t, "10", rr.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, "0", rr.Header().Get("X-RateLimit-Remaining"))
}

func TestWithRateLimit_CheckErrorProduction(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	SetRedisClient(&errorRateLimitRedis{MockClient: redis.NewMockClient()})
	t.Cleanup(func() { SetRedisClient(nil) })

	middleware := WithRateLimit(10, time.Minute)
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func BenchmarkWithRateLimitAllowed(b *testing.B) {
	SetRedisClient(&allowRateLimitRedis{MockClient: redis.NewMockClient()})
	b.Cleanup(func() { SetRedisClient(nil) })

	middleware := WithRateLimit(10_000_000, time.Minute)
	handler := middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/signin", nil)
	req.Header.Set("X-Real-IP", "203.0.113.10")
	rr := newDiscardRateLimitWriter()

	b.ReportAllocs()
	for b.Loop() {
		rr.Reset()
		handler.ServeHTTP(rr, req)
	}
}
