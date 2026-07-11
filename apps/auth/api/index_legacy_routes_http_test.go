package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHandler_ChiAndHumaRoutesSmoke(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	t.Setenv("WORKOS_API_KEY", "test")
	t.Setenv("WORKOS_CLIENT_ID", "test")

	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/auth/csrf"},
		{http.MethodPost, "/api/v1/auth/login-method"},
		{http.MethodPost, "/api/auth/signout"},
		{http.MethodGet, "/api/auth/signin/github"},
		{http.MethodGet, "/api/auth/signin/google-drive"},
		{http.MethodGet, "/api/v1/auth/login"},
		{http.MethodGet, "/api/v1/auth/callback"},
		{http.MethodGet, "/api/v1/auth/saml/signin?email=user@example.com"},
		{http.MethodGet, "/api/v1/auth/saml/callback"},
		{http.MethodPost, "/api/v1/auth/refresh"},
		{http.MethodGet, "/api/auth/session"},
	}

	for _, route := range routes {
		req := httptest.NewRequestWithContext(context.Background(), route.method, route.path, nil)
		rr := httptest.NewRecorder()
		Handler(rr, req)
		assert.NotEqual(t, http.StatusNotFound, rr.Code, route.path)
	}
}
