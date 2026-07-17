package saml

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/workos/workos-go/v6/pkg/sso"
)

func TestCallbackHandler_SuccessWithMembershipCreate(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test")
	t.Setenv("WORKOS_CLIENT_ID", "test")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "www.taskforceai.chat")
	t.Setenv("APP_URL", "https://www.taskforceai.chat")
	defer func() {
		_ = os.Unsetenv("WORKOS_API_KEY")
		_ = os.Unsetenv("WORKOS_CLIENT_ID")
		_ = os.Unsetenv("AUTH_SECRET")
		_ = os.Unsetenv("ALLOWED_REDIRECT_DOMAIN")
		_ = os.Unsetenv("APP_URL")
	}()

	mockWorkOS := &testutils.MockWorkOSClient{
		SSOProfile: sso.ProfileAndToken{
			Profile: sso.Profile{
				ID:             "prof_123",
				Email:          "member@example.com",
				OrganizationID: "org_123",
			},
		},
	}

	mockPool := dbtest.NewMockPool(t)

	workosID := "org_123"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	orgCols := []string{
		"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
		"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
	}

	mockPool.ExpectBeginTx(pgx.TxOptions{})
	mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id").
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows(orgCols).
			AddRow(int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}")))
	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(2), int32(10)).
		WillReturnError(pgx.ErrNoRows)
	mockPool.ExpectQuery("INSERT INTO memberships").
		WithArgs(int32(2), int32(10), db.OrganizationRoleMEMBER).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(99), int32(2), int32(10), db.OrganizationRoleMEMBER, ts, ts))
	mockPool.ExpectCommit()

	mockPool.ExpectQuery("INSERT INTO audit_logs").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "timestamp", "user_id", "organization_id", "action", "resource", "resource_id",
			"ip_address", "user_agent", "details", "success", "error_message",
		}).AddRow(int32(1), ts, nil, nil, "LOGIN", "user", nil, nil, nil, []byte("{}"), true, nil))

	h := &CallbackHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(context.Context, *db.Queries, sso.Profile) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 10, Email: "member@example.com"}, nil
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		},
	}

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=valid")
	rr := serve(h, req)

	assert.Equal(t, http.StatusFound, rr.Code)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}
