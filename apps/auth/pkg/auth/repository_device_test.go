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

func TestPgDeviceLoginRepository_CreateLogin_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	expires := time.Now().Add(15 * time.Minute)

	mock.ExpectQuery("INSERT INTO device_logins").
		WithArgs("device-code", "user-code", int32(5), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "device_code", "user_code", "status", "user_id", "organization_id", "poll_interval", "expires_at",
			"authorized_at", "completed_at", "last_polled_at", "created_at",
		}).AddRow(
			int32(1), "device-code", "user-code", "pending", nil, nil, int32(5),
			pgtype.Timestamp{Time: expires, Valid: true},
			pgtype.Timestamp{}, pgtype.Timestamp{}, pgtype.Timestamp{}, pgtype.Timestamp{Time: time.Now(), Valid: true},
		))

	record, err := repo.CreateLogin(context.Background(), auth.DeviceLoginCreateInput{
		DeviceCode:   "device-code",
		UserCode:     "user-code",
		PollInterval: 5,
		ExpiresAt:    expires,
	})
	require.NoError(t, err)
	require.NotNil(t, record)
	assert.Equal(t, "device-code", record.DeviceCode)
}

func TestPgDeviceLoginRepository_CreateLogin_PollIntervalOverflow(t *testing.T) {
	repo := auth.NewDeviceLoginRepository(db.New(nil))
	_, err := repo.CreateLogin(context.Background(), auth.DeviceLoginCreateInput{
		PollInterval: math.MaxInt32 + 1,
	})
	assert.Error(t, err)
}

func TestPgDeviceLoginRepository_RecordDeviceLoginPoll(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := auth.NewDeviceLoginRepository(db.New(mock))

	mock.ExpectExec("UPDATE device_logins").
		WithArgs(int32(3), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	allowed, err := repo.RecordDeviceLoginPoll(context.Background(), 3, time.Now())
	require.NoError(t, err)
	assert.True(t, allowed)
}

func TestPgDeviceLoginRepository_RecordDeviceLoginPollTooSoon(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := auth.NewDeviceLoginRepository(db.New(mock))

	mock.ExpectExec("UPDATE device_logins").
		WithArgs(int32(3), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	allowed, err := repo.RecordDeviceLoginPoll(context.Background(), 3, time.Now())
	require.NoError(t, err)
	assert.False(t, allowed)
}

func TestPgDeviceLoginRepository_RecordDeviceLoginPollErrors(t *testing.T) {
	repo := auth.NewDeviceLoginRepository(db.New(nil))
	_, err := repo.RecordDeviceLoginPoll(context.Background(), math.MaxInt32+1, time.Now())
	require.Error(t, err)

	mock := dbtest.NewMockPool(t)
	repo = auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectExec("UPDATE device_logins").
		WithArgs(int32(3), pgxmock.AnyArg()).
		WillReturnError(errors.New("poll failed"))
	_, err = repo.RecordDeviceLoginPoll(context.Background(), 3, time.Now())
	assert.ErrorContains(t, err, "failed to record login poll")
}

func TestPgDeviceLoginRepository_MarkDeviceLoginAsCompleted(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectExec("UPDATE device_logins").
		WithArgs(int32(3), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	ok, err := repo.MarkDeviceLoginAsCompleted(context.Background(), 3)
	require.NoError(t, err)
	assert.True(t, ok)
}

func TestPgDeviceLoginRepository_FindUserByID_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(7)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 7, Email: "user@example.com", Disabled: true, APITier: "STARTER", APIRequestsLimit: 100,
		}))
	user, err := repo.FindUserByID(context.Background(), 7)
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, 7, user.ID)
	assert.True(t, user.Disabled)
}

func TestPgDeviceLoginRepository_FindUserByID_WithMembership(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(7)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 7, Email: "user@example.com", APITier: "STARTER", APIRequestsLimit: 100,
		}))
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(11), int32(7)).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "organization_id", "user_id", "role", "created_at", "updated_at",
		}).AddRow(int32(3), int32(11), int32(7), db.OrganizationRoleMEMBER, ts, ts))

	workosID := "org_workos"
	mock.ExpectQuery("SELECT (.+) FROM organizations WHERE id").
		WithArgs(int32(11)).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "name", "slug", "domain", "created_at", "updated_at", "plan",
			"subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings",
		}).AddRow(int32(11), "Enterprise", "enterprise", nil, ts, ts, "enterprise", nil, nil, nil, &workosID, false, []byte("{}")))

	user, err := repo.(auth.DeviceLoginOrganizationRepository).FindUserByIDForOrganization(context.Background(), 7, 11)
	require.NoError(t, err)
	require.NotNil(t, user)
	require.NotNil(t, user.InternalOrgID)
	assert.Equal(t, 11, *user.InternalOrgID)
	require.NotNil(t, user.OrgID)
	assert.Equal(t, workosID, *user.OrgID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgDeviceLoginRepository_FindUserByID_MembershipError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(7)).
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 7, Email: "user@example.com"}))
	mock.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(11), int32(7)).
		WillReturnError(errors.New("membership query failed"))

	_, err := repo.(auth.DeviceLoginOrganizationRepository).FindUserByIDForOrganization(context.Background(), 7, 11)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "membership")
}

func TestPgDeviceLoginRepository_FindUserByID_OrganizationError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(7)).
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 7, Email: "user@example.com"}))
	mock.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(11), int32(7)).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "organization_id", "user_id", "role", "created_at", "updated_at",
		}).AddRow(int32(3), int32(11), int32(7), db.OrganizationRoleMEMBER, ts, ts))
	mock.ExpectQuery("SELECT (.+) FROM organizations WHERE id").
		WithArgs(int32(11)).
		WillReturnError(errors.New("organization query failed"))

	_, err := repo.(auth.DeviceLoginOrganizationRepository).FindUserByIDForOrganization(context.Background(), 7, 11)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "organization")
}

func TestPgDeviceLoginRepository_FindUserByID_OrganizationNoRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(7)).
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 7, Email: "user@example.com"}))
	mock.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(11), int32(7)).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "organization_id", "user_id", "role", "created_at", "updated_at",
		}).AddRow(int32(3), int32(11), int32(7), db.OrganizationRoleMEMBER, ts, ts))
	mock.ExpectQuery("SELECT (.+) FROM organizations WHERE id").
		WithArgs(int32(11)).
		WillReturnError(pgx.ErrNoRows)

	// A missing organization is tolerated: the membership org id is still set.
	user, err := repo.(auth.DeviceLoginOrganizationRepository).FindUserByIDForOrganization(context.Background(), 7, 11)
	require.NoError(t, err)
	require.NotNil(t, user)
	require.NotNil(t, user.InternalOrgID)
	assert.Nil(t, user.OrgID)
}

func TestPgDeviceLoginRepository_FindUserByID_NoRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(8)).
		WillReturnError(pgx.ErrNoRows)

	user, err := repo.FindUserByID(context.Background(), 8)
	require.ErrorIs(t, err, auth.ErrUserNotFound)
	assert.Nil(t, user)
}

func TestPgDeviceLoginRepository_FindUserByID_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(9)).
		WillReturnError(errors.New("db down"))

	_, err := repo.FindUserByID(context.Background(), 9)
	assert.Error(t, err)
}
