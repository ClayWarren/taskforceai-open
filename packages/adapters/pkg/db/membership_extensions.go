package db

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const lockMembershipOwnerMutation = `
SELECT 1
FROM pg_advisory_xact_lock(hashtext('taskforceai.membership-owner'), $1)
`

const updateMembershipRolePreservingOwners = `
UPDATE memberships AS target
SET role = $3::"OrganizationRole", updated_at = CURRENT_TIMESTAMP
WHERE target.organization_id = $1
  AND target.user_id = $2
  AND (
    target.role <> 'OWNER'::"OrganizationRole"
    OR $3::"OrganizationRole" = 'OWNER'::"OrganizationRole"
    OR EXISTS (
      SELECT 1
      FROM memberships AS other
      WHERE other.organization_id = target.organization_id
        AND other.user_id <> target.user_id
        AND other.role = 'OWNER'::"OrganizationRole"
    )
  )
`

const deleteMembershipPreservingOwners = `
DELETE FROM memberships AS target
WHERE target.organization_id = $1
  AND target.user_id = $2
  AND (
    target.role <> 'OWNER'::"OrganizationRole"
    OR EXISTS (
      SELECT 1
      FROM memberships AS other
      WHERE other.organization_id = target.organization_id
        AND other.user_id <> target.user_id
        AND other.role = 'OWNER'::"OrganizationRole"
    )
  )
`

type membershipMutation func(pgx.Tx) (pgconn.CommandTag, error)

// UpdateMembershipRolePreservingOwners serializes owner mutations per
// organization and updates only when at least one owner will remain.
func (q *Queries) UpdateMembershipRolePreservingOwners(ctx context.Context, organizationID, userID int32, role string) (bool, error) {
	return q.withMembershipOwnerLock(ctx, organizationID, func(tx pgx.Tx) (pgconn.CommandTag, error) {
		return tx.Exec(ctx, updateMembershipRolePreservingOwners, organizationID, userID, role)
	})
}

// DeleteMembershipPreservingOwners serializes owner mutations per
// organization and deletes only when at least one owner will remain.
func (q *Queries) DeleteMembershipPreservingOwners(ctx context.Context, organizationID, userID int32) (bool, error) {
	return q.withMembershipOwnerLock(ctx, organizationID, func(tx pgx.Tx) (pgconn.CommandTag, error) {
		return tx.Exec(ctx, deleteMembershipPreservingOwners, organizationID, userID)
	})
}

func (q *Queries) withMembershipOwnerLock(ctx context.Context, organizationID int32, mutate membershipMutation) (bool, error) {
	beginner, ok := q.db.(interface {
		Begin(context.Context) (pgx.Tx, error)
	})
	if !ok {
		return false, errors.New("membership store does not support transactions")
	}
	tx, err := beginner.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var locked int
	if err := tx.QueryRow(ctx, lockMembershipOwnerMutation, organizationID).Scan(&locked); err != nil {
		return false, err
	}
	tag, err := mutate(tx)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}
