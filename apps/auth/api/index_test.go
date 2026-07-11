package handler

import (
	"context"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	authservicehandler "github.com/TaskForceAI/auth-service/pkg/handler"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/golang-jwt/jwt/v5"
	"github.com/pashagolub/pgxmock/v4"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type apiEvalRateLimitRedis struct {
	*infraredis.MockClient
	mu      sync.Mutex
	entries map[string][]int64
	calls   int
}

func newAPIEvalRateLimitRedis() *apiEvalRateLimitRedis {
	return &apiEvalRateLimitRedis{
		MockClient: infraredis.NewMockClient(),
		entries:    make(map[string][]int64),
	}
}

func (m *apiEvalRateLimitRedis) Eval(ctx context.Context, _ string, keys []string, args ...any) *goredis.Cmd {
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
	m.calls++

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

func (m *apiEvalRateLimitRedis) CheckRateLimit(_ context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
	windowMillis := window.Milliseconds()
	if windowMillis <= 0 {
		windowMillis = 1
	}
	now := time.Now().UnixMilli()
	cutoff := now - windowMillis

	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++

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

func (m *apiEvalRateLimitRedis) CallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls
}

func withAuthRouterSession(t *testing.T, userID int32, email string, disabled bool) {
	t.Helper()

	mock, err := pgxmock.NewPool(pgxmock.QueryMatcherOption(pgxmock.QueryMatcherRegexp))
	require.NoError(t, err)

	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs(userID).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: userID, Email: email, Disabled: disabled, APITier: "STARTER", APIRequestsLimit: 100,
		}))

	authservicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})

	originalValidateToken := adapterhandler.ValidateToken
	originalIsTokenRevoked := adapterhandler.IsTokenRevoked
	adapterhandler.ValidateToken = func(string) (jwt.MapClaims, error) {
		return jwt.MapClaims{
			"sub":   "123",
			"email": email,
			"exp":   float64(4102444800),
		}, nil
	}
	adapterhandler.IsTokenRevoked = func(context.Context, string) bool { return false }

	t.Cleanup(func() {
		authservicehandler.SetQueriesOverride(nil)
		adapterhandler.ValidateToken = originalValidateToken
		adapterhandler.IsTokenRevoked = originalIsTokenRevoked
		assert.NoError(t, mock.ExpectationsWereMet())
		mock.Close()
	})
}

func resetAuthEntrypoint() {
	handlerMux = nil
	muxOnce = sync.Once{}
}

func TestHandler_Entrypoint(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/health", nil)
	rr := httptest.NewRecorder()

	Handler(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestHandler_Entrypoint_InvalidSecureEnv(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "short")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/health", nil)
	rr := httptest.NewRecorder()

	Handler(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.Contains(t, rr.Body.String(), "Server misconfiguration")
}

func TestHandleHealthCheck(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/health", nil)
	rr := httptest.NewRecorder()

	handleHealthCheck(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), "operational")
}

func TestHandleEnvCheck(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "true")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/env-check", nil)
	rr := httptest.NewRecorder()

	handleEnvCheck(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), "has_auth_secret")
}

func TestHandleEnvCheck_DebugDisabled(t *testing.T) {
	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/env-check", nil)
	rr := httptest.NewRecorder()

	handleEnvCheck(rr, req)

	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestBuildSessionDebugPayload(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("AUTH_URL", "https://auth.taskforceai.chat")

	payload := buildSessionDebugPayload()

	assert.Equal(t, true, payload["debug"])
	assert.Equal(t, true, payload["has_google_client_id"])
	assert.Equal(t, "https://auth.taskforceai.chat", payload["auth_url"])
}

func TestBuildEnvCheckPayload_ClientIDPrefix(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "1234567890abcdef")
	t.Setenv("AUTH_URL", "https://auth.taskforceai.chat")
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	payload := buildEnvCheckPayload()

	assert.Equal(t, true, payload["has_google_client_id"])
	assert.Equal(t, true, payload["has_auth_url"])
	assert.Equal(t, true, payload["has_auth_secret"])
	assert.Equal(t, "1234567890...", payload["client_id_prefix"])
}

func TestHandlePingCheck(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/ping", nil)
	rr := httptest.NewRecorder()

	handlePingCheck(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"status":"ok"`)
	assert.Contains(t, rr.Body.String(), `/api/v1/auth/ping`)
}

func TestLegacyAuthRouteRateLimitRunsBeforeActiveUserDBLookup(t *testing.T) {
	authservicehandler.SetRedisClient(newAPIEvalRateLimitRedis())
	authservicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("database unavailable")
	})
	originalValidateToken := adapterhandler.ValidateToken
	originalIsTokenRevoked := adapterhandler.IsTokenRevoked
	adapterhandler.ValidateToken = func(string) (jwt.MapClaims, error) {
		return jwt.MapClaims{
			"sub":   "123",
			"email": "user@example.com",
			"exp":   float64(4102444800),
		}, nil
	}
	adapterhandler.IsTokenRevoked = func(context.Context, string) bool { return false }
	t.Cleanup(func() {
		authservicehandler.SetRedisClient(nil)
		authservicehandler.SetQueriesOverride(nil)
		adapterhandler.ValidateToken = originalValidateToken
		adapterhandler.IsTokenRevoked = originalIsTokenRevoked
	})

	router, _ := NewRouter()
	for range 60 {
		req := httptest.NewRequest(http.MethodGet, "/api/auth/ping", nil)
		req.Header.Set("Authorization", "Bearer valid-token")
		req.Header.Set("X-Real-IP", "203.0.113.9")
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/ping", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	req.Header.Set("X-Real-IP", "203.0.113.9")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusTooManyRequests, rr.Code)
}

func TestSessionRouteSkipsRateLimitForCredentiallessMiss(t *testing.T) {
	redisClient := newAPIEvalRateLimitRedis()
	authservicehandler.SetRedisClient(redisClient)
	t.Cleanup(func() { authservicehandler.SetRedisClient(nil) })

	router, _ := NewRouter()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	req.Header.Set("X-Real-IP", "203.0.113.10")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
	assert.Empty(t, rr.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, 0, redisClient.CallCount())
}

func TestIsCredentiallessSessionMissRejectsNonSessionGET(t *testing.T) {
	assert.False(t, isCredentiallessSessionMiss(httptest.NewRequest(http.MethodPost, "/api/auth/session", nil)))
	assert.False(t, isCredentiallessSessionMiss(httptest.NewRequest(http.MethodGet, "/api/auth/csrf", nil)))
}

func TestSessionRouteUsesRateLimitWhenSessionCookiePresent(t *testing.T) {
	redisClient := newAPIEvalRateLimitRedis()
	authservicehandler.SetRedisClient(redisClient)
	originalValidateToken := adapterhandler.ValidateToken
	adapterhandler.ValidateToken = func(string) (jwt.MapClaims, error) {
		return nil, errors.New("invalid token")
	}
	t.Cleanup(func() {
		authservicehandler.SetRedisClient(nil)
		adapterhandler.ValidateToken = originalValidateToken
	})

	router, _ := NewRouter()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: "invalid"})
	req.Header.Set("X-Real-IP", "203.0.113.11")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
	assert.Equal(t, "60", rr.Header().Get("X-RateLimit-Limit"))
	assert.Equal(t, 1, redisClient.CallCount())
}

func TestIsDeepHealthCheck(t *testing.T) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/health?deep=true", nil)
	assert.True(t, adapterhandler.IsDeepHealthCheck(req))

	req = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/health", nil)
	assert.False(t, adapterhandler.IsDeepHealthCheck(req))
}

func TestIsDeepHealthCheckVariants(t *testing.T) {
	for _, raw := range []string{"1", "TRUE", " full "} {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/health?deep="+url.QueryEscape(raw), nil)
		assert.True(t, adapterhandler.IsDeepHealthCheck(req))
	}
}

func TestNewRouter(t *testing.T) {
	r, api := NewRouter()
	assert.NotNil(t, r)
	assert.NotNil(t, api)
}

func TestNewAPIRedisClient(t *testing.T) {
	original := getRedisClientForAPI
	t.Cleanup(func() { getRedisClientForAPI = original })

	expected := infraredis.NewMockClient()
	getRedisClientForAPI = func() (infraredis.Cmdable, error) {
		return expected, nil
	}

	client, err := newAPIRedisClient()

	require.NoError(t, err)
	assert.Same(t, expected, client)
}

func TestNewRouter_ImpersonateRouteRegistered(t *testing.T) {
	r, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/impersonate", strings.NewReader(`{"email":"target@example.com"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestNewRouter_NoTokenSessionBypassesRateLimitDependency(t *testing.T) {
	t.Setenv("VERCEL", "1")
	authservicehandler.SetRedisClient(nil)
	t.Cleanup(func() { authservicehandler.SetRedisClient(nil) })

	r, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/session", nil)
	rr := httptest.NewRecorder()

	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestNewRouter_TokenSessionStillUsesRateLimitDependency(t *testing.T) {
	t.Setenv("VERCEL", "1")
	authservicehandler.SetRedisClient(nil)
	t.Cleanup(func() { authservicehandler.SetRedisClient(nil) })

	r, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/session", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rr := httptest.NewRecorder()

	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestNewRouter_AnonymousSessionRequestsBypassRateLimit(t *testing.T) {
	redisClient := newAPIEvalRateLimitRedis()
	authservicehandler.SetRedisClient(redisClient)
	t.Cleanup(func() { authservicehandler.SetRedisClient(nil) })

	r, _ := NewRouter()
	for range 61 {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/session", nil)
		req.Header.Set("X-Real-IP", "198.51.100.17")
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)
		assert.Equal(t, http.StatusUnauthorized, rr.Code)
	}

	assert.Equal(t, 0, redisClient.CallCount())
}

func TestNewRouter_DisabledUserSessionUnauthorized(t *testing.T) {
	withAuthRouterSession(t, 123, "disabled@example.com", true)

	r, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/session", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rr := httptest.NewRecorder()

	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
	assert.Contains(t, rr.Body.String(), "No active session")
}

func TestNewRouter_DisabledUserMeUnauthorized(t *testing.T) {
	withAuthRouterSession(t, 123, "disabled@example.com", true)

	r, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rr := httptest.NewRecorder()

	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestWithActiveAuthUser_MissingUserPassesThroughAndQueryErrorFailsClosed(t *testing.T) {
	for _, tc := range []struct {
		name       string
		user       *adapterauth.AuthenticatedUser
		queryFunc  func(context.Context) (*db.Queries, error)
		wantCalled bool
		wantStatus int
	}{
		{name: "no user", wantCalled: true, wantStatus: http.StatusNoContent},
		{
			name: "query error",
			user: &adapterauth.AuthenticatedUser{ID: 123, Email: "user@example.com"},
			queryFunc: func(context.Context) (*db.Queries, error) {
				return nil, errors.New("db unavailable")
			},
			wantCalled: false,
			wantStatus: http.StatusServiceUnavailable,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			authservicehandler.SetQueriesOverride(tc.queryFunc)
			t.Cleanup(func() { authservicehandler.SetQueriesOverride(nil) })

			called := false
			next := withActiveAuthUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				assert.Same(t, tc.user, adapterhandler.GetAuthenticatedUser(r))
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
			if tc.user != nil {
				req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, tc.user))
			}
			rr := httptest.NewRecorder()

			next.ServeHTTP(rr, req)

			assert.Equal(t, tc.wantCalled, called)
			assert.Equal(t, tc.wantStatus, rr.Code)
			if !tc.wantCalled {
				assert.Equal(t, "verification-unavailable", rr.Header().Get("X-TaskForce-Auth-Status"))
			}
		})
	}
}

func TestWithActiveAuthUser_InvalidUserScrubsContext(t *testing.T) {
	next := withActiveAuthUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Nil(t, adapterhandler.GetAuthenticatedUser(r))
		assert.Zero(t, adapterhandler.GetUserID(r))
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{
		ID:    math.MaxInt32 + 1,
		Email: "bad@example.com",
	}))
	rr := httptest.NewRecorder()

	next.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
	assert.Equal(t, "invalid-user", rr.Header().Get("X-TaskForce-Auth-Status"))
}
