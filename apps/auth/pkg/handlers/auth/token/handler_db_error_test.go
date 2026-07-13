package authtoken

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/stretchr/testify/assert"
)

func TestTokenHandler_DatabaseUnavailable(t *testing.T) {
	t.Setenv("AUTH_SECRET", tokenTestSecret)
	validToken := generateValidToken(t)

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, assert.AnError
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/token", nil)
	req.AddCookie(&http.Cookie{Name: "session_token", Value: validToken})
	rr := httptest.NewRecorder()
	Handler(rr, req)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}
