package authtoken

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const tokenTestSecret = "test-secret-value-that-is-long-enough"

func generateValidToken(t *testing.T) string {
	t.Helper()
	t.Setenv("AUTH_SECRET", tokenTestSecret)
	token, err := authpkg.EncodeSessionToken(authpkg.SessionUser{
		ID:    "123",
		Email: "user@example.com",
	}, tokenTestSecret, 3600)
	if err != nil {
		t.Fatalf("failed to encode token: %v", err)
	}
	return token
}

func generateMFAPendingToken(t *testing.T) string {
	t.Helper()
	t.Setenv("AUTH_SECRET", tokenTestSecret)
	token, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{
		ID:    "123",
		Email: "user@example.com",
	}, "/dashboard", tokenTestSecret)
	require.NoError(t, err)
	return token
}

func withTokenHandlerQueries(t *testing.T, disabled bool) {
	t.Helper()

	mock, err := pgxmock.NewPool(pgxmock.QueryMatcherOption(pgxmock.QueryMatcherRegexp))
	require.NoError(t, err)

	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs(int32(123)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 123, Email: "user@example.com", Disabled: disabled, APITier: "STARTER", APIRequestsLimit: 100,
		}))

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})

	t.Cleanup(func() {
		authhandler.SetQueriesOverride(nil)
		assert.NoError(t, mock.ExpectationsWereMet())
		mock.Close()
	})
}

func TestTokenHandler_Success(t *testing.T) {
	validToken := generateValidToken(t)
	withTokenHandlerQueries(t, false)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if body["accessToken"] != validToken {
		t.Errorf("Expected accessToken %s, got %s", validToken, body["accessToken"])
	}
}

func TestTokenHandler_Unauthorized(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", resp.StatusCode)
	}
}

func TestTokenHandler_MFAPendingTokenUnauthorized(t *testing.T) {
	pendingToken := generateMFAPendingToken(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: pendingToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestTokenHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/token", nil)
	w := httptest.NewRecorder()

	Handler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("Expected status 405, got %d", resp.StatusCode)
	}
}

func TestTokenHandler_CORSPreflight(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/auth/token", nil)
	req.Header.Set("Origin", "https://auth.taskforceai.chat")
	req.Header.Set("Access-Control-Request-Method", http.MethodGet)
	w := httptest.NewRecorder()

	Handler(w, req)

	if w.Result().StatusCode != http.StatusNoContent {
		t.Errorf("Expected status 204, got %d", w.Result().StatusCode)
	}
}

func TestTokenHandler_ProductionCookies(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	validToken := generateValidToken(t)
	withTokenHandlerQueries(t, false)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "__Secure-session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	var body map[string]string
	_ = json.NewDecoder(w.Body).Decode(&body)
	if body["accessToken"] != validToken {
		t.Errorf("Expected %s, got %s", validToken, body["accessToken"])
	}
}

func TestTokenHandler_InvalidToken(t *testing.T) {
	t.Setenv("AUTH_SECRET", tokenTestSecret)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: "not-a-valid-token"})
	w := httptest.NewRecorder()

	Handler(w, req)

	if w.Result().StatusCode != http.StatusUnauthorized {
		t.Errorf("Expected status 401, got %d", w.Result().StatusCode)
	}
}

func TestTokenHandler_CrossOriginBlocked(t *testing.T) {
	validToken := generateValidToken(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.Host = "auth.taskforceai.chat"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("Origin", "https://www.taskforceai.chat")
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	if w.Result().StatusCode != http.StatusForbidden {
		t.Errorf("Expected status 403, got %d", w.Result().StatusCode)
	}
}

func TestTokenHandler_SameOriginAllowed(t *testing.T) {
	validToken := generateValidToken(t)
	withTokenHandlerQueries(t, false)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.Host = "auth.taskforceai.chat"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("Origin", "https://auth.taskforceai.chat")
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	if w.Result().StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Result().StatusCode)
	}
}

func TestTokenHandler_SameOriginDefaultPortAllowed(t *testing.T) {
	validToken := generateValidToken(t)
	withTokenHandlerQueries(t, false)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.Host = "auth.taskforceai.chat:443"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("Origin", "https://auth.taskforceai.chat")
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	if w.Result().StatusCode != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Result().StatusCode)
	}
}

func TestTokenHandler_DisabledUserUnauthorized(t *testing.T) {
	validToken := generateValidToken(t)
	withTokenHandlerQueries(t, true)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestTokenHandler_QueryUnavailable(t *testing.T) {
	validToken := generateValidToken(t)
	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, assert.AnError
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	w := httptest.NewRecorder()

	Handler(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Result().StatusCode)
}

func TestTokenOriginHelpers(t *testing.T) {
	assert.Equal(t, []string{"a", "b"}, getCookieNames([]*http.Cookie{{Name: "a"}, {Name: "b"}}))

	host, port, ok := normalizeHostPort("[::1]:3000", "http")
	assert.True(t, ok)
	assert.Equal(t, "::1", host)
	assert.Equal(t, "3000", port)

	host, port, ok = normalizeHostPort("Example.COM.", "https")
	assert.True(t, ok)
	assert.Equal(t, "example.com", host)
	assert.Equal(t, "443", port)

	_, _, ok = normalizeHostPort("", "https")
	assert.False(t, ok)
	_, _, ok = normalizeHostPort("example.com", "ftp")
	assert.False(t, ok)
}

func TestIsAllowedTokenOriginVariants(t *testing.T) {
	assert.False(t, isAllowedTokenOrigin(nil))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.Host = "auth.taskforceai.chat"
	req.Header.Set("Origin", "://bad")
	assert.False(t, isAllowedTokenOrigin(req))

	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.Host = "auth.taskforceai.chat"
	req.Header.Set("Origin", "https://auth.taskforceai.chat")
	req.Header.Set("X-Forwarded-Proto", "http")
	assert.False(t, isAllowedTokenOrigin(req))

	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.Host = "ignored.example"
	req.Header.Set("Origin", "https://auth.taskforceai.chat")
	req.Header.Set("X-Forwarded-Proto", "https, http")
	req.Header.Set("X-Forwarded-Host", "auth.taskforceai.chat, proxy.local")
	assert.True(t, isAllowedTokenOrigin(req))
}
