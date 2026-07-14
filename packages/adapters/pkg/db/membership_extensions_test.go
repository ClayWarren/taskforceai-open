package db

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type dbWithoutTransactions struct{ DBTX }

func expectMembershipOwnerLock(mock pgxmock.PgxPoolIface) {
	mock.ExpectQuery(regexp.QuoteMeta(lockMembershipOwnerMutation)).
		WithArgs(int32(17)).
		WillReturnRows(pgxmock.NewRows([]string{"locked"}).AddRow(1))
}

func TestMembershipOwnerMutations(t *testing.T) {
	ctx := context.Background()
	const organizationID int32 = 17
	const userID int32 = 42

	t.Run("requires transactions", func(t *testing.T) {
		q := New(dbWithoutTransactions{})
		updated, err := q.UpdateMembershipRolePreservingOwners(ctx, organizationID, userID, "MEMBER")
		assert.False(t, updated)
		require.ErrorContains(t, err, "does not support transactions")
	})

	t.Run("begin failure", func(t *testing.T) {
		mock := newRegexpTestMockPool(t)
		mock.ExpectBegin().WillReturnError(errors.New("begin failed"))
		updated, err := New(mock).UpdateMembershipRolePreservingOwners(ctx, organizationID, userID, "MEMBER")
		assert.False(t, updated)
		require.ErrorContains(t, err, "begin failed")
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("lock failure", func(t *testing.T) {
		mock := newRegexpTestMockPool(t)
		mock.ExpectBegin()
		mock.ExpectQuery(regexp.QuoteMeta(lockMembershipOwnerMutation)).
			WithArgs(organizationID).
			WillReturnError(errors.New("lock failed"))
		mock.ExpectRollback()
		updated, err := New(mock).UpdateMembershipRolePreservingOwners(ctx, organizationID, userID, "MEMBER")
		assert.False(t, updated)
		require.ErrorContains(t, err, "lock failed")
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("mutation failure", func(t *testing.T) {
		mock := newRegexpTestMockPool(t)
		mock.ExpectBegin()
		expectMembershipOwnerLock(mock)
		mock.ExpectExec(regexp.QuoteMeta(updateMembershipRolePreservingOwners)).
			WithArgs(organizationID, userID, "MEMBER").
			WillReturnError(errors.New("update failed"))
		mock.ExpectRollback()
		updated, err := New(mock).UpdateMembershipRolePreservingOwners(ctx, organizationID, userID, "MEMBER")
		assert.False(t, updated)
		require.ErrorContains(t, err, "update failed")
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("last owner is preserved", func(t *testing.T) {
		mock := newRegexpTestMockPool(t)
		mock.ExpectBegin()
		expectMembershipOwnerLock(mock)
		mock.ExpectExec(regexp.QuoteMeta(updateMembershipRolePreservingOwners)).
			WithArgs(organizationID, userID, "MEMBER").
			WillReturnResult(pgxmock.NewResult("UPDATE", 0))
		mock.ExpectRollback()
		updated, err := New(mock).UpdateMembershipRolePreservingOwners(ctx, organizationID, userID, "MEMBER")
		require.NoError(t, err)
		assert.False(t, updated)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("commit failure", func(t *testing.T) {
		mock := newRegexpTestMockPool(t)
		mock.ExpectBegin()
		expectMembershipOwnerLock(mock)
		mock.ExpectExec(regexp.QuoteMeta(updateMembershipRolePreservingOwners)).
			WithArgs(organizationID, userID, "ADMIN").
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))
		mock.ExpectCommit().WillReturnError(errors.New("commit failed"))
		mock.ExpectRollback()
		updated, err := New(mock).UpdateMembershipRolePreservingOwners(ctx, organizationID, userID, "ADMIN")
		assert.False(t, updated)
		require.ErrorContains(t, err, "commit failed")
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("update succeeds", func(t *testing.T) {
		mock := newRegexpTestMockPool(t)
		mock.ExpectBegin()
		expectMembershipOwnerLock(mock)
		mock.ExpectExec(regexp.QuoteMeta(updateMembershipRolePreservingOwners)).
			WithArgs(organizationID, userID, "ADMIN").
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))
		mock.ExpectCommit()
		updated, err := New(mock).UpdateMembershipRolePreservingOwners(ctx, organizationID, userID, "ADMIN")
		require.NoError(t, err)
		assert.True(t, updated)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("delete succeeds", func(t *testing.T) {
		mock := newRegexpTestMockPool(t)
		mock.ExpectBegin()
		expectMembershipOwnerLock(mock)
		mock.ExpectExec(regexp.QuoteMeta(deleteMembershipPreservingOwners)).
			WithArgs(organizationID, userID).
			WillReturnResult(pgxmock.NewResult("DELETE", 1))
		mock.ExpectCommit()
		deleted, err := New(mock).DeleteMembershipPreservingOwners(ctx, organizationID, userID)
		require.NoError(t, err)
		assert.True(t, deleted)
		assert.NoError(t, mock.ExpectationsWereMet())
	})
}
