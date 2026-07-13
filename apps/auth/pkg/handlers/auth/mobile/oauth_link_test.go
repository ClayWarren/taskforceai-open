package mobile

import (
	"context"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLinkOrCreateOAuthUser_NilQueries(t *testing.T) {
	input := oauthLinkInput{
		Provider:          "github",
		ProviderAccountID: "12345",
		Email:             "test@example.com",
		FullName:          "Test User",
	}

	result, err := linkOrCreateOAuthUser(context.Background(), nil, input)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "queries are required")
	assert.Nil(t, result)
}

func TestLinkOrCreateOAuthUser_MissingProviderAccountID(t *testing.T) {
	// Test that missing provider account ID returns error
	// Note: queries is nil so it returns queries error first
	input := oauthLinkInput{
		Provider:          "github",
		ProviderAccountID: "",
		Email:             "test@example.com",
		FullName:          "Test User",
	}

	result, err := linkOrCreateOAuthUser(context.Background(), nil, input)
	// nil queries returns error before checking providerAccountID
	require.Error(t, err)
	assert.Contains(t, err.Error(), "queries")
	assert.Nil(t, result)
}

func TestLinkOrCreateOAuthUser_Errors(t *testing.T) {
	mockPool := dbtest.NewMockPool(t)
	q := db.New(mockPool)

	// 1. Missing ProviderAccountID
	input := oauthLinkInput{Provider: "github", ProviderAccountID: ""}
	_, err := linkOrCreateOAuthUser(context.Background(), q, input)
	require.Error(t, err)
	assert.Equal(t, errOAuthSubjectRequired, err)

	// 2. Missing Provider
	input = oauthLinkInput{Provider: " ", ProviderAccountID: "acc-blank"}
	_, err = linkOrCreateOAuthUser(context.Background(), q, input)
	require.Error(t, err)
	assert.Equal(t, errOAuthProviderRequired, err)

	// 3. Disabled User from account lookup
	input.Provider = "github"
	input.ProviderAccountID = "acc-1"
	mockPool.ExpectBegin()
	mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("github", "acc-1").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 1, Email: "u@e.com", Disabled: true, APITier: "STARTER", APIRequestsLimit: 100,
		}))
	mockPool.ExpectRollback()

	_, err = linkOrCreateOAuthUser(context.Background(), q, input)
	require.Error(t, err)
	assert.Equal(t, auth.ErrUserDisabled, err)

	// 4. Missing email for new user
	mockPool.ExpectBegin()
	mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("github", "acc-2").
		WillReturnRows(pgxmock.NewRows(dbtest.UserColumns())) // Not found
	mockPool.ExpectRollback()

	input.ProviderAccountID = "acc-2"
	input.Email = ""
	_, err = linkOrCreateOAuthUser(context.Background(), q, input)
	require.Error(t, err)
	assert.Equal(t, errOAuthEmailRequired, err)
}

func TestLinkOrCreateOAuthUser_ExistingAccount(t *testing.T) {
	mockPool := dbtest.NewMockPool(t)
	q := db.New(mockPool)

	fullName := "Existing User"

	mockPool.ExpectBegin()
	mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("google", "sub-1").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 1, Email: "existing@example.com", FullName: &fullName, APITier: "STARTER", APIRequestsLimit: 100,
		}))
	mockPool.ExpectCommit()

	user, err := linkOrCreateOAuthUser(context.Background(), q, oauthLinkInput{
		Provider:          " google ",
		ProviderAccountID: " sub-1 ",
		Email:             " ignored@example.com ",
		FullName:          " Ignored ",
	})

	require.NoError(t, err)
	assert.Equal(t, 1, user.ID)
	assert.Equal(t, "existing@example.com", user.Email)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestLinkOrCreateOAuthUser_CreateNewUser(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")
	mockPool := dbtest.NewMockPool(t)
	q := db.New(mockPool)

	accountColumns := []string{"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state"}
	fullName := "New User"

	mockPool.ExpectBegin()
	mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("google", "sub-2").
		WillReturnError(pgx.ErrNoRows)
	mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs("new@example.com").
		WillReturnError(pgx.ErrNoRows)
	mockPool.ExpectQuery("INSERT INTO users").
		WithArgs("new@example.com", &fullName, "free").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 2, Email: "new@example.com", FullName: &fullName, APITier: "STARTER", APIRequestsLimit: 100,
		}))
	mockPool.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(2), "oauth", "google", "sub-2", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(accountColumns).AddRow("acc-2", int32(2), "oauth", "google", "sub-2", nil, nil, nil, nil, nil, nil, nil))
	mockPool.ExpectCommit()

	user, err := linkOrCreateOAuthUser(context.Background(), q, oauthLinkInput{
		Provider:          "google",
		ProviderAccountID: "sub-2",
		Email:             " new@example.com ",
		FullName:          " New User ",
	})

	require.NoError(t, err)
	assert.Equal(t, 2, user.ID)
	assert.Equal(t, "new@example.com", user.Email)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestOAuthLinkInput_Fields(t *testing.T) {
	input := oauthLinkInput{
		Provider:          "google",
		ProviderAccountID: "acc-123",
		Email:             "user@test.com",
		FullName:          "John Doe",
	}

	assert.Equal(t, "google", input.Provider)
	assert.Equal(t, "acc-123", input.ProviderAccountID)
	assert.Equal(t, "user@test.com", input.Email)
	assert.Equal(t, "John Doe", input.FullName)
}
