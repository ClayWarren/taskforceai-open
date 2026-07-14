package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	authservicehandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/stretchr/testify/assert"
)

func TestWithActiveAuthUser_DisabledUserScrubsContext(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs(int32(3)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 3, Email: "disabled@example.com", Disabled: true, APITier: db.DeveloperApiTier("free"),
		}))

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
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{
		ID:    3,
		Email: "disabled@example.com",
	}))
	rr := httptest.NewRecorder()
	next.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
	assert.Equal(t, "disabled-user", rr.Header().Get("X-TaskForce-Auth-Status"))
}

func TestWithActiveAuthUser_InvalidUserID(t *testing.T) {
	next := withActiveAuthUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Nil(t, adapterhandler.GetAuthenticatedUser(r))
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{
		ID:    -1,
		Email: "bad@example.com",
	}))
	rr := httptest.NewRecorder()
	next.ServeHTTP(rr, req)

	assert.Equal(t, "invalid-user", rr.Header().Get("X-TaskForce-Auth-Status"))
}

func TestHandleHealthCheck_DeepWithDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://invalid:5432/nope?sslmode=disable")

	req := httptest.NewRequest(http.MethodGet, "/api/auth/health?deep=1", nil)
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{ID: 42}))
	rr := httptest.NewRecorder()
	handleHealthCheck(rr, req)
	assert.Contains(t, []int{http.StatusOK, http.StatusServiceUnavailable}, rr.Code)
	assert.Contains(t, rr.Body.String(), "database")
}

func TestHandleEnvCheck_DebugEnabled(t *testing.T) {
	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "true")
	t.Setenv("GOOGLE_CLIENT_ID", "abcdefghijklmnop")

	req := httptest.NewRequest(http.MethodGet, "/api/auth/env", nil)
	rr := httptest.NewRecorder()
	handleEnvCheck(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), "abcdefghij...")
}
