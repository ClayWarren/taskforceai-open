package saml

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
)

func TestSigninHandlerStruct_WorkOSURLError(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test-key")
	t.Setenv("WORKOS_CLIENT_ID", "test-client")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")

	mockPool := dbtest.NewMockPool(t)

	domain := "acme.com"
	workosID := "org_err"
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

	h := &SigninHandlerStruct{
		WorkOS: &testutils.MockWorkOSClient{SSOURLErr: errors.New("sso url failed")},
		GetOrg: func(ctx context.Context, q *db.Queries, domain string) (*db.Organization, error) {
			org, err := q.GetOrganizationByDomain(ctx, &domain)
			if err != nil {
				return nil, err
			}
			return &org, nil
		},
	}

	rr := doGet(h, "/api/v1/auth/saml/signin?email=user@acme.com")
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestSigninHandlerStruct_InvalidEmailParts(t *testing.T) {
	h := &SigninHandlerStruct{WorkOS: &testutils.MockWorkOSClient{}}
	t.Setenv("WORKOS_API_KEY", "k")
	t.Setenv("WORKOS_CLIENT_ID", "c")

	rr := doGet(h, "/api/v1/auth/saml/signin?email=user@@acme.com")
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
