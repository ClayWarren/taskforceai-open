//go:build !production

package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHandler_ChiPingRoutes(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	for _, path := range []string{"/api/auth/ping", "/api/v1/auth/ping"} {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, path, nil)
		rr := httptest.NewRecorder()
		Handler(rr, req)
		assert.Equal(t, http.StatusOK, rr.Code, path)
		assert.Contains(t, rr.Body.String(), `"status":"ok"`, path)
	}
}

func TestHandler_TestLoginRouteRequiresExplicitLocalMode(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	req := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodGet,
		"/api/v1/auth/test-login",
		nil,
	)
	rr := httptest.NewRecorder()
	Handler(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)

	resetAuthEntrypoint()
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	req = httptest.NewRequestWithContext(
		context.Background(),
		http.MethodGet,
		"/api/v1/auth/test-login",
		nil,
	)
	rr = httptest.NewRecorder()
	Handler(rr, req)
	assert.Equal(t, http.StatusMethodNotAllowed, rr.Code)
}
