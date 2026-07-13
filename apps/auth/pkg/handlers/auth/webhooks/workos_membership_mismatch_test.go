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

func TestHandleMembershipRemoved_WorkosOrgIDMismatch(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	workosID := "org_expected"
	otherID := "org_actual"
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	orgCols := []string{
		"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
		"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
	}
	mock.ExpectQuery(`SELECT (.+) FROM organizations WHERE workos_organization_id`).
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows(orgCols).
			AddRow(int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &otherID, false, []byte("{}")))

	err := handleMembershipRemoved(context.Background(), db.New(mock), "user@example.com", workosID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "organization mismatch")
	assert.NoError(t, mock.ExpectationsWereMet())
}
