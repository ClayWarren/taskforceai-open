package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHandler_NotFoundRoute(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/does-not-exist", nil)
	rr := httptest.NewRecorder()
	Handler(rr, req)
	assert.Equal(t, http.StatusNotFound, rr.Code)
	assert.Contains(t, rr.Body.String(), "Auth route not found")
}
