package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authservicehandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/stretchr/testify/assert"
)

func TestNewRouter_AuthRoutesSmoke(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	r, _ := NewRouter()
	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/auth/session", ""},
		{http.MethodGet, "/api/auth/csrf", ""},
		{http.MethodGet, "/api/v1/auth/login", ""},
		{http.MethodGet, "/api/v1/auth/callback?code=x&state=y", ""},
		{http.MethodPost, "/api/v1/auth/login-method", `{"email":"user@example.com"}`},
		{http.MethodGet, "/api/v1/auth/saml/signin?domain=example.com", ""},
		{http.MethodPost, "/api/v1/auth/webhooks/workos", `{}`},
		{http.MethodPost, "/api/auth/signout", ""},
		{http.MethodGet, "/api/auth/signin/google-drive", ""},
		{http.MethodGet, "/api/auth/signin/github", ""},
		{http.MethodGet, "/api/v1/auth/token", ""},
		{http.MethodPost, "/api/v1/auth/google", `{"idToken":"x"}`},
		{http.MethodPost, "/api/v1/auth/apple", `{"identityToken":"x"}`},
		{http.MethodPost, "/api/v1/auth/device/start", `{}`},
		{http.MethodPost, "/api/v1/auth/device/authorize", `{}`},
		{http.MethodPost, "/api/v1/auth/device/token", `{}`},
		{http.MethodPost, "/api/v1/auth/refresh", ""},
		{http.MethodPost, "/api/v1/auth/impersonate", `{"email":"user@example.com"}`},
		{http.MethodPut, "/api/v1/auth/settings", `{}`},
		{http.MethodGet, "/api/v1/auth/ping", ""},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			var req *http.Request
			if tc.body != "" {
				req = httptest.NewRequestWithContext(context.Background(), tc.method, tc.path, strings.NewReader(tc.body))
				req.Header.Set("Content-Type", "application/json")
			} else {
				req = httptest.NewRequestWithContext(context.Background(), tc.method, tc.path, http.NoBody)
			}
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, req)
			assert.NotEqual(t, 0, rr.Code)
		})
	}
}

func TestNewRouter_HumaOwnsStructuredJSONOperations(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	_, api := NewRouter()
	expected := map[string]string{
		"/api/auth/session":                    http.MethodGet,
		"/api/auth/csrf":                       http.MethodGet,
		"/api/v1/auth/login-method":            http.MethodPost,
		"/api/v1/auth/token":                   http.MethodGet,
		"/api/v1/auth/google":                  http.MethodPost,
		"/api/v1/auth/apple":                   http.MethodPost,
		"/api/v1/auth/refresh":                 http.MethodPost,
		"/api/v1/auth/impersonate":             http.MethodPost,
		"/api/v1/auth/mfa/authenticator/login": http.MethodPost,
	}
	for path, method := range expected {
		pathItem := api.OpenAPI().Paths[path]
		if assert.NotNil(t, pathItem, path) {
			switch method {
			case http.MethodGet:
				assert.NotNil(t, pathItem.Get, path)
			case http.MethodPost:
				assert.NotNil(t, pathItem.Post, path)
			}
		}
	}

	for _, chiOnlyPath := range []string{
		"/api/v1/auth/login",
		"/api/v1/auth/callback",
		"/api/v1/auth/saml/callback",
		"/api/v1/auth/webhooks/workos",
		"/api/auth/signout",
		"/api/auth/ping",
	} {
		assert.Nil(t, api.OpenAPI().Paths[chiOnlyPath], chiOnlyPath)
	}
}

func TestHandler_FullEntrypointSmoke(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	authservicehandler.SetQueriesOverride(nil)

	paths := []string{
		"/api/v1/auth/health",
		"/api/v1/auth/ping",
	}
	for _, path := range paths {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil)
		rr := httptest.NewRecorder()
		Handler(rr, req)
		assert.NotEqual(t, 0, rr.Code)
	}
}
