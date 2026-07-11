package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHandler_HealthRoute(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/health", nil)
	rr := httptest.NewRecorder()
	Handler(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestHandler_EnvCheckDisabled(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	t.Setenv("DEBUG_ENDPOINTS_ENABLED", "")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/auth/env-check", nil)
	rr := httptest.NewRecorder()
	Handler(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
}
