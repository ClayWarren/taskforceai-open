package saml

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
)

func TestSigninHandler_GlobalWrapper_OrgNotFound(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test-key")
	t.Setenv("WORKOS_CLIENT_ID", "test-client")

	mockPool := dbtest.NewMockPool(t)

	domain := "unknown.com"
	mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE domain").
		WithArgs(&domain).
		WillReturnError(pgx.ErrNoRows)

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mockPool), nil
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	originalFactory := signinWorkOSFactory
	signinWorkOSFactory = func(_, _ string) providers.WorkOSProvider {
		return &testutils.MockWorkOSClient{}
	}
	t.Cleanup(func() { signinWorkOSFactory = originalFactory })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=user@unknown.com", nil)
	rr := httptest.NewRecorder()
	SigninHandler(rr, req)

	assert.Equal(t, http.StatusNotFound, rr.Code)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}
