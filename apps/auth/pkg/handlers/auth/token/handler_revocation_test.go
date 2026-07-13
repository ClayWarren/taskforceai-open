package authtoken

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	redis_mocks "github.com/TaskForceAI/infrastructure/redis/mocks/pkg"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestTokenHandler_RevokedTokenUnauthorized(t *testing.T) {
	validToken := generateValidToken(t)
	withTokenHandlerQueries(t, false)

	mockRedis := new(redis_mocks.Cmdable)
	mockRedis.On("Get", mock.Anything, mock.Anything).Return("1", nil)
	authhandler.SetRedisClient(mockRedis)
	t.Cleanup(func() { authhandler.SetRedisClient(nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestTokenHandler_MissingRevocationKeyReturnsToken(t *testing.T) {
	validToken := generateValidToken(t)
	withTokenHandlerQueries(t, false)

	mockRedis := new(redis_mocks.Cmdable)
	mockRedis.On("Get", mock.Anything, mock.Anything).Return("", errors.New("key not found"))
	authhandler.SetRedisClient(mockRedis)
	t.Cleanup(func() { authhandler.SetRedisClient(nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestTokenHandler_RevocationCheckError(t *testing.T) {
	validToken := generateValidToken(t)
	withTokenHandlerQueries(t, false)

	mockRedis := new(redis_mocks.Cmdable)
	mockRedis.On("Get", mock.Anything, mock.Anything).Return("", errors.New("redis unavailable"))
	authhandler.SetRedisClient(mockRedis)
	t.Cleanup(func() { authhandler.SetRedisClient(nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Result().StatusCode)
}

func TestTokenHandler_InvalidUserIDUnauthorized(t *testing.T) {
	t.Setenv("AUTH_SECRET", tokenTestSecret)
	token, err := authpkg.EncodeSessionToken(authpkg.SessionUser{
		ID:    "0",
		Email: "user@example.com",
	}, tokenTestSecret, 3600)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: token})
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestTokenHandler_GetUserDBError(t *testing.T) {
	validToken := generateValidToken(t)

	mock, err := pgxmock.NewPool(pgxmock.QueryMatcherOption(pgxmock.QueryMatcherRegexp))
	require.NoError(t, err)

	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs(int32(123)).
		WillReturnError(errors.New("db read failed"))

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
	t.Cleanup(func() {
		authhandler.SetQueriesOverride(nil)
		assert.NoError(t, mock.ExpectationsWereMet())
		mock.Close()
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}
