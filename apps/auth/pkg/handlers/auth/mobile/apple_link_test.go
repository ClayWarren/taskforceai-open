package mobile

import (
	"context"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLinkOrCreateAppleUser_NilClaims(t *testing.T) {
	_, err := linkOrCreateAppleUser(context.Background(), &db.Queries{}, nil, "fallback@example.com", "Name")
	assert.Error(t, err)
}

func TestLinkOrCreateAppleUser_DelegatesToOAuthLinker(t *testing.T) {
	_, err := linkOrCreateAppleUser(context.Background(), nil, &providers.AppleClaims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: "apple-sub"},
		Email:            "user@example.com",
		EmailVerified:    true,
	}, "", "User Name")
	assert.Error(t, err)
}

func TestSyntheticAppleEmail(t *testing.T) {
	email := syntheticAppleEmail(" apple-sub ")

	assert.Equal(t, syntheticAppleEmail("apple-sub"), email)
	assert.Contains(t, email, "@users.taskforceai.invalid")
	assert.Empty(t, syntheticAppleEmail("   "))
}

func TestLinkOrCreateAppleUser_UsesSyntheticEmailWhenAppleOmitsEmail(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

	mockPool := dbtest.NewMockPool(t)
	queries := db.New(mockPool)
	accountColumns := []string{"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state"}
	expectedEmail := syntheticAppleEmail("apple-reviewer-sub")

	mockPool.ExpectBegin()
	mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("apple", "apple-reviewer-sub").
		WillReturnError(pgx.ErrNoRows)
	mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs(expectedEmail).
		WillReturnError(pgx.ErrNoRows)
	mockPool.ExpectQuery("INSERT INTO users").
		WithArgs(expectedEmail, (*string)(nil), "free").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 4, Email: expectedEmail, APITier: "STARTER", APIRequestsLimit: 100,
		}))
	mockPool.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(4), "oauth", "apple", "apple-reviewer-sub", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(accountColumns).AddRow("acc-apple-review", int32(4), "oauth", "apple", "apple-reviewer-sub", nil, nil, nil, nil, nil, nil, nil))
	mockPool.ExpectCommit()

	user, err := linkOrCreateAppleUser(context.Background(), queries, &providers.AppleClaims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: "apple-reviewer-sub"},
	}, "", "")

	require.NoError(t, err)
	assert.Equal(t, expectedEmail, user.Email)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestLinkOrCreateAppleUser_UsesSyntheticEmailWhenAppleEmailUnverified(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

	mockPool := dbtest.NewMockPool(t)
	queries := db.New(mockPool)
	accountColumns := []string{"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state"}
	expectedEmail := syntheticAppleEmail("apple-unverified-sub")

	mockPool.ExpectBegin()
	mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("apple", "apple-unverified-sub").
		WillReturnError(pgx.ErrNoRows)
	mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs(expectedEmail).
		WillReturnError(pgx.ErrNoRows)
	mockPool.ExpectQuery("INSERT INTO users").
		WithArgs(expectedEmail, (*string)(nil), "free").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 5, Email: expectedEmail, APITier: "STARTER", APIRequestsLimit: 100,
		}))
	mockPool.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(5), "oauth", "apple", "apple-unverified-sub", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(accountColumns).AddRow("acc-apple-unverified", int32(5), "oauth", "apple", "apple-unverified-sub", nil, nil, nil, nil, nil, nil, nil))
	mockPool.ExpectCommit()

	user, err := linkOrCreateAppleUser(context.Background(), queries, &providers.AppleClaims{
		RegisteredClaims: jwt.RegisteredClaims{Subject: "apple-unverified-sub"},
		Email:            "unverified@example.com",
		EmailVerified:    false,
	}, "", "")

	require.NoError(t, err)
	assert.Equal(t, expectedEmail, user.Email)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}
