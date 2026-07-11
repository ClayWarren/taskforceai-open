package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRevokeTokenOnLogout_EmptyToken(t *testing.T) {
	revokeTokenOnLogout(context.Background(), "")
}

func TestRevokeTokenOnLogout_InvalidToken(t *testing.T) {
	revokeTokenOnLogout(context.Background(), "not-a-valid-token")
}

func TestRevokeTokenOnLogout_NilRevoker(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")

	user := authpkg.SessionUser{ID: "1", Email: "user@example.com"}
	token, err := authpkg.EncodeSessionToken(user, os.Getenv("AUTH_SECRET"), 3600)
	require.NoError(t, err)

	original := getTokenRevoker
	getTokenRevoker = func() adapterauth.TokenRevoker { return nil }
	defer func() { getTokenRevoker = original }()

	revokeTokenOnLogout(context.Background(), token)
}

func TestLogoutHandler_ParseFormError(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/logout", strings.NewReader("%"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rr := httptest.NewRecorder()
	LogoutHandler(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}
