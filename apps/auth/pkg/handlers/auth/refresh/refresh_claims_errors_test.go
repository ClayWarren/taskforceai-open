package refresh

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
)

func resetRefreshCoverageHooks(t *testing.T) {
	t.Helper()
	originalVerify := verifyToken
	originalNearExpiry := isTokenNearExpiry
	originalEncode := encodeSession
	t.Cleanup(func() {
		verifyToken = originalVerify
		isTokenNearExpiry = originalNearExpiry
		encodeSession = originalEncode
	})
}

func refreshRequestWithCookie() (*httptest.ResponseRecorder, *http.Request) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: authpkg.SessionCookieName, Value: "token"})
	return w, r
}

func TestRefreshNonMapClaims(t *testing.T) {
	setupRefreshHandlerAuth(t)
	resetRefreshCoverageHooks(t)
	verifyToken = func(string) (*jwt.Token, error) {
		return &jwt.Token{Claims: jwt.RegisteredClaims{}, Valid: true}, nil
	}
	isTokenNearExpiry = func(*jwt.Token, float64) bool { return true }

	w, r := refreshRequestWithCookie()
	Handler(w, r)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestRefreshImpersonationLifetimeError(t *testing.T) {
	setupRefreshHandlerAuth(t)
	resetRefreshCoverageHooks(t)
	verifyToken = func(string) (*jwt.Token, error) {
		return &jwt.Token{Claims: jwt.MapClaims{
			"sub":    "7",
			"email":  "target@example.com",
			"act_as": "admin",
			"iat":    time.Now().Unix() - 60,
		}, Valid: true}, nil
	}
	isTokenNearExpiry = func(*jwt.Token, float64) bool { return true }
	mock := setupMockQueries(t)
	defer mock.Close()
	mock.ExpectQuery("(?s)SELECT (.+)disabled(.+)FROM users").
		WithArgs(int32(7)).
		WillReturnRows(refreshUserStatusRows(7, false))

	w, r := refreshRequestWithCookie()
	Handler(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRefreshEncodeSessionError(t *testing.T) {
	setupRefreshHandlerAuth(t)
	resetRefreshCoverageHooks(t)
	now := time.Now().Unix()
	verifyToken = func(string) (*jwt.Token, error) {
		return &jwt.Token{Claims: jwt.MapClaims{
			"sub":   "7",
			"email": "target@example.com",
			"iat":   now - 60,
			"exp":   now + 60,
		}, Valid: true}, nil
	}
	isTokenNearExpiry = func(*jwt.Token, float64) bool { return true }
	encodeSession = func(authpkg.SessionUser, string, int) (string, error) {
		return "", errors.New("sign failed")
	}
	mock := setupMockQueries(t)
	defer mock.Close()
	mock.ExpectQuery("(?s)SELECT (.+)disabled(.+)FROM users").
		WithArgs(int32(7)).
		WillReturnRows(refreshUserStatusRows(7, false))

	w, r := refreshRequestWithCookie()
	Handler(w, r)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}
