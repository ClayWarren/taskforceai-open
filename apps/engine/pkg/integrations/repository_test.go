package integrations

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeQueries struct {
	getAccountsByUserID           func(ctx context.Context, userID int32) ([]accountRow, error)
	getActiveDeviceLoginsByUserID func(ctx context.Context, userID *int32) ([]deviceLoginRow, error)
	deleteAccount                 func(ctx context.Context, params deleteAccountInput) error
	deleteDeviceLoginByUserID     func(ctx context.Context, userID *int32) error
}

func newRepositoryWithStore(q Queries) *PgRepository {
	return &PgRepository{q: q}
}

func (f fakeQueries) GetAccountsByUserID(ctx context.Context, userID int32) ([]accountRow, error) {
	return f.getAccountsByUserID(ctx, userID)
}

func (f fakeQueries) GetActiveDeviceLoginsByUserID(ctx context.Context, userID *int32) ([]deviceLoginRow, error) {
	return f.getActiveDeviceLoginsByUserID(ctx, userID)
}

func (f fakeQueries) DeleteAccount(ctx context.Context, params deleteAccountInput) error {
	return f.deleteAccount(ctx, params)
}

func (f fakeQueries) DeleteDeviceLoginByUserID(ctx context.Context, userID *int32) error {
	return f.deleteDeviceLoginByUserID(ctx, userID)
}

func TestPgRepository_GetAccountsByUserID(t *testing.T) {
	repo := newRepositoryWithStore(fakeQueries{
		getAccountsByUserID: func(ctx context.Context, userID int32) ([]accountRow, error) {
			assert.Equal(t, int32(42), userID)
			return []accountRow{
				{ID: "acc-1", Provider: "google-drive"},
				{ID: "acc-2", Provider: "taskforce-cli"},
			}, nil
		},
	})

	accounts, err := repo.GetAccountsByUserID(context.Background(), 42)
	require.NoError(t, err)
	if assert.Len(t, accounts, 2) {
		assert.Equal(t, "acc-1", accounts[0].ID)
		assert.Equal(t, "google-drive", accounts[0].Provider)
		assert.Equal(t, "acc-2", accounts[1].ID)
		assert.Equal(t, "taskforce-cli", accounts[1].Provider)
	}
}

func TestPgRepository_GetAccountsByUserID_Error(t *testing.T) {
	repo := newRepositoryWithStore(fakeQueries{
		getAccountsByUserID: func(context.Context, int32) ([]accountRow, error) {
			return nil, errors.New("boom")
		},
	})

	accounts, err := repo.GetAccountsByUserID(context.Background(), 42)
	require.Error(t, err)
	assert.Nil(t, accounts)
}

func TestPgRepository_GetActiveDeviceLoginsByUserID(t *testing.T) {
	repo := newRepositoryWithStore(fakeQueries{
		getActiveDeviceLoginsByUserID: func(ctx context.Context, userID *int32) ([]deviceLoginRow, error) {
			if assert.NotNil(t, userID) {
				assert.Equal(t, int32(1), *userID)
			}
			return []deviceLoginRow{{ID: 7}, {ID: 12}}, nil
		},
	})

	devices, err := repo.GetActiveDeviceLoginsByUserID(context.Background(), 1)
	require.NoError(t, err)
	if assert.Len(t, devices, 2) {
		assert.Equal(t, "7", devices[0].ID)
		assert.Equal(t, "12", devices[1].ID)
	}
}

func TestPgRepository_GetActiveDeviceLoginsByUserID_Error(t *testing.T) {
	repo := newRepositoryWithStore(fakeQueries{
		getActiveDeviceLoginsByUserID: func(context.Context, *int32) ([]deviceLoginRow, error) {
			return nil, errors.New("boom")
		},
	})

	devices, err := repo.GetActiveDeviceLoginsByUserID(context.Background(), 1)
	require.Error(t, err)
	assert.Nil(t, devices)
}

func TestPgRepository_DeleteAccount(t *testing.T) {
	repo := newRepositoryWithStore(fakeQueries{
		deleteAccount: func(ctx context.Context, params deleteAccountInput) error {
			assert.Equal(t, deleteAccountInput{
				UserID:   9,
				Provider: "google-drive",
			}, params)
			return nil
		},
	})

	err := repo.DeleteAccount(context.Background(), 9, "google-drive")
	require.NoError(t, err)
}

func TestPgRepository_DeleteAccount_Error(t *testing.T) {
	repo := newRepositoryWithStore(fakeQueries{
		deleteAccount: func(context.Context, deleteAccountInput) error {
			return errors.New("boom")
		},
	})

	err := repo.DeleteAccount(context.Background(), 9, "google-drive")
	require.Error(t, err)
}

func TestPgRepository_DeleteDeviceLoginByUserID(t *testing.T) {
	repo := newRepositoryWithStore(fakeQueries{
		deleteDeviceLoginByUserID: func(ctx context.Context, userID *int32) error {
			if assert.NotNil(t, userID) {
				assert.Equal(t, int32(8), *userID)
			}
			return nil
		},
	})

	err := repo.DeleteDeviceLoginByUserID(context.Background(), 8)
	require.NoError(t, err)
}

func TestPgRepository_DeleteDeviceLoginByUserID_Error(t *testing.T) {
	repo := newRepositoryWithStore(fakeQueries{
		deleteDeviceLoginByUserID: func(context.Context, *int32) error {
			return errors.New("boom")
		},
	})

	err := repo.DeleteDeviceLoginByUserID(context.Background(), 8)
	require.Error(t, err)
}

func TestPgRepository_SQLCAdapter(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := NewRepository(db.New(mock))
	ctx := context.Background()

	accountRows := pgxmock.NewRows([]string{
		"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state",
	}).AddRow("acc-1", int32(42), "oauth", "google", "provider-id", nil, nil, nil, nil, nil, nil, nil)
	mock.ExpectQuery("GetAccountsByUserID").WithArgs(int32(42)).WillReturnRows(accountRows)
	accounts, err := repo.GetAccountsByUserID(ctx, 42)
	require.NoError(t, err)
	assert.Equal(t, []Account{{ID: "acc-1", Provider: "google"}}, accounts)

	now := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
	userID := int32(42)
	deviceRows := pgxmock.NewRows([]string{
		"id", "device_code", "user_code", "status", "user_id", "organization_id", "poll_interval", "created_at", "expires_at", "authorized_at", "completed_at", "last_polled_at",
	}).AddRow(int32(9), "device", "user", db.DeviceLoginsStatusCOMPLETED, &userID, nil, int32(5), now, now, now, now, now)
	mock.ExpectQuery("GetActiveDeviceLoginsByUserID").WithArgs(pgxmock.AnyArg()).WillReturnRows(deviceRows)
	devices, err := repo.GetActiveDeviceLoginsByUserID(ctx, 42)
	require.NoError(t, err)
	assert.Equal(t, []DeviceLogin{{ID: "9"}}, devices)

	mock.ExpectExec("DeleteAccount").WithArgs(int32(42), "google").WillReturnResult(pgxmock.NewResult("DELETE", 1))
	require.NoError(t, repo.DeleteAccount(ctx, 42, "google"))

	mock.ExpectExec("DeleteDeviceLoginByUserID").WithArgs(pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("DELETE", 1))
	require.NoError(t, repo.DeleteDeviceLoginByUserID(ctx, 42))

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPgRepository_SQLCAdapterQueryErrors(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := NewRepository(db.New(mock))
	ctx := context.Background()

	mock.ExpectQuery("GetAccountsByUserID").WithArgs(int32(42)).WillReturnError(errors.New("accounts failed"))
	accounts, err := repo.GetAccountsByUserID(ctx, 42)
	require.EqualError(t, err, "accounts failed")
	assert.Nil(t, accounts)

	mock.ExpectQuery("GetActiveDeviceLoginsByUserID").WithArgs(pgxmock.AnyArg()).WillReturnError(errors.New("devices failed"))
	devices, err := repo.GetActiveDeviceLoginsByUserID(ctx, 42)
	require.EqualError(t, err, "devices failed")
	assert.Nil(t, devices)

	require.NoError(t, mock.ExpectationsWereMet())
}
