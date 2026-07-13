package saml

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
)

func TestSigninHandler_GlobalWrapper_Success(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test-key")
	t.Setenv("WORKOS_CLIENT_ID", "test-client")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	t.Setenv("AUTH_SERVICE_URL", "https://auth.example.com")

	mockPool := dbtest.NewMockPool(t)

	domain := "acme.com"
	workosID := "org_global"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE domain").
		WithArgs(&domain).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
			"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
		}).AddRow(int32(1), "Acme", "acme", &domain, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}")))

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mockPool), nil
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	originalFactory := signinWorkOSFactory
	signinWorkOSFactory = func(_, _ string) providers.WorkOSProvider {
		return &testutils.MockWorkOSClient{SSOURL: "https://sso.example.com/global"}
	}
	t.Cleanup(func() { signinWorkOSFactory = originalFactory })

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/saml/signin?email=user@acme.com", nil)
	rr := httptest.NewRecorder()
	SigninHandler(rr, req)

	assert.Equal(t, http.StatusFound, rr.Code)
	assert.Equal(t, "https://sso.example.com/global", rr.Header().Get("Location"))
	assert.NoError(t, mockPool.ExpectationsWereMet())
}
