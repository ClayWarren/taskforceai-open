package db

import (
	"context"

	"github.com/jackc/pgx/v5"
)

const updateAdminUserFields = `
UPDATE users
SET
    plan = COALESCE($3::text, plan),
    is_admin = COALESCE($4::boolean, is_admin)
WHERE
    ($1::integer IS NOT NULL AND id = $1)
    OR ($1::integer IS NULL AND email = $2)
`

type UpdateAdminUserFieldsParams struct {
	UserID  *int32
	Email   string
	Plan    *string
	IsAdmin *bool
}

// UpdateAdminUserFields applies all requested admin-controlled user fields in
// one statement so a request cannot leave partially updated state.
func (q *Queries) UpdateAdminUserFields(ctx context.Context, arg UpdateAdminUserFieldsParams) error {
	tag, err := q.db.Exec(ctx, updateAdminUserFields, arg.UserID, arg.Email, arg.Plan, arg.IsAdmin)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}
	return nil
}
