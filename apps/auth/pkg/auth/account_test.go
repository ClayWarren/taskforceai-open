package auth_test

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	sharedcrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

func TestPgAccountRepository_GetAccountByProvider(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAccountRepository(queries)

	provider := "workos"
	providerID := "123"

	columns := []string{"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state"}

	// Success
	mock.ExpectQuery("SELECT (.+) FROM accounts").
		WithArgs(provider, providerID).
		WillReturnRows(pgxmock.NewRows(columns).
			AddRow("acc_1", int32(1), "oauth", provider, providerID, nil, nil, nil, nil, nil, nil, nil))

	acc, err := repo.GetAccountByProvider(context.Background(), provider, providerID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if acc.ID != "acc_1" {
		t.Errorf("expected acc_1, got %s", acc.ID)
	}

	// No rows
	mock.ExpectQuery("SELECT (.+) FROM accounts").
		WithArgs(provider, "missing").
		WillReturnError(pgx.ErrNoRows)

	acc, err = repo.GetAccountByProvider(context.Background(), provider, "missing")
	if !errors.Is(err, auth.ErrAccountNotFound) {
		t.Errorf("expected ErrAccountNotFound, got %v", err)
	}
	if acc != nil {
		t.Error("expected nil account")
	}
}

func TestPgAccountRepository_GetAccountByProvider_DecryptsTokens(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("b", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAccountRepository(queries)

	provider := "google-drive"
	providerID := "123"
	rawAccess := "access-secret"
	rawRefresh := "refresh-secret"
	rawIDToken := "id-secret"
	encAccess, err := sharedcrypto.Encrypt(rawAccess)
	if err != nil {
		t.Fatalf("failed to encrypt access token: %v", err)
	}
	encRefresh, err := sharedcrypto.Encrypt(rawRefresh)
	if err != nil {
		t.Fatalf("failed to encrypt refresh token: %v", err)
	}
	encID, err := sharedcrypto.Encrypt(rawIDToken)
	if err != nil {
		t.Fatalf("failed to encrypt id token: %v", err)
	}

	columns := []string{"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state"}

	mock.ExpectQuery("SELECT (.+) FROM accounts").
		WithArgs(provider, providerID).
		WillReturnRows(pgxmock.NewRows(columns).
			AddRow("acc_1", int32(1), "oauth", provider, providerID, &encRefresh, &encAccess, nil, nil, nil, &encID, nil))

	acc, err := repo.GetAccountByProvider(context.Background(), provider, providerID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if acc.AccessToken == nil || *acc.AccessToken != rawAccess {
		t.Fatalf("expected decrypted access token, got %#v", acc.AccessToken)
	}
	if acc.RefreshToken == nil || *acc.RefreshToken != rawRefresh {
		t.Fatalf("expected decrypted refresh token, got %#v", acc.RefreshToken)
	}
	if acc.IDToken == nil || *acc.IDToken != rawIDToken {
		t.Fatalf("expected decrypted id token, got %#v", acc.IDToken)
	}
}

func TestPgAccountRepository_CreateAccount_Overflow(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAccountRepository(queries)

	// UserID overflow
	_, err := repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID: math.MaxInt32 + 1,
	})
	if err == nil || err.Error() != "user_id exceeds int32 range" {
		t.Errorf("expected userid overflow error, got %v", err)
	}

	// ExpiresAt overflow
	expiresAt := math.MaxInt32 + 1
	_, err = repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID:    1,
		ExpiresAt: &expiresAt,
	})
	if err == nil || err.Error() != "expires_at exceeds int32 range" {
		t.Errorf("expected expiresat overflow error, got %v", err)
	}
}

func TestPgAccountRepository_CreateAccount_StrictEncryptionRequired(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	t.Setenv("ENCRYPTION_KEY", "")
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "")

	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAccountRepository(queries)

	accessToken := "access-token"
	_, err := repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID:            1,
		Type:              "oauth",
		Provider:          "github",
		ProviderAccountID: "acct",
		AccessToken:       &accessToken,
	})
	if err == nil {
		t.Fatal("expected strict encryption error")
	}
}

func TestPgAccountRepository_GetUserByAccount(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	queries := db.New(mock)
	repo := auth.NewAccountRepository(queries)

	// Success
	mock.ExpectQuery("(?s)SELECT (.+) FROM users").
		WithArgs("workos", "u123").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 1, Email: "test@example.com", APITier: "STARTER", APIRequestsLimit: 100,
		}))

	user, err := repo.GetUserByAccount(context.Background(), "workos", "u123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if user.Email != "test@example.com" {
		t.Errorf("expected email test@example.com, got %s", user.Email)
	}

	// No rows
	mock.ExpectQuery("(?s)SELECT (.+) FROM users").
		WithArgs("p", "missing").
		WillReturnError(pgx.ErrNoRows)

	user, err = repo.GetUserByAccount(context.Background(), "p", "missing")
	if !errors.Is(err, auth.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound, got %v", err)
	}
	if user != nil {
		t.Error("expected nil user")
	}

	// Error
	mock.ExpectQuery("(?s)SELECT (.+) FROM users").
		WithArgs("p", "err").
		WillReturnError(errors.New("db error"))

	_, err = repo.GetUserByAccount(context.Background(), "p", "err")
	if err == nil {
		t.Error("expected error")
	}
}
