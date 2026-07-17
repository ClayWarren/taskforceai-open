package auth_test

import (
	"context"
	"errors"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"math"
	"testing"
	"time"
)

func deviceLoginRow(now time.Time) *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "device_code", "user_code", "status", "user_id", "organization_id", "poll_interval", "expires_at",
		"authorized_at", "completed_at", "last_polled_at", "created_at",
	}).AddRow(
		int32(1), "device", "USER-CODE", "PENDING", nil, nil, int32(5),
		pgtype.Timestamp{Time: now.Add(time.Hour), Valid: true},
		pgtype.Timestamp{}, pgtype.Timestamp{}, pgtype.Timestamp{}, pgtype.Timestamp{Time: now, Valid: true},
	)
}

func TestPgAuthRepository_CreateAccount_ProviderIDTooLong(t *testing.T) {
	repo := auth.NewAccountRepository(nil)
	_, err := repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		ProviderAccountID: string(make([]byte, 256)),
	})
	assert.Error(t, err)
}

func TestPgAuthRepository_CreateAuditLog_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewAuditLogRepository(db.New(mock))
	mock.ExpectQuery("INSERT INTO audit_logs").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), "LOGIN", "session", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), true, pgxmock.AnyArg()).
		WillReturnError(errors.New("insert failed"))

	err := repo.CreateAuditLog(context.Background(), auth.AuditLogWrite{
		Action:   "LOGIN",
		Resource: "session",
		Success:  true,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "insert failed")
}

func TestPgAuthRepository_CreateAuditLog_NilQueries(t *testing.T) {
	repo := auth.NewAuditLogRepository(nil)
	err := repo.CreateAuditLog(context.Background(), auth.AuditLogWrite{Action: "LOGIN"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not initialized")
}

func TestPgAuthRepository_CreateAuditLog_WithDetails(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewAuditLogRepository(db.New(mock))
	userID := "1"
	mock.ExpectQuery("INSERT INTO audit_logs").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), "LOGIN", "session", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), true, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "timestamp", "user_id", "organization_id", "action", "resource", "resource_id", "ip_address", "user_agent", "details", "success", "error_message"}).
			AddRow(int32(1), pgtype.Timestamp{Time: time.Now(), Valid: true}, &userID, nil, "LOGIN", "session", nil, nil, nil, []byte(`{"email":"user@example.com"}`), true, nil))

	err := repo.CreateAuditLog(context.Background(), auth.AuditLogWrite{
		UserID:   &userID,
		Action:   "LOGIN",
		Resource: "session",
		Details:  map[string]any{"email": "user@example.com"},
		Success:  true,
	})
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuthRepository_CreateAuditLog_MarshalDetailsError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := auth.NewAuditLogRepository(db.New(mock))

	err := repo.CreateAuditLog(context.Background(), auth.AuditLogWrite{
		Action:   "LOGIN",
		Resource: "session",
		Details:  map[string]any{"opaque": func() {}},
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "marshal audit details")
}

func TestPgAuthRepository_CreateLogin_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectQuery("INSERT INTO device_logins").
		WillReturnError(errors.New("insert failed"))

	_, err := repo.CreateLogin(context.Background(), auth.DeviceLoginCreateInput{
		DeviceCode:   "d",
		UserCode:     "u",
		PollInterval: 5,
		ExpiresAt:    time.Now().Add(time.Minute),
	})
	assert.Error(t, err)
}

func TestPgAuthRepository_FindByEmail_NoRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewAuthUserRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs("none@example.com").
		WillReturnError(pgx.ErrNoRows)

	user, err := repo.FindByEmail(context.Background(), "none@example.com")
	require.ErrorIs(t, err, auth.ErrUserNotFound)
	assert.Nil(t, user)
}

func TestPgAuthRepository_FindByID_NoRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewAuthUserRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(99)).
		WillReturnError(pgx.ErrNoRows)

	user, err := repo.FindByID(context.Background(), 99)
	require.ErrorIs(t, err, auth.ErrUserNotFound)
	assert.Nil(t, user)
}

func TestPgAuthRepository_FindByID_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewAuthUserRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id").
		WithArgs(int32(4)).
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 4, Email: "user@example.com", APITier: "STARTER", APIRequestsLimit: 100}))

	user, err := repo.FindByID(context.Background(), 4)
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, 4, user.ID)
}

func TestPgAuthRepository_UpdateLogin_AuthorizeAtomicError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := auth.NewDeviceLoginRepository(db.New(mock))
	status := auth.DeviceStatusAuthorized
	userID := 123
	now := time.Now()
	mock.ExpectExec("UPDATE device_logins").
		WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errors.New("atomic update failed"))

	err := repo.UpdateLogin(context.Background(), 1, auth.DeviceLoginUpdate{
		Status:       &status,
		UserID:       &userID,
		AuthorizedAt: &now,
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "authorize device login")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuthRepository_FindLoginByEmail_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewAuthUserRepository(db.New(mock)).(auth.LoginRepository)
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email").
		WillReturnError(errors.New("db down"))

	_, err := repo.FindLoginByEmail(context.Background(), "user@example.com")
	assert.Error(t, err)
}

func TestPgAuthRepository_FindLoginByEmail_NoRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewAuthUserRepository(db.New(mock)).(auth.LoginRepository)
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs("none@example.com").
		WillReturnError(pgx.ErrNoRows)

	record, err := repo.FindLoginByEmail(context.Background(), "none@example.com")
	require.ErrorIs(t, err, auth.ErrUserNotFound)
	assert.Nil(t, record)
}

func TestPgAuthRepository_GetAccountByProvider_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewAccountRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM accounts WHERE provider").
		WithArgs("google", "broken").
		WillReturnError(errors.New("db down"))

	_, err := repo.GetAccountByProvider(context.Background(), "google", "broken")
	assert.Error(t, err)
}

func TestPgAuthRepository_GetAccountByProvider_NoRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewAccountRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM accounts WHERE provider =").
		WithArgs("github", "missing").
		WillReturnError(pgx.ErrNoRows)

	acc, err := repo.GetAccountByProvider(context.Background(), "github", "missing")
	require.ErrorIs(t, err, auth.ErrAccountNotFound)
	assert.Nil(t, acc)
}

func TestPgAuthRepository_GetUserByAccount(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewAccountRepository(db.New(mock))

	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs("github", "acct-1").
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 9, Email: "linked@example.com", APITier: "STARTER", APIRequestsLimit: 100}))

	user, err := repo.GetUserByAccount(context.Background(), "github", "acct-1")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, 9, user.ID)

	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs("github", "missing").
		WillReturnError(pgx.ErrNoRows)
	user, err = repo.GetUserByAccount(context.Background(), "github", "missing")
	require.ErrorIs(t, err, auth.ErrUserNotFound)
	assert.Nil(t, user)

	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs("github", "broken").
		WillReturnError(errors.New("db down"))
	_, err = repo.GetUserByAccount(context.Background(), "github", "broken")
	assert.Error(t, err)
}

func TestPgAuthRepository_CreateAccount_IDTokenEncryptionError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := auth.NewAccountRepository(db.New(mock))
	idToken := "id-token"
	t.Setenv("ENCRYPTION_KEY", "invalid")

	account, err := repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID:            1,
		Type:              "oauth",
		Provider:          "google",
		ProviderAccountID: "acct-1",
		IDToken:           &idToken,
	})

	assert.Nil(t, account)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "id token")
}

func TestPgAuthRepository_CreateAccount_GenericCreateError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := auth.NewAccountRepository(db.New(mock))
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

	mock.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(1), "oauth", "github", "acct-1", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errors.New("insert failed"))

	account, err := repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID:            1,
		Type:              "oauth",
		Provider:          "github",
		ProviderAccountID: "acct-1",
	})

	assert.Nil(t, account)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create account")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuthRepository_CreateAccount_UniqueViolationMissingExistingAccount(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	repo := auth.NewAccountRepository(db.New(mock))
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

	mock.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(1), "oauth", "github", "acct-1", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(&pgconn.PgError{Code: "23505"})
	mock.ExpectQuery("SELECT (.+) FROM accounts WHERE provider = \\$1").
		WithArgs("github", "acct-1").
		WillReturnError(pgx.ErrNoRows)

	account, err := repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID:            1,
		Type:              "oauth",
		Provider:          "github",
		ProviderAccountID: "acct-1",
	})

	assert.Nil(t, account)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create account")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPgAuthUserRepository_FindByEmail(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("Failed to create mock: %v", err)
	}
	defer mock.Close()

	queries := db.New(mock)
	repo := auth.NewAuthUserRepository(queries)

	email := "test@example.com"

	mock.ExpectQuery("SELECT (.+) FROM users WHERE email = \\$1").
		WithArgs(email).
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 1, Email: email, APITier: "STARTER", APIRequestsLimit: 100}))

	user, err := repo.FindByEmail(context.Background(), email)

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if user == nil {
		t.Fatal("Expected user, got nil")
	} else if user.Email != email {
		t.Errorf("Expected email %s, got %s", email, user.Email)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("Unmet expectations: %v", err)
	}
}

func TestPgAuthUserRepository_FindByEmail_Error(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAuthUserRepository(queries)

	mock.ExpectQuery("SELECT (.+) FROM users").
		WithArgs("error@example.com").
		WillReturnError(context.DeadlineExceeded)

	_, err := repo.FindByEmail(context.Background(), "error@example.com")
	if err == nil {
		t.Error("Expected error, got nil")
	}
}

func TestPgAuthUserRepository_FindByID_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAuthUserRepository(queries)

	_, err := repo.FindByID(context.Background(), math.MaxInt32+1)
	if err == nil || err.Error() != "id exceeds int32 range" {
		t.Errorf("Expected id overflow error, got %v", err)
	}
}

func TestPgDeviceLoginRepository_FindActiveLoginByCodes_NoRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM device_logins").
		WithArgs("device", "user").
		WillReturnError(pgx.ErrNoRows)

	record, err := repo.FindActiveLoginByCodes(context.Background(), "device", "user")
	require.ErrorIs(t, err, auth.ErrDeviceLoginNotFound)
	assert.Nil(t, record)
}

func TestPgDeviceLoginRepository_FindByDeviceCode_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	now := time.Now()
	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM device_logins").
		WithArgs("device-code").
		WillReturnRows(deviceLoginRow(now))

	record, err := repo.FindByDeviceCode(context.Background(), "device-code")
	require.NoError(t, err)
	require.NotNil(t, record)
}

func TestPgDeviceLoginRepository_FindByUserCode_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM device_logins").
		WillReturnError(errors.New("db down"))

	_, err := repo.FindByUserCode(context.Background(), "USER-CODE")
	assert.Error(t, err)
}

func TestPgDeviceLoginRepository_FindByUserCode_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	now := time.Now()
	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM device_logins").
		WithArgs("USER-CODE").
		WillReturnRows(deviceLoginRow(now))

	record, err := repo.FindByUserCode(context.Background(), "USER-CODE")
	require.NoError(t, err)
	require.NotNil(t, record)
	assert.Equal(t, "USER-CODE", record.UserCode)
}

func TestPgDeviceLoginRepository_MarkCompleted_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	mock.ExpectExec("UPDATE device_logins").
		WillReturnError(errors.New("update failed"))

	_, err := repo.MarkDeviceLoginAsCompleted(context.Background(), 1)
	assert.Error(t, err)
}

func TestPgDeviceLoginRepository_MarkCompleted_OverflowID(t *testing.T) {
	repo := auth.NewDeviceLoginRepository(db.New(nil))
	_, err := repo.MarkDeviceLoginAsCompleted(context.Background(), int(math.MaxInt32)+1)
	assert.Error(t, err)
}

func TestPgDeviceLoginRepository_Overflows(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewDeviceLoginRepository(queries)

	// CreateLogin overflow
	_, err := repo.CreateLogin(context.Background(), auth.DeviceLoginCreateInput{
		PollInterval: math.MaxInt32 + 1,
	})
	if err == nil || err.Error() != "poll_interval exceeds int32 range" {
		t.Errorf("Expected poll_interval overflow error, got %v", err)
	}

	// UpdateLogin overflow ID
	err = repo.UpdateLogin(context.Background(), math.MaxInt32+1, auth.DeviceLoginUpdate{})
	if err == nil || err.Error() != "id exceeds int32 range" {
		t.Errorf("Expected id overflow error, got %v", err)
	}

	// UpdateLogin overflow UserID
	userID := math.MaxInt32 + 1
	err = repo.UpdateLogin(context.Background(), 1, auth.DeviceLoginUpdate{UserID: &userID})
	if err == nil || err.Error() != "user_id exceeds int32 range" {
		t.Errorf("Expected user_id overflow error, got %v", err)
	}

	// FindUserByID overflow
	_, err = repo.FindUserByID(context.Background(), math.MaxInt32+1)
	if err == nil || err.Error() != "user_id exceeds int32 range" {
		t.Errorf("Expected user_id overflow error, got %v", err)
	}
}

func TestPgDeviceLoginRepository_UpdateLogin_AuthorizeAtomicNoRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewDeviceLoginRepository(db.New(mock))
	status := auth.DeviceStatusAuthorized
	userID := 42
	now := time.Now()

	mock.ExpectExec("UPDATE device_logins").
		WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	err := repo.UpdateLogin(context.Background(), 1, auth.DeviceLoginUpdate{
		Status:       &status,
		UserID:       &userID,
		AuthorizedAt: &now,
	})
	assert.ErrorIs(t, err, auth.ErrAlreadyUsed)
}

func TestPgDeviceLoginRepository_UpdateLogin_Full(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewDeviceLoginRepository(queries)

	status := auth.DeviceStatusCompleted
	userID := 123
	now := time.Now()

	mock.ExpectExec("UPDATE device_logins").
		WithArgs(
			int32(1),
			pgxmock.AnyArg(), // Status
			pgxmock.AnyArg(), // UserID
			pgxmock.AnyArg(), // AuthorizedAt
			pgxmock.AnyArg(), // CompletedAt
			pgxmock.AnyArg(), // LastPolledAt
		).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdateLogin(context.Background(), 1, auth.DeviceLoginUpdate{
		Status:       &status,
		UserID:       &userID,
		AuthorizedAt: &now,
		CompletedAt:  &now,
		LastPolledAt: &now,
	})

	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
}

func TestPgRegisterRepository_FindExistingUser(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewRegisterRepository(queries)

	email := "test@example.com"

	// Success
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs(email).
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 1, Email: email, APITier: "STARTER", APIRequestsLimit: 100}))

	res, err := repo.FindExistingUser(context.Background(), email)
	if err != nil || res == nil || res.Email != email {
		t.Errorf("Expected user, got %v, %v", res, err)
	}

	// Not found
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs("none@example.com").
		WillReturnError(pgx.ErrNoRows)

	res, err = repo.FindExistingUser(context.Background(), "none@example.com")
	if !errors.Is(err, auth.ErrUserNotFound) || res != nil {
		t.Errorf("Expected ErrUserNotFound for not found, got %v, %v", res, err)
	}

	// Real error
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs("error@example.com").
		WillReturnError(errors.New("db fail"))

	_, err = repo.FindExistingUser(context.Background(), "error@example.com")
	if err == nil {
		t.Error("Expected error")
	}
}

func TestPgRegisterRepository_FindExistingUser_DBError(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewRegisterRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email").
		WithArgs("fail@example.com").
		WillReturnError(errors.New("db down"))

	_, err := repo.FindExistingUser(context.Background(), "fail@example.com")
	assert.Error(t, err)
}

func TestPgRegisterRepository_FindExistingUser_Found(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewRegisterRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email").
		WithArgs("exists@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 1, Email: "exists@example.com", APITier: db.DeveloperApiTier("free")}))

	record, err := repo.FindExistingUser(context.Background(), "exists@example.com")
	require.NoError(t, err)
	require.NotNil(t, record)
	assert.Equal(t, "exists@example.com", record.Email)
}

func TestPgRegisterRepository_FindExistingUser_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	repo := auth.NewRegisterRepository(db.New(mock))
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email").
		WithArgs("none@example.com").
		WillReturnError(pgx.ErrNoRows)

	record, err := repo.FindExistingUser(context.Background(), "none@example.com")
	require.ErrorIs(t, err, auth.ErrUserNotFound)
	assert.Nil(t, record)
}
