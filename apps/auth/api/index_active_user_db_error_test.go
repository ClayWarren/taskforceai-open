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
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWithActiveAuthUser_GetUserByIDErrorFailsClosed(t *testing.T) {
	mock, err := pgxmock.NewPool(pgxmock.QueryMatcherOption(pgxmock.QueryMatcherRegexp))
	require.NoError(t, err)

	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs(int32(8)).
		WillReturnError(errors.New("connection reset"))

	authservicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
	t.Cleanup(func() {
		authservicehandler.SetQueriesOverride(nil)
		assert.NoError(t, mock.ExpectationsWereMet())
		mock.Close()
	})

	originalUser := &adapterauth.AuthenticatedUser{ID: 8, Email: "user@example.com"}
	called := false
	next := withActiveAuthUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, originalUser))
	rr := httptest.NewRecorder()
	next.ServeHTTP(rr, req)

	assert.False(t, called)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	assert.Equal(t, "verification-unavailable", rr.Header().Get("X-TaskForce-Auth-Status"))
}
