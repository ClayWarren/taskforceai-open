package webhooks

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDecodeWorkOSGroupMemberRejectsMalformedJSON(t *testing.T) {
	_, _, err := decodeWorkOSGroupMember([]byte("{"))
	require.Error(t, err)
}

func TestProcessUserUpdateBranches(t *testing.T) {
	ctx := context.Background()
	recorder := httptest.NewRecorder()
	recordDeadLetter := func(context.Context, error, string) {}

	t.Run("invalid payload", func(t *testing.T) {
		h := &WorkOSWebhookHandlerStruct{}
		outcome, err := h.processUserUpdate(ctx, recorder, nil, "evt", []byte("{"), recordDeadLetter)
		require.Error(t, err)
		assert.Equal(t, "validation_failed", outcome)
	})

	t.Run("inactive failure", func(t *testing.T) {
		expected := errors.New("deactivate failed")
		h := &WorkOSWebhookHandlerStruct{DeactivateUser: func(context.Context, *db.Queries, string, string) error { return expected }}
		outcome, err := h.processUserUpdate(ctx, httptest.NewRecorder(), nil, "evt", []byte(`{"email":"old@example.com","organization_id":"org_1","state":"inactive"}`), recordDeadLetter)
		require.ErrorIs(t, err, expected)
		assert.Equal(t, "deactivate_failed", outcome)
	})

	t.Run("active failure", func(t *testing.T) {
		expected := errors.New("update failed")
		h := &WorkOSWebhookHandlerStruct{UpdateUser: func(context.Context, *db.Queries, WorkosUser) error { return expected }}
		outcome, err := h.processUserUpdate(ctx, httptest.NewRecorder(), nil, "evt", []byte(`{"email":"new@example.com","organization_id":"org_1","state":"active"}`), recordDeadLetter)
		require.ErrorIs(t, err, expected)
		assert.Equal(t, "user_update_failed", outcome)
	})
}

func TestHandleUserUpdatedGuards(t *testing.T) {
	require.Error(t, handleUserUpdated(context.Background(), nil, WorkosUser{}))
	user := WorkosUser{
		Email:          "same@example.com",
		OrganizationID: "org_1",
	}
	user.PreviousAttributes.Email = " same@example.com "
	require.NoError(t, handleUserUpdated(context.Background(), &db.Queries{}, user))
}

func expectWorkOSUpdateMember(mock pgxmock.PgxPoolIface, email string) {
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "org_1"
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).WithArgs(pgxmock.AnyArg()).WillReturnRows(
		pgxmock.NewRows([]string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}).
			AddRow(int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}")),
	)
	mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).WithArgs(email).WillReturnRows(dbtest.UserRow(dbtest.User{ID: 3, Email: email, Theme: "system"}))
}

func updatedWorkOSUser() WorkosUser {
	user := WorkosUser{Email: "new@example.com", OrganizationID: "org_1"}
	user.PreviousAttributes.Email = "old@example.com"
	return user
}

func TestHandleUserUpdatedDatabaseBranches(t *testing.T) {
	t.Run("deactivation lookup error", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).WithArgs(pgxmock.AnyArg()).WillReturnError(errors.New("org failed"))
		require.ErrorContains(t, handleUserDeactivated(context.Background(), db.New(mock), "old@example.com", "org_1"), "org failed")
	})

	t.Run("update lookup error", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).WithArgs(pgxmock.AnyArg()).WillReturnError(errors.New("org failed"))
		require.ErrorContains(t, handleUserUpdated(context.Background(), db.New(mock), updatedWorkOSUser()), "org failed")
	})

	t.Run("missing prior user", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
		workosID := "org_1"
		mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).WithArgs(pgxmock.AnyArg()).WillReturnRows(
			pgxmock.NewRows([]string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}).
				AddRow(int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}")),
		)
		mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).WithArgs("old@example.com").WillReturnError(pgx.ErrNoRows)
		require.ErrorContains(t, handleUserUpdated(context.Background(), db.New(mock), updatedWorkOSUser()), "not found")
	})

	for _, tc := range []struct {
		name       string
		membership error
		update     error
	}{
		{name: "membership error", membership: errors.New("membership failed")},
		{name: "update error", update: errors.New("update failed")},
		{name: "success"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mock := dbtest.NewMockPool(t)
			expectWorkOSUpdateMember(mock, "old@example.com")
			ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
			membership := mock.ExpectQuery(`SELECT .* FROM memberships`).WithArgs(int32(2), int32(3))
			if tc.membership != nil {
				membership.WillReturnError(tc.membership)
			} else {
				membership.WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).AddRow(int32(1), int32(2), int32(3), db.OrganizationRoleMEMBER, ts, ts))
				update := mock.ExpectQuery(`UPDATE users SET email`).WithArgs(int32(3), "new@example.com")
				if tc.update != nil {
					update.WillReturnError(tc.update)
				} else {
					update.WillReturnRows(dbtest.UserRow(dbtest.User{ID: 3, Email: "new@example.com", Theme: "system"}))
				}
			}
			err := handleUserUpdated(context.Background(), db.New(mock), updatedWorkOSUser())
			if tc.membership != nil || tc.update != nil {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
