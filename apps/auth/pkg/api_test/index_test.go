package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	handler "github.com/TaskForceAI/auth-service/api"
	"github.com/stretchr/testify/require"
)

func TestHandler_ExhaustiveRoutes(t *testing.T) {
	// Set minimal env vars to avoid panics in initialization
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	t.Setenv("WORKOS_CLIENT_ID", "test")
	t.Setenv("GOOGLE_CLIENT_ID", "test")
	t.Setenv("AUTH_URL", "https://auth.example.com")
	t.Setenv("DATABASE_URL", "mock")

	routes := []struct {
		path   string
		method string
		body   any
	}{
		{"/api/auth/session", http.MethodGet, nil},
		{"/api/auth/session?debug=env", http.MethodGet, nil},
		{"/api/auth/csrf", http.MethodGet, nil},
		{"/api/auth/env-check", http.MethodGet, nil},
		{"/api/v1/auth/login", http.MethodGet, nil},
		{"/api/v1/auth/callback", http.MethodGet, nil},
		{"/api/v1/auth/login-method", http.MethodPost, map[string]string{"email": "test@example.com"}},
		{"/api/v1/auth/saml/signin", http.MethodGet, nil},
		{"/api/v1/auth/saml/callback", http.MethodGet, nil},
		{"/api/v1/auth/webhooks/workos", http.MethodPost, map[string]string{}},
		{"/api/auth/signout", http.MethodPost, nil},
		{"/api/v1/auth/logout", http.MethodPost, nil},
		{"/api/v1/auth/me", http.MethodGet, nil},
		{"/api/auth/signin/google", http.MethodGet, nil},
		{"/api/auth/signin/google-drive", http.MethodGet, nil},
		{"/api/auth/callback/google", http.MethodGet, nil},
		{"/api/auth/callback/google-drive", http.MethodGet, nil},
		{"/api/v1/auth/google", http.MethodPost, map[string]string{"idToken": "test"}},
		{"/api/v1/auth/apple", http.MethodPost, map[string]string{"identityToken": "test"}},
		{"/api/v1/auth/token", http.MethodGet, nil},
		{"/api/v1/auth/device/start", http.MethodPost, nil},
		{"/api/v1/auth/device/authorize", http.MethodPost, map[string]string{"user_code": "test"}},
		{"/api/v1/auth/device/token", http.MethodPost, map[string]string{"device_code": "test"}},
		{"/api/v1/auth/test-login", http.MethodPost, nil},
		{"/api/v1/auth/settings", http.MethodPost, map[string]any{"theme_preference": "dark"}},
		{"/api/auth/health", http.MethodGet, nil},
		{"/api/v1/auth/health", http.MethodGet, nil},
		{"/api/auth/debug", http.MethodGet, nil},
	}

	for _, rt := range routes {
		t.Run(rt.method+" "+rt.path, func(t *testing.T) {
			var bodyReader bytes.Buffer
			if rt.body != nil {
				require.NoError(t, json.NewEncoder(&bodyReader).Encode(rt.body))
			}

			req := httptest.NewRequest(rt.method, rt.path, &bodyReader)
			if rt.body != nil {
				req.Header.Set("Content-Type", "application/json")
			}
			w := httptest.NewRecorder()

			require.NotPanics(t, func() { handler.Handler(w, req) })
			require.NotZero(t, w.Code)
		})
	}
}
