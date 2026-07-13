package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	syncpkg "github.com/TaskForceAI/go-sync/pkg/sync"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func stubRedisDependencies(t *testing.T) {
	t.Helper()

	stubRedisDependenciesWithLocker(t, errors.New("redis unavailable in unit test"))
}

func stubRedisDependenciesWithLocker(t *testing.T, lockerErr error) {
	t.Helper()

	originalBroadcaster := newRedisStreamBroadcaster
	originalLocker := newRedisLocker
	originalIdempotency := newRedisIdempotencyStore
	errUnavailable := errors.New("redis unavailable in unit test")

	newRedisStreamBroadcaster = func() (*syncpkg.RedisStreamBroadcaster, error) {
		return nil, errUnavailable
	}
	newRedisLocker = func() (*syncpkg.RedisLocker, error) {
		if lockerErr != nil {
			return nil, lockerErr
		}
		return &syncpkg.RedisLocker{}, nil
	}
	newRedisIdempotencyStore = func() (*syncpkg.RedisIdempotencyStore, error) {
		return &syncpkg.RedisIdempotencyStore{}, nil
	}

	t.Cleanup(func() {
		newRedisStreamBroadcaster = originalBroadcaster
		newRedisLocker = originalLocker
		newRedisIdempotencyStore = originalIdempotency
	})
}

func stubDeepHealthReport(t *testing.T) {
	t.Helper()

	original := getHealthReport
	getHealthReport = func(ctx context.Context) (*syncpkg.HealthReport, error) {
		return syncpkg.GetShallowHealthReport(), nil
	}
	t.Cleanup(func() {
		getHealthReport = original
	})
}

func init() {
	_ = os.Setenv("REDIS_URL", "redis://localhost:6379")
}

func TestNewRouter_DBUnavailable(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	r, api := NewRouter()
	assert.NotNil(t, r)
	assert.NotNil(t, api)
}

func TestNewRouter_WithQueries(t *testing.T) {
	stubRedisDependencies(t)
	stubDeepHealthReport(t)

	mock := dbtest.NewMockPool(t)

	original := getQueries
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	}
	defer func() { getQueries = original }()

	r, _ := NewRouter()
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/sync/health", nil)
	req.Header.Set("Authorization", "Bearer invalid")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)

	// Test deep health check through router
	w = httptest.NewRecorder()
	req = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/sync/health?deep=true", nil)
	req.Header.Set("Authorization", "Bearer invalid")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)

	w = httptest.NewRecorder()
	authCtx := context.WithValue(context.Background(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{ID: 42, Email: "user@example.com"})
	req = httptest.NewRequestWithContext(authCtx, http.MethodGet, "/api/v1/sync/health?deep=true", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)

	w = httptest.NewRecorder()
	req = httptest.NewRequestWithContext(context.Background(), http.MethodOptions, "/api/v1/sync/health", nil)
	req.Header.Set("Origin", "https://example.com")
	r.ServeHTTP(w, req)
	assert.NotEqual(t, http.StatusNotFound, w.Result().StatusCode)

	w = httptest.NewRecorder()
	req = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/not-found?__path=x", nil)
	req.Header.Set("X-Matched-Path", "/missing")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusNotFound, w.Result().StatusCode)
}

func TestNewRouter_DeepHealthReportError(t *testing.T) {
	stubRedisDependencies(t)

	originalReport := getHealthReport
	getHealthReport = func(ctx context.Context) (*syncpkg.HealthReport, error) {
		return nil, errors.New("health failed")
	}
	t.Cleanup(func() { getHealthReport = originalReport })

	mock := dbtest.NewMockPool(t)
	originalQueries := getQueries
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	}
	t.Cleanup(func() { getQueries = originalQueries })

	r, _ := NewRouter()
	authCtx := context.WithValue(context.Background(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{ID: 42, Email: "user@example.com"})
	req := httptest.NewRequestWithContext(authCtx, http.MethodGet, "/api/v1/sync/health?deep=true", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Result().StatusCode)
}

func TestHandler_NoPanic(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	Handler(w, req)
	assert.NotEqual(t, 0, w.Result().StatusCode)
}

func TestHandler_SpecialPaths(t *testing.T) {
	stubRedisDependencies(t)
	stubDeepHealthReport(t)
	redis.SetClient(redis.NewMockClient())
	t.Cleanup(func() {
		redis.ResetClient()
	})

	_ = os.Setenv("REDIS_URL", "redis://localhost:6379")
	defer func() {
		_ = os.Unsetenv("REDIS_URL")
	}()

	// Test /api/v1/sync/realtime
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/sync/realtime", nil)
	Handler(w, req)
	// Should return 401 Unauthorized because of resolveUserID
	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)

	// Test /api/v1/sync/health (shallow)
	w = httptest.NewRecorder()
	req = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/sync/health", nil)
	Handler(w, req)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)

	// Test /api/v1/sync/health (deep)
	w = httptest.NewRecorder()
	req = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/sync/health?deep=true", nil)
	Handler(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
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
		{"/health?deep=something", false},
	}

	for _, tt := range tests {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, tt.url, nil)
		assert.Equal(t, tt.expected, adapterhandler.IsDeepHealthCheck(req), tt.url)
	}
}

func TestGetSyncHealthReport(t *testing.T) {
	stubDeepHealthReport(t)

	ctx := context.Background()

	// Shallow
	report, err := getSyncHealthReport(ctx, false, false)
	require.NoError(t, err)
	publicReport, ok := report.(publicSyncHealthReport)
	require.True(t, ok)
	assert.True(t, publicReport.Status == "operational" || publicReport.Status == "degraded")

	_, err = getSyncHealthReport(ctx, true, false)
	require.ErrorIs(t, err, errDeepHealthRequiresAuth)

	// Deep authenticated (will call syncpkg.GetHealthReport)
	report, err = getSyncHealthReport(ctx, true, true)
	require.NoError(t, err)
	assert.NotNil(t, report)
}

func TestNewSyncDependenciesResolver(t *testing.T) {
	stubRedisDependenciesWithLocker(t, nil)

	resolver := newSyncDependenciesResolver()
	assert.NotNil(t, resolver)

	mock := dbtest.NewMockPool(t)

	calls := 0
	original := getQueries
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		calls++
		if calls == 1 {
			return nil, assert.AnError
		}
		return db.New(mock), nil
	}
	defer func() { getQueries = original }()

	_, err := resolver(context.Background())
	require.Error(t, err)
	assert.Equal(t, 1, calls)

	deps, err := resolver(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 2, calls)
	assert.NotNil(t, deps.Service)
	assert.NotNil(t, deps.Repo)
	assert.NotNil(t, deps.Queries)

	deps, err = resolver(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 2, calls)
	assert.NotNil(t, deps.Service)
}

func TestNewSyncDependenciesResolver_FailsClosedWithoutLocker(t *testing.T) {
	stubRedisDependenciesWithLocker(t, errors.New("redis locker unavailable in unit test"))

	mock := dbtest.NewMockPool(t)
	originalQueries := getQueries
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	}
	t.Cleanup(func() { getQueries = originalQueries })

	resolver := newSyncDependenciesResolver()
	_, err := resolver(context.Background())
	require.Error(t, err)
	assert.ErrorContains(t, err, "init sync locker")
}

func TestNewSyncDependenciesResolver_FailsClosedWithoutIdempotency(t *testing.T) {
	stubRedisDependenciesWithLocker(t, nil)
	originalIdempotency := newRedisIdempotencyStore
	newRedisIdempotencyStore = func() (*syncpkg.RedisIdempotencyStore, error) {
		return nil, errors.New("redis idempotency unavailable in unit test")
	}
	t.Cleanup(func() { newRedisIdempotencyStore = originalIdempotency })

	mock := dbtest.NewMockPool(t)
	originalQueries := getQueries
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	}
	t.Cleanup(func() { getQueries = originalQueries })

	resolver := newSyncDependenciesResolver()
	_, err := resolver(context.Background())
	require.Error(t, err)
	assert.ErrorContains(t, err, "init sync idempotency store")
}

func TestNewSyncDependenciesResolver_FailsClosedWithNilIdempotency(t *testing.T) {
	stubRedisDependenciesWithLocker(t, nil)
	originalIdempotency := newRedisIdempotencyStore
	newRedisIdempotencyStore = func() (*syncpkg.RedisIdempotencyStore, error) { return nil, nil }
	t.Cleanup(func() { newRedisIdempotencyStore = originalIdempotency })

	mock := dbtest.NewMockPool(t)
	originalQueries := getQueries
	getQueries = func(context.Context) (*db.Queries, error) { return db.New(mock), nil }
	t.Cleanup(func() { getQueries = originalQueries })

	_, err := newSyncDependenciesResolver()(context.Background())
	require.ErrorContains(t, err, "idempotency store is nil")
}

func TestNewSyncDependenciesResolver_WithRedisBroadcaster(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	t.Cleanup(func() {
		redis.ResetClient()
	})

	mock := dbtest.NewMockPool(t)
	originalQueries := getQueries
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	}
	t.Cleanup(func() { getQueries = originalQueries })

	resolver := newSyncDependenciesResolver()
	deps, err := resolver(context.Background())

	require.NoError(t, err)
	assert.NotNil(t, deps.Service)
}
