package auth_test

import (
	"context"
	"math"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPgAuthRepository_CreateLogin_Errors(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewDeviceLoginRepository(queries)

	// Test poll interval overflow
	_, err := repo.CreateLogin(context.Background(), auth.DeviceLoginCreateInput{
		PollInterval: math.MaxInt32 + 1,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "poll_interval exceeds int32 range")
}

func TestPgAuthRepository_CreateAccount_Errors(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "invalid") // too short
	_, err := auth.NewAccountRepository(nil).CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID:       1,
		RefreshToken: new("secret"),
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "encryption key")
}

func TestPgAuthRepository_UpdateLogin_IDOverflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewDeviceLoginRepository(queries)

	err := repo.UpdateLogin(context.Background(), math.MaxInt32+1, auth.DeviceLoginUpdate{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "id exceeds int32 range")
}

func TestPgAuthRepository_MarkDeviceLoginAsCompleted_IDOverflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewDeviceLoginRepository(queries)

	_, err := repo.MarkDeviceLoginAsCompleted(context.Background(), math.MaxInt32+1)
	assert.Error(t, err)
}

func TestPgAuthRepository_FindUserByID_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewDeviceLoginRepository(queries)

	_, err := repo.FindUserByID(context.Background(), math.MaxInt32+1)
	assert.Error(t, err)
}

func TestPgAuthRepository_FindByID_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAuthUserRepository(queries)

	_, err := repo.FindByID(context.Background(), math.MaxInt32+1)
	assert.Error(t, err)
}
