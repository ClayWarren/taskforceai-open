package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandleNoContent(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	HandleNoContent(w, req)

	resp := w.Result()
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
}

func TestHandleRobots(t *testing.T) {
	req := httptest.NewRequest("GET", "/robots.txt", nil)
	w := httptest.NewRecorder()

	HandleRobots(w, req)

	resp := w.Result()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

func TestCommonRoutesIncludeAPINoisePaths(t *testing.T) {
	routes := CommonRoutes()
	patterns := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		patterns[route.Pattern] = struct{}{}
	}

	for _, expected := range []string{
		"/api",
		"/api/",
		"/api/favicon.ico",
		"/api/favicon.png",
		"/api/favicon-32x32.png",
		"/api/robots.txt",
		"/api/sitemap.xml",
	} {
		_, ok := patterns[expected]
		assert.Truef(t, ok, "expected common route %q to be registered", expected)
	}
}

func TestServiceHeader(t *testing.T) {
	handler := ServiceHeader("unit-service")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, "unit-service", resp.Header().Get("X-TaskForce-Service"))
}

func TestRegisterCommonRoutes(t *testing.T) {
	mux := &testCommonRouteMux{handlers: map[string]http.HandlerFunc{}}
	RegisterCommonRoutes(mux)

	resp := httptest.NewRecorder()
	mux.handlers["/api/robots.txt"](resp, httptest.NewRequest(http.MethodGet, "/api/robots.txt", nil))

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, "text/plain", resp.Header().Get("Content-Type"))
	assert.Contains(t, resp.Body.String(), "Disallow: /")
}

type testCommonRouteMux struct {
	handlers map[string]http.HandlerFunc
}

func (m *testCommonRouteMux) HandleFunc(pattern string, handler http.HandlerFunc) {
	m.handlers[pattern] = handler
}

func TestRegisterNotFound(t *testing.T) {
	mux := &testNotFoundMux{}
	RegisterNotFound(mux, "unit-service", "missing: ")

	req := httptest.NewRequest(http.MethodGet, "/not-here?__path=/original", nil)
	req.Header.Set("X-Matched-Path", "/api/:path")
	resp := httptest.NewRecorder()
	mux.handler(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
	assert.Contains(t, resp.Body.String(), "missing: /not-here")
}

type testNotFoundMux struct {
	handler http.HandlerFunc
}

func (m *testNotFoundMux) NotFound(handler http.HandlerFunc) {
	m.handler = handler
}

func TestMakeCtx(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	user := &auth.AuthenticatedUser{ID: 123}
	ctx := context.WithValue(req.Context(), UserContextKey, user)
	req = req.WithContext(ctx)

	c := MakeCtx(req)
	assert.NotNil(t, c)
	assert.NotNil(t, c.User)
	assert.Equal(t, 123, c.User.ID)
}

func TestAuthContextAccessorsPreferAuthenticatedUser(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 123, Email: "user@example.com"}
	req := httptest.NewRequest("GET", "/", nil)
	ctx := context.WithValue(req.Context(), UserContextKey, user)
	ctx = context.WithValue(ctx, UserIDContextKey, 999)
	ctx = context.WithValue(ctx, EmailContextKey, "fallback@example.com")
	req = req.WithContext(ctx)

	assert.Equal(t, 123, GetUserID(req))
	assert.Equal(t, "user@example.com", GetUserIdentifier(req))
}

func TestBuildAuthenticatedUserAdditionalClaimForms(t *testing.T) {
	user, err := BuildAuthenticatedUser(map[string]any{
		"id":     float64(123),
		"email":  "user@example.com",
		"org_id": float64(7),
	})
	require.NoError(t, err)
	assert.Equal(t, 123, user.ID)
	assert.NotNil(t, user.OrgID)
	assert.Equal(t, 7, *user.OrgID)

	_, err = BuildAuthenticatedUser(map[string]any{
		"id":     float64(123),
		"org_id": float64(-1),
	})
	assert.ErrorContains(t, err, "org ID out of range")
}

func TestTokenIssuedAtUnixFromClaimsAdditionalTypes(t *testing.T) {
	got, ok := TokenIssuedAtUnixFromClaims(map[string]any{"auth_time": int64(123)})
	assert.True(t, ok)
	assert.Equal(t, int64(123), got)

	got, ok = TokenIssuedAtUnixFromClaims(map[string]any{"iat": int(456)})
	assert.True(t, ok)
	assert.Equal(t, int64(456), got)

	_, ok = TokenIssuedAtUnixFromClaims(map[string]any{"auth_time": int64(0), "iat": "not-int"})
	assert.False(t, ok)
}

func TestDebugEnabled(t *testing.T) {
	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "true")
	assert.True(t, DebugEnabled())

	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "false")
	assert.False(t, DebugEnabled())
}

func TestWithAuth_NoToken(t *testing.T) {
	handler := WithAuth(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	handler(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestWithOptionalAuth_NoToken(t *testing.T) {
	handler := WithOptionalAuth(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	handler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestWithOptionalAuth_InvalidToken(t *testing.T) {
	handler := WithOptionalAuth(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer invalid")
	w := httptest.NewRecorder()

	handler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}
