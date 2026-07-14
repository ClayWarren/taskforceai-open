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
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/workos/workos-go/v6/pkg/sso"
)

func TestCallbackHandler_GlobalSuccessWithRedis(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test")
	t.Setenv("WORKOS_CLIENT_ID", "test")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "www.taskforceai.chat")
	t.Setenv("APP_URL", "https://www.taskforceai.chat")

	originalFactory := callbackWorkOSFactory
	callbackWorkOSFactory = func(_, _ string) providers.WorkOSProvider {
		return &testutils.MockWorkOSClient{
			SSOProfile: sso.ProfileAndToken{
				Profile: sso.Profile{
					ID:             "prof_global",
					Email:          "global@example.com",
					OrganizationID: "org_global",
				},
			},
		}
	}
	t.Cleanup(func() { callbackWorkOSFactory = originalFactory })

	mockPool := dbtest.NewMockPool(t)

	workosID := "org_global"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	orgCols := []string{
		"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
		"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
	}

	mockPool.ExpectBeginTx(pgx.TxOptions{})
	expectSAMLDomainOrgRow(mockPool, "example.com", workosID, 3)
	mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs("global@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 11, Email: "global@example.com", APITier: db.DeveloperApiTier("free"),
		}))
	mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id").
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows(orgCols).
			AddRow(int32(3), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}")))
	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(3), int32(11)).
		WillReturnError(pgx.ErrNoRows)
	mockPool.ExpectQuery("INSERT INTO memberships").
		WithArgs(int32(3), int32(11), db.OrganizationRoleMEMBER).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(100), int32(3), int32(11), db.OrganizationRoleMEMBER, ts, ts))
	mockPool.ExpectCommit()

	mockPool.ExpectQuery("INSERT INTO audit_logs").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "timestamp", "user_id", "organization_id", "action", "resource", "resource_id",
			"ip_address", "user_agent", "details", "success", "error_message",
		}).AddRow(int32(1), ts, nil, nil, "LOGIN", "user", nil, nil, nil, []byte("{}"), true, nil))

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mockPool), nil
	})
	authhandler.SetRedisClient(infraredis.NewMockClient())
	t.Cleanup(func() {
		authhandler.SetQueriesOverride(nil)
		authhandler.SetRedisClient(nil)
	})

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=valid")
	req.Header.Set("X-Forwarded-For", "203.0.113.10")
	rr := httptest.NewRecorder()
	CallbackHandler(rr, req)

	assert.Equal(t, http.StatusFound, rr.Code)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}
