//go:build production

package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHandler_ProductionBuildOmitsTestLoginRoute(t *testing.T) {
	resetAuthEntrypoint()
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")

	req := httptest.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"/api/v1/auth/test-login",
		nil,
	)
	rr := httptest.NewRecorder()
	Handler(rr, req)

	assert.Equal(t, http.StatusNotFound, rr.Code)
}
