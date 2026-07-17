package auth_test

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRepositoryRemainingDeviceBranches(t *testing.T) {
	t.Run("organization id update overflow and mapping", func(t *testing.T) {
		mockDB := dbtest.NewMockPool(t)
		repo := auth.NewDeviceLoginRepository(db.New(mockDB))
		overflow := int(math.MaxInt32) + 1
		require.ErrorContains(t, repo.UpdateLogin(context.Background(), 1, auth.DeviceLoginUpdate{InternalOrgID: &overflow}), "organization_id exceeds")

		orgID := 11
		mockDB.ExpectExec("UPDATE device_logins").WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
		require.NoError(t, repo.UpdateLogin(context.Background(), 1, auth.DeviceLoginUpdate{InternalOrgID: &orgID}))

		now := time.Now()
		userID32, orgID32 := int32(7), int32(11)
		mockDB.ExpectQuery("SELECT (.+) FROM device_logins").WithArgs("device").WillReturnRows(
			pgxmock.NewRows([]string{"id", "device_code", "user_code", "status", "user_id", "organization_id", "poll_interval", "created_at", "expires_at", "authorized_at", "completed_at", "last_polled_at"}).
				AddRow(int32(1), "device", "CODE", db.DeviceLoginsStatusAUTHORIZED, &userID32, &orgID32, int32(5), pgtype.Timestamp{Time: now, Valid: true}, pgtype.Timestamp{Time: now.Add(time.Hour), Valid: true}, pgtype.Timestamp{}, pgtype.Timestamp{}, pgtype.Timestamp{}),
		)
		record, err := repo.FindByDeviceCode(context.Background(), "device")
		require.NoError(t, err)
		require.NotNil(t, record.InternalOrgID)
		assert.Equal(t, 11, *record.InternalOrgID)
	})

	t.Run("organization membership failures", func(t *testing.T) {
		mockDB := dbtest.NewMockPool(t)
		repo := auth.NewDeviceLoginRepository(db.New(mockDB)).(auth.DeviceLoginOrganizationRepository)
		mockDB.ExpectQuery("SELECT (.+) FROM users WHERE id").WithArgs(int32(7)).WillReturnRows(dbtest.UserRow(dbtest.User{ID: 7, Email: "user@example.com"}))
		_, err := repo.FindUserByIDForOrganization(context.Background(), 7, int(math.MaxInt32)+1)
		require.ErrorContains(t, err, "organization_id exceeds")

		mockDB.ExpectQuery("SELECT (.+) FROM users WHERE id").WithArgs(int32(7)).WillReturnRows(dbtest.UserRow(dbtest.User{ID: 7, Email: "user@example.com"}))
		mockDB.ExpectQuery("SELECT (.+) FROM memberships").WithArgs(int32(11), int32(7)).WillReturnError(pgx.ErrNoRows)
		_, err = repo.FindUserByIDForOrganization(context.Background(), 7, 11)
		require.ErrorIs(t, err, auth.ErrInvalidUser)
	})
}

type auditErrorRow struct{ err error }

func (r auditErrorRow) Scan(...any) error { return r.err }

type auditSavepointTx struct {
	pgx.Tx
	err error
}

func (t *auditSavepointTx) Begin(context.Context) (pgx.Tx, error) {
	return &auditSavepointTx{err: t.err}, nil
}
func (t *auditSavepointTx) QueryRow(context.Context, string, ...any) pgx.Row {
	return auditErrorRow{err: t.err}
}
func (*auditSavepointTx) Commit(context.Context) error   { return nil }
func (*auditSavepointTx) Rollback(context.Context) error { return nil }

func TestTransactionalAuditRepositoryUsesSavepoint(t *testing.T) {
	auditErr := errors.New("audit failed")
	repo := auth.NewTransactionalAuthUserRepository(db.New(&auditSavepointTx{err: auditErr})).(auth.AuditLogRepository)
	err := repo.CreateAuditLog(context.Background(), auth.AuditLogWrite{Action: "LOGIN", Resource: "session", Success: true})
	require.ErrorContains(t, err, "failed to create audit log")
}
