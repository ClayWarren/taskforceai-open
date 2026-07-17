package auth_test

import (
	"context"
	"errors"
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

func deviceLoginColumns() []string {
	return []string{
		"id", "device_code", "user_code", "status", "user_id", "organization_id", "poll_interval",
		"created_at", "expires_at", "authorized_at", "completed_at", "last_polled_at",
	}
}

func TestPgAuthRepository_FindByUserCode_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery("SELECT (.+) FROM device_logins WHERE user_code").
		WithArgs("ABCD-EFGH").
		WillReturnRows(pgxmock.NewRows(deviceLoginColumns()).
			AddRow(int32(1), "device-code", "ABCD-EFGH", "pending", nil, nil, int32(5), ts, ts, nil, nil, nil))

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	record, err := repo.FindByUserCode(context.Background(), "ABCD-EFGH")
	require.NoError(t, err)
	require.NotNil(t, record)
	assert.Equal(t, "ABCD-EFGH", record.UserCode)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuthRepository_FindByUserCode_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	mock.ExpectQuery("SELECT (.+) FROM device_logins WHERE user_code").
		WithArgs("MISSING-CODE").
		WillReturnError(pgx.ErrNoRows)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	record, err := repo.FindByUserCode(context.Background(), "MISSING-CODE")
	require.ErrorIs(t, err, auth.ErrDeviceLoginNotFound)
	assert.Nil(t, record)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuthRepository_FindByUserCode_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	mock.ExpectQuery("SELECT (.+) FROM device_logins WHERE user_code").
		WithArgs("ABCD-EFGH").
		WillReturnError(errors.New("db down"))

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	_, err := repo.FindByUserCode(context.Background(), "ABCD-EFGH")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to get device login by user code")
}

func TestPgAuthRepository_FindByDeviceCode_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery("SELECT (.+) FROM device_logins WHERE device_code").
		WithArgs("device-code-hex").
		WillReturnRows(pgxmock.NewRows(deviceLoginColumns()).
			AddRow(int32(2), "device-code-hex", "WXYZ-1234", "pending", nil, nil, int32(5), ts, ts, nil, nil, nil))

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	record, err := repo.FindByDeviceCode(context.Background(), "device-code-hex")
	require.NoError(t, err)
	require.NotNil(t, record)
	assert.Equal(t, "device-code-hex", record.DeviceCode)
}

func TestPgAuthRepository_FindByDeviceCode_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	mock.ExpectQuery("SELECT (.+) FROM device_logins WHERE device_code").
		WithArgs("missing").
		WillReturnError(pgx.ErrNoRows)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	record, err := repo.FindByDeviceCode(context.Background(), "missing")
	require.ErrorIs(t, err, auth.ErrDeviceLoginNotFound)
	assert.Nil(t, record)
}
