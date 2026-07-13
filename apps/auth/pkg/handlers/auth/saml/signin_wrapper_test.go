package saml

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/stretchr/testify/assert"
)

func TestSigninHandler_GlobalWrapper(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test-key")
	t.Setenv("WORKOS_CLIENT_ID", "test-client")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin", nil)
	rr := httptest.NewRecorder()
	SigninHandler(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestSigninHandler_GlobalWrapper_DBError(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test-key")
	t.Setenv("WORKOS_CLIENT_ID", "test-client")

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=user@example.com", nil)
	rr := httptest.NewRecorder()
	SigninHandler(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestSigninHandler_NotConfigured(t *testing.T) {
	_ = os.Unsetenv("WORKOS_API_KEY")
	_ = os.Unsetenv("WORKOS_CLIENT_ID")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=user@example.com", nil)
	rr := httptest.NewRecorder()
	SigninHandler(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}
