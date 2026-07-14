package callback_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	auth_handler "github.com/TaskForceAI/auth-service/pkg/handlers/auth/callback"
	"github.com/stretchr/testify/assert"
)

func TestGoogleDriveCallbackHandler_ConfiguredMissingCode(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "client")
	t.Setenv("GOOGLE_CLIENT_SECRET", "secret")
	t.Setenv("GOOGLE_DRIVE_REDIRECT_URL", "https://example.com/callback")

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive", nil)
	rr := httptest.NewRecorder()
	auth_handler.GoogleDriveCallbackHandler(rr, req)
	assert.NotEqual(t, http.StatusInternalServerError, rr.Code)
}

func TestGoogleDriveCallbackHandler_QueriesOverrideUsed(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "client")
	t.Setenv("GOOGLE_CLIENT_SECRET", "secret")
	t.Setenv("GOOGLE_DRIVE_REDIRECT_URL", "https://example.com/callback")

	mock := dbtest.NewMockPool(t)

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive?code=abc&state=xyz", nil)
	rr := httptest.NewRecorder()
	auth_handler.GoogleDriveCallbackHandler(rr, req)
	assert.NotEqual(t, http.StatusInternalServerError, rr.Code)
}
