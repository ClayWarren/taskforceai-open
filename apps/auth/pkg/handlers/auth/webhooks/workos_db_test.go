package webhooks

import (
	"context"
	"errors"
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

func TestHandleUserDeactivated_DBUnavailable(t *testing.T) {
	err := handleUserDeactivated(context.Background(), nil, "user@example.com", "workos")
	assert.Error(t, err)
}

func TestHandleUserDeactivated_MissingOrg(t *testing.T) {
	err := handleUserDeactivated(context.Background(), &db.Queries{}, "user@example.com", "")
	assert.Error(t, err)
}

func TestHandleUserDeactivated_RemovesScopedMembershipWithoutDisablingUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	orgColumns := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "workos"
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgColumns).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}"),
		))

	mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("user@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 3, Email: "user@example.com", Theme: "system"}))

	mock.ExpectExec(`DELETE FROM memberships`).
		WithArgs(int32(2), int32(3)).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	err := handleUserDeactivated(context.Background(), q, "user@example.com", "workos")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleUserDeactivated_RemoveError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	orgColumns := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "workos"
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgColumns).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}"),
		))

	mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("user@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 3, Email: "user@example.com", Theme: "system"}))

	mock.ExpectExec(`DELETE FROM memberships`).
		WithArgs(int32(2), int32(3)).
		WillReturnError(errors.New("delete failed"))

	err := handleUserDeactivated(context.Background(), q, "user@example.com", "workos")
	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleUserDeactivated_UserNotFoundNoops(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	orgColumns := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "workos"
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgColumns).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}"),
		))

	mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("missing@example.com").
		WillReturnError(pgx.ErrNoRows)

	err := handleUserDeactivated(context.Background(), q, "missing@example.com", "workos")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleUserDeactivated_UnrelatedUserWithoutScopedMembershipDoesNotDisableUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	orgColumns := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "workos"
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgColumns).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}"),
		))

	mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("user@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 3, Email: "user@example.com", Theme: "system"}))

	mock.ExpectExec(`DELETE FROM memberships`).
		WithArgs(int32(2), int32(3)).
		WillReturnResult(pgxmock.NewResult("DELETE", 0))

	err := handleUserDeactivated(context.Background(), q, "user@example.com", "workos")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleMembershipAdded_MissingOrg(t *testing.T) {
	err := handleMembershipAdded(context.Background(), &db.Queries{}, "user@example.com", "")
	assert.Error(t, err)
}

func TestHandleMembershipAdded_OrgLookupError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnError(errors.New("org error"))

	err := handleMembershipAdded(context.Background(), q, "user@example.com", "workos")
	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleMembershipAdded_CreateUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	orgColumns := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "workos"
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgColumns).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}"),
		))

	// Transaction wraps CreateUser + CreateMembership
	mock.ExpectBeginTx(pgx.TxOptions{})

	mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("user@example.com").
		WillReturnError(pgx.ErrNoRows)

	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs("user@example.com", pgxmock.AnyArg(), "free").
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 3, Email: "user@example.com", Theme: "system"}))

	membershipCols := []string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}
	mock.ExpectQuery(`INSERT INTO memberships`).
		WithArgs(int32(2), int32(3), db.OrganizationRoleMEMBER).
		WillReturnRows(pgxmock.NewRows(membershipCols).AddRow(int32(1), int32(2), int32(3), db.OrganizationRoleMEMBER, ts, ts))

	mock.ExpectCommit()

	err := handleMembershipAdded(context.Background(), q, "user@example.com", "workos")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleMembershipAdded_CreateUserError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	orgColumns := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "workos"
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgColumns).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}"),
		))

	// Transaction wraps CreateUser + CreateMembership — rollback on CreateUser failure
	mock.ExpectBeginTx(pgx.TxOptions{})

	mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("user@example.com").
		WillReturnError(pgx.ErrNoRows)

	mock.ExpectQuery(`INSERT INTO users`).
		WithArgs("user@example.com", pgxmock.AnyArg(), "free").
		WillReturnError(errors.New("create user failed"))

	mock.ExpectRollback()

	err := handleMembershipAdded(context.Background(), q, "user@example.com", "workos")
	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleMembershipAdded_CreateMembershipError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	orgColumns := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "workos"
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgColumns).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}"),
		))

	// Transaction wraps GetUser + CreateMembership — rollback on CreateMembership failure
	mock.ExpectBeginTx(pgx.TxOptions{})

	mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("user@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 3, Email: "user@example.com", Theme: "system"}))

	mock.ExpectQuery(`INSERT INTO memberships`).
		WithArgs(int32(2), int32(3), db.OrganizationRoleMEMBER).
		WillReturnError(errors.New("membership failed"))

	mock.ExpectRollback()

	err := handleMembershipAdded(context.Background(), q, "user@example.com", "workos")
	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleMembershipRemoved_UserMissing(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	orgColumns := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "workos"
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgColumns).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}"),
		))

	mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("user@example.com").
		WillReturnError(pgx.ErrNoRows)

	err := handleMembershipRemoved(context.Background(), q, "user@example.com", "workos")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleMembershipRemoved_MissingOrg(t *testing.T) {
	err := handleMembershipRemoved(context.Background(), &db.Queries{}, "user@example.com", "")
	assert.Error(t, err)
}

func TestHandleMembershipRemoved_OrgLookupError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnError(errors.New("org error"))

	err := handleMembershipRemoved(context.Background(), q, "user@example.com", "workos")
	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestHandleMembershipRemoved_DeleteError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	q := db.New(mock)

	orgColumns := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "workos"
	mock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(orgColumns).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}"),
		))

	mock.ExpectQuery(`SELECT .* FROM users WHERE email = \$1`).
		WithArgs("user@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 3, Email: "user@example.com", Theme: "system"}))

	mock.ExpectExec(`DELETE FROM memberships`).
		WithArgs(int32(2), int32(3)).
		WillReturnError(errors.New("delete failed"))

	err := handleMembershipRemoved(context.Background(), q, "user@example.com", "workos")
	require.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}
