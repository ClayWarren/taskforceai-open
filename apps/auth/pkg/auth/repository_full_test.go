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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPgRegisterRepository_CreateUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewRegisterRepository(queries)

	email := "new@example.com"
	name := "New User"
	mock.ExpectQuery("INSERT INTO users").WithArgs(email, &name, "free").WillReturnRows(dbtest.UserRow(dbtest.User{
		ID: 10, Email: email, FullName: &name, APITier: "STARTER", APIRequestsLimit: 100,
	}))
	_, _ = repo.CreateUser(context.Background(), auth.RegisterUserInput{Email: email, FullName: &name})

	// Error case
	mock.ExpectQuery("INSERT INTO users").WillReturnError(errors.New("fail"))
	_, err := repo.CreateUser(context.Background(), auth.RegisterUserInput{Email: email})
	if err == nil {
		t.Error("expected error")
	}
}

func TestPgDeviceLoginRepository_UpdateLogin(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewDeviceLoginRepository(queries)

	mock.ExpectExec("UPDATE device_logins").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	_ = repo.UpdateLogin(context.Background(), 1, auth.DeviceLoginUpdate{})

	// Error case
	mock.ExpectExec("UPDATE device_logins").WillReturnError(errors.New("fail"))
	err := repo.UpdateLogin(context.Background(), 1, auth.DeviceLoginUpdate{})
	if err == nil {
		t.Error("expected error")
	}
}

func TestPgDeviceLoginRepository_UpdateLogin_AuthorizeAtomic(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewDeviceLoginRepository(queries)

	status := auth.DeviceStatusAuthorized
	userID := 123
	now := time.Now()

	mock.ExpectExec("UPDATE device_logins").
		WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdateLogin(context.Background(), 1, auth.DeviceLoginUpdate{
		Status:       &status,
		UserID:       &userID,
		AuthorizedAt: &now,
	})
	assert.NoError(t, err)
}

func TestPgAuthRepository_CreateAccount_OnConflictNoRowsReturnsExistingAccount(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAccountRepository(queries)

	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

	input := auth.CreateAccountInput{
		UserID:            1,
		Type:              "oauth",
		Provider:          "github",
		ProviderAccountID: "acc-1",
	}

	// ON CONFLICT DO NOTHING RETURNING reports no rows without aborting the transaction.
	mock.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(1), "oauth", "github", "acc-1", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(pgx.ErrNoRows)

	// 2. Simulate subsequent successful fetch
	accountColumns := []string{"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state"}
	mock.ExpectQuery("SELECT (.+) FROM accounts WHERE provider = \\$1").
		WithArgs("github", "acc-1").
		WillReturnRows(pgxmock.NewRows(accountColumns).
			AddRow("acc-id-1", int32(1), "oauth", "github", "acc-1", nil, nil, nil, nil, nil, nil, nil))

	acc, err := repo.CreateAccount(context.Background(), input)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if acc.ID != "acc-id-1" {
		t.Errorf("Expected acc-id-1, got %s", acc.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unmet expectations: %v", err)
	}
}

func TestPgAuthRepository_CreateAccount_UniqueViolationDifferentOwner(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAccountRepository(queries)

	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

	input := auth.CreateAccountInput{
		UserID:            2,
		Type:              "oauth",
		Provider:          "github",
		ProviderAccountID: "acc-1",
	}

	mock.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(2), "oauth", "github", "acc-1", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(&pgconn.PgError{Code: "23505"})

	accountColumns := []string{"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state"}
	mock.ExpectQuery("SELECT (.+) FROM accounts WHERE provider = \\$1").
		WithArgs("github", "acc-1").
		WillReturnRows(pgxmock.NewRows(accountColumns).
			AddRow("acc-id-1", int32(1), "oauth", "github", "acc-1", nil, nil, nil, nil, nil, nil, nil))

	acc, err := repo.CreateAccount(context.Background(), input)
	require.Error(t, err)
	assert.Nil(t, acc)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuthRepository_CreateUser_UniqueViolation(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewRegisterRepository(queries)

	email := "existing@example.com"
	input := auth.RegisterUserInput{Email: email}

	// 1. Simulate unique violation
	mock.ExpectQuery("INSERT INTO users").
		WithArgs(email, (*string)(nil), "free").
		WillReturnError(&pgconn.PgError{Code: "23505"})

	// 2. Simulate subsequent successful fetch
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email = \\$1").
		WithArgs(email).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 1, Email: email, APITier: "STARTER", APIRequestsLimit: 100,
		}))

	user, err := repo.CreateUser(context.Background(), input)
	require.NoError(t, err)
	assert.Equal(t, email, user.Email)
	assert.NoError(t, mock.ExpectationsWereMet())
}
