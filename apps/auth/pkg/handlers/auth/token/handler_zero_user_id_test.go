package authtoken

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTokenHandler_MissingUserIDUnauthorized(t *testing.T) {
	t.Setenv("AUTH_SECRET", tokenTestSecret)
	now := time.Now().Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"email": "user@example.com",
		"iat":   now - 60,
		"exp":   now + 3600,
	})
	tokenString, err := token.SignedString([]byte(tokenTestSecret))
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})
	rr := httptest.NewRecorder()
	Handler(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}
