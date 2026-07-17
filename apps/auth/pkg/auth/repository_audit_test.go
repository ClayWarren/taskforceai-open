package auth_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPgAuthUserRepository_FindByID_More(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAuthUserRepository(queries)

	mock.ExpectQuery("SELECT (.+) FROM users WHERE id =").WithArgs(int32(1)).WillReturnError(errors.New("fail"))
	_, _ = repo.FindByID(context.Background(), 1)
}

func TestPgLoginRepository_FindByEmail_More(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAuthUserRepository(queries).(auth.LoginRepository)

	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").WithArgs("test@example.com").WillReturnError(errors.New("fail"))
	_, _ = repo.FindLoginByEmail(context.Background(), "test@example.com")
}

func TestPgDeviceLoginRepository_Various(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewDeviceLoginRepository(queries)

	// FindActiveLoginByCodes Error
	mock.ExpectQuery("SELECT (.+) FROM device_logins").WillReturnError(errors.New("fail"))
	_, _ = repo.FindActiveLoginByCodes(context.Background(), "a", "b")

	// FindByUserCode Error
	mock.ExpectQuery("SELECT (.+) FROM device_logins").WillReturnError(errors.New("fail"))
	_, _ = repo.FindByUserCode(context.Background(), "a")

	// FindByDeviceCode Success/Error
	mock.ExpectQuery("SELECT (.+) FROM device_logins").WillReturnError(errors.New("fail"))
	_, _ = repo.FindByDeviceCode(context.Background(), "a")

	// FindUserByID Error
	mock.ExpectQuery("SELECT (.+) FROM users").WillReturnError(errors.New("fail"))
	_, _ = repo.FindUserByID(context.Background(), 1)
}

func TestPgDeviceLoginRepository_SuccessPaths(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewDeviceLoginRepository(queries)
	now := time.Now()
	deviceColumns := []string{"id", "device_code", "user_code", "status", "user_id", "organization_id", "poll_interval", "created_at", "expires_at", "authorized_at", "completed_at", "last_polled_at"}
	row := func() *pgxmock.Rows {
		return pgxmock.NewRows(deviceColumns).AddRow(
			int32(1),
			"device",
			"USER-CODE",
			db.DeviceLoginsStatusPENDING,
			nil,
			nil,
			int32(5),
			pgtype.Timestamp{Time: now, Valid: true},
			pgtype.Timestamp{Time: now.Add(time.Minute), Valid: true},
			pgtype.Timestamp{},
			pgtype.Timestamp{},
			pgtype.Timestamp{},
		)
	}

	mock.ExpectQuery("INSERT INTO device_logins").
		WithArgs("device", "USER-CODE", int32(5), pgxmock.AnyArg()).
		WillReturnRows(row())
	created, err := repo.CreateLogin(context.Background(), auth.DeviceLoginCreateInput{
		DeviceCode:   "device",
		UserCode:     "USER-CODE",
		ExpiresAt:    now.Add(time.Minute),
		PollInterval: 5,
	})
	require.NoError(t, err)
	assert.Equal(t, "device", created.DeviceCode)

	mock.ExpectQuery("SELECT (.+) FROM device_logins").
		WithArgs("device", "USER-CODE").
		WillReturnRows(row())
	active, err := repo.FindActiveLoginByCodes(context.Background(), "device", "USER-CODE")
	require.NoError(t, err)
	assert.Equal(t, "USER-CODE", active.UserCode)

	mock.ExpectQuery("SELECT (.+) FROM device_logins").
		WithArgs("USER-CODE").
		WillReturnRows(row())
	byUserCode, err := repo.FindByUserCode(context.Background(), "USER-CODE")
	require.NoError(t, err)
	assert.Equal(t, "device", byUserCode.DeviceCode)

	mock.ExpectQuery("SELECT (.+) FROM device_logins").
		WithArgs("device").
		WillReturnRows(row())
	byDeviceCode, err := repo.FindByDeviceCode(context.Background(), "device")
	require.NoError(t, err)
	assert.Equal(t, "USER-CODE", byDeviceCode.UserCode)

	assert.NoError(t, mock.ExpectationsWereMet())
}
