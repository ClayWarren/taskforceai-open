package webhooks

import (
	"context"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandleMembershipRemoved_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	workosID := "org_remove_ok"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	orgColumns := []string{
		"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
		"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
	}
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id`).
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows(orgColumns).
			AddRow(int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}")))

	mock.ExpectQuery(`SELECT .* FROM users WHERE email`).
		WithArgs("member@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 3, Email: "member@example.com", Theme: "system", APITier: db.DeveloperApiTier("free"),
		}))

	mock.ExpectExec(`DELETE FROM memberships`).
		WithArgs(int32(2), int32(3)).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	err := handleMembershipRemoved(context.Background(), q, "member@example.com", workosID)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleMembershipAdded_OrgMismatch(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	workosID := "org_expected"
	otherID := "org_other"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	orgColumns := []string{
		"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
		"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
	}
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id`).
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows(orgColumns).
			AddRow(int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &otherID, false, []byte("{}")))

	err := handleMembershipAdded(context.Background(), q, "user@example.com", workosID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "organization mismatch")
}

func TestHandleMembershipRemoved_OrgMismatch(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	workosID := "org_expected"
	otherID := "org_other"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	orgColumns := []string{
		"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
		"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
	}
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id`).
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows(orgColumns).
			AddRow(int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &otherID, false, []byte("{}")))

	err := handleMembershipRemoved(context.Background(), q, "user@example.com", workosID)
	assert.Error(t, err)
}
