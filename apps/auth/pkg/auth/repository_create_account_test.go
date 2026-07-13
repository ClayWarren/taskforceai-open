package auth_test

import (
	"context"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var createAccountColumns = []string{
	"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token",
	"expires_at", "token_type", "scope", "id_token", "session_state",
}

func TestPgAuthRepository_CreateAccount(t *testing.T) {
	accessToken := "access-token"
	refreshToken := "refresh-token"
	expiresAt := 1_700_000_000
	idToken := "id-token"
	tokenType := "Bearer"
	scope := "openid email"
	sessionState := "state-1"

	tests := []struct {
		name       string
		input      auth.CreateAccountInput
		expectedID string
	}{
		{
			name: "success",
			input: auth.CreateAccountInput{
				UserID: 1, Type: "oauth", Provider: "github", ProviderAccountID: "acct-1",
				AccessToken: &accessToken, RefreshToken: &refreshToken,
			},
			expectedID: "acc-id-1",
		},
		{
			name: "ID token and expiry",
			input: auth.CreateAccountInput{
				UserID: 4, Type: "oauth", Provider: "google", ProviderAccountID: "google-sub",
				RefreshToken: &refreshToken, AccessToken: &accessToken, IDToken: &idToken, ExpiresAt: &expiresAt,
				TokenType: &tokenType, Scope: &scope, SessionState: &sessionState,
			},
			expectedID: "acc-4",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
			mock := dbtest.NewMockPool(t)
			mock.ExpectQuery("INSERT INTO accounts").WithArgs(createAccountArgs(test.input)...).
				WillReturnRows(pgxmock.NewRows(createAccountColumns).AddRow(createAccountRow(test.expectedID, test.input)...))

			account, err := auth.NewAccountRepository(db.New(mock)).CreateAccount(context.Background(), test.input)
			require.NoError(t, err)
			require.NotNil(t, account)
			assert.Equal(t, test.expectedID, account.ID)
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func createAccountArgs(input auth.CreateAccountInput) []any {
	var expiresAt any = (*int32)(nil)
	if input.ExpiresAt != nil {
		expiresAt = pgxmock.AnyArg()
	}
	return []any{
		pgxmock.AnyArg(), int32(input.UserID), input.Type, input.Provider, input.ProviderAccountID,
		pgxmock.AnyArg(), pgxmock.AnyArg(), expiresAt, input.TokenType, input.Scope, pgxmock.AnyArg(), input.SessionState,
	}
}

func createAccountRow(id string, input auth.CreateAccountInput) []any {
	return []any{
		id, int32(input.UserID), input.Type, input.Provider, input.ProviderAccountID,
		nil, nil, nil, input.TokenType, input.Scope, nil, input.SessionState,
	}
}
