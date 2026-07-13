package saml

import (
	"context"
	"net/http"
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

func TestCallbackHandler_MaliciousAPPURL(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test")
	t.Setenv("WORKOS_CLIENT_ID", "test")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")
	t.Setenv("APP_URL", "https://evil.example/phish")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")

	mockPool := dbtest.NewMockPool(t)

	workosID := "org_123"
	mockPool.ExpectBeginTx(pgx.TxOptions{})
	mockPool.ExpectQuery("SELECT (.+) FROM organizations WHERE workos_organization_id").
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
			"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
		}).AddRow(int32(2), "Org", "org", nil, pgtype.Timestamp{Time: time.Now(), Valid: true}, pgtype.Timestamp{Time: time.Now(), Valid: true}, "free", nil, nil, nil, &workosID, false, []byte("{}")))
	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(2), int32(1)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(9), int32(2), int32(1), db.OrganizationRoleMEMBER, pgtype.Timestamp{Time: time.Now(), Valid: true}, pgtype.Timestamp{Time: time.Now(), Valid: true}))
	mockPool.ExpectCommit()

	h := &CallbackHandlerStruct{
		WorkOS: &testutils.MockWorkOSClient{
			SSOProfile: sso.ProfileAndToken{
				Profile: sso.Profile{ID: "p1", Email: "user@acme.com", OrganizationID: workosID},
			},
		},
		LinkUser: func(context.Context, *db.Queries, sso.Profile) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: "user@acme.com"}, nil
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			return db.New(mockPool), nil
		},
	}

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=valid")
	rr := serve(h, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}
