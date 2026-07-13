package authtoken

import (
	"context"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
)

func resetTokenCoverageHooks(t *testing.T) {
	t.Helper()
	originalVerify := verifyToken
	originalBuild := buildAuthenticatedUser
	t.Cleanup(func() {
		verifyToken = originalVerify
		buildAuthenticatedUser = originalBuild
	})
}

func tokenCoverageRequest() (*httptest.ResponseRecorder, *http.Request) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: "token"})
	return w, r
}

func TestTokenNonMapClaims(t *testing.T) {
	resetTokenCoverageHooks(t)
	verifyToken = func(string) (*jwt.Token, error) {
		return &jwt.Token{Claims: jwt.RegisteredClaims{}, Valid: true}, nil
	}

	w, r := tokenCoverageRequest()
	Handler(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestTokenInvalidBuiltUserIDs(t *testing.T) {
	for _, tc := range []struct {
		name string
		id   int
	}{
		{name: "zero", id: 0},
		{name: "overflow", id: math.MaxInt32 + 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetTokenCoverageHooks(t)
			verifyToken = func(string) (*jwt.Token, error) {
				return &jwt.Token{Claims: jwt.MapClaims{"sub": "123"}, Valid: true}, nil
			}
			buildAuthenticatedUser = func(map[string]any) (*adapterauth.AuthenticatedUser, error) {
				return &adapterauth.AuthenticatedUser{ID: tc.id, Email: "user@example.com"}, nil
			}
			authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
				return &db.Queries{}, nil
			})
			t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

			w, r := tokenCoverageRequest()
			Handler(w, r)

			assert.Equal(t, http.StatusUnauthorized, w.Code)
		})
	}
}

func TestTokenOriginHelperFallbacks(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "https://auth.taskforceai.chat/api/v1/auth/token", nil)
	req.Header.Set("Origin", "https://auth.taskforceai.chat")
	assert.True(t, isAllowedTokenOrigin(req))

	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.Host = "auth.taskforceai.chat"
	req.Header.Set("Origin", "https://auth.taskforceai.chat")
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", ":443, ignored.example")
	assert.True(t, isAllowedTokenOrigin(req))

	host, port, ok := normalizeHostPort("2001:db8::1", "https")
	assert.True(t, ok)
	assert.Equal(t, "2001:db8::1", host)
	assert.Equal(t, "443", port)

	_, _, ok = normalizeHostPort(":443", "https")
	assert.False(t, ok)
}
