package refresh

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClaimToUnixSeconds_Int64(t *testing.T) {
	now := int64(1_000)
	remaining, err := getRemainingTokenLifetimeSeconds(jwt.MapClaims{"exp": now + 120}, now)
	require.NoError(t, err)
	assert.Equal(t, 120, remaining)
}

func TestHandler_ImpersonationNearExpiryRefresh(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	mock := setupMockQueries(t)
	defer func() {
		handler.SetQueriesOverride(nil)
		mock.Close()
	}()

	mock.ExpectQuery("(?s)SELECT (.+)disabled(.+)FROM users").
		WithArgs(int32(8)).
		WillReturnRows(refreshUserStatusRows(8, false))

	now := time.Now().Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "8", "email": "user@example.com", "iat": now - 1800, "exp": now + 120, "act_as": "admin@example.com",
	})
	tokenString, _ := token.SignedString([]byte(testSecret))

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})
	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestValidateUser_InvalidIDRange(t *testing.T) {
	handler.SetQueriesOverride(nil)
	t.Cleanup(func() { handler.SetQueriesOverride(nil) })

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	err := validateUser(r, w, "9999999999999999999")
	require.Error(t, err)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}
