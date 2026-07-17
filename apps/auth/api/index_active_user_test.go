package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	authservicehandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWithActiveAuthUser_ActiveUserPassesThrough(t *testing.T) {
	withAuthRouterSession(t, 42, "active@example.com", false)

	called := false
	next := withActiveAuthUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		user := adapterhandler.GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.Equal(t, 42, user.ID)
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{
		ID:    42,
		Email: "active@example.com",
	}))
	rr := httptest.NewRecorder()

	next.ServeHTTP(rr, req)

	assert.True(t, called)
	assert.Equal(t, http.StatusNoContent, rr.Code)
	assert.Empty(t, rr.Header().Get("X-TaskForce-Auth-Status"))
}

func TestWithActiveAuthUser_UserNotFoundScrubsContext(t *testing.T) {
	mock, err := pgxmock.NewPool(pgxmock.QueryMatcherOption(pgxmock.QueryMatcherRegexp))
	require.NoError(t, err)

	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs(int32(99)).
		WillReturnError(pgx.ErrNoRows)

	authservicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
	t.Cleanup(func() {
		authservicehandler.SetQueriesOverride(nil)
		assert.NoError(t, mock.ExpectationsWereMet())
		mock.Close()
	})

	next := withActiveAuthUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Nil(t, adapterhandler.GetAuthenticatedUser(r))
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{
		ID:    99,
		Email: "missing@example.com",
	}))
	rr := httptest.NewRecorder()

	next.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
	assert.Equal(t, "user-not-found", rr.Header().Get("X-TaskForce-Auth-Status"))
}

func TestWithActiveAuthUser_DbLoadErrorFailsClosed(t *testing.T) {
	authservicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db read failed")
	})
	t.Cleanup(func() { authservicehandler.SetQueriesOverride(nil) })

	originalUser := &adapterauth.AuthenticatedUser{ID: 7, Email: "user@example.com"}
	called := false
	next := withActiveAuthUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, originalUser))
	rr := httptest.NewRecorder()

	next.ServeHTTP(rr, req)

	assert.False(t, called)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	assert.Equal(t, "verification-unavailable", rr.Header().Get("X-TaskForce-Auth-Status"))
}

func TestNewRouter_NotFound(t *testing.T) {
	r, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/unknown-route", nil)
	rr := httptest.NewRecorder()

	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNotFound, rr.Code)
	assert.Contains(t, rr.Body.String(), "Auth route not found")
}

func TestNewRouter_SessionDebugEnvDisabled(t *testing.T) {
	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "")

	r, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/session?debug=env", nil)
	rr := httptest.NewRecorder()

	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestNewRouter_SessionDebugEnvEnabled(t *testing.T) {
	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "true")
	t.Setenv("GOOGLE_CLIENT_ID", "client-id")
	t.Setenv("AUTH_URL", "https://auth.taskforceai.chat")

	r, _ := NewRouter()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/session?debug=env", nil)
	rr := httptest.NewRecorder()

	r.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), "has_google_client_id")
}

func TestHandleHealthCheck_DeepWithoutDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/health?deep=true", nil)
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{ID: 42}))
	rr := httptest.NewRecorder()

	handleHealthCheck(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	assert.Contains(t, rr.Body.String(), `"status":"degraded"`)
	assert.Contains(t, rr.Body.String(), "database is not configured")
}

func TestHandler_ReinitializesRouter(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/ping", nil)
	rr := httptest.NewRecorder()
	Handler(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)

	resetAuthEntrypoint()
	rr2 := httptest.NewRecorder()
	Handler(rr2, req)
	assert.Equal(t, http.StatusOK, rr2.Code)
}
