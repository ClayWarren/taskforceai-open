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

func TestPgAuthRepository_CreateAccount_WithIDTokenAndExpiresAt(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

	mock := dbtest.NewMockPool(t)

	repo := auth.NewAccountRepository(db.New(mock))
	expires := 1_700_000_000
	refresh := "refresh"
	access := "access"
	idToken := "id-token"
	tokenType := "Bearer"
	scope := "openid email"
	sessionState := "state-1"

	accountColumns := []string{
		"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token",
		"expires_at", "token_type", "scope", "id_token", "session_state",
	}
	mock.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(4), "oauth", "google", "google-sub", pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), &tokenType, &scope, pgxmock.AnyArg(), &sessionState).
		WillReturnRows(pgxmock.NewRows(accountColumns).
			AddRow("acc-4", int32(4), "oauth", "google", "google-sub", nil, nil, nil, &tokenType, &scope, nil, &sessionState))

	acc, err := repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID:            4,
		Type:              "oauth",
		Provider:          "google",
		ProviderAccountID: "google-sub",
		RefreshToken:      &refresh,
		AccessToken:       &access,
		IDToken:           &idToken,
		ExpiresAt:         &expires,
		TokenType:         &tokenType,
		Scope:             &scope,
		SessionState:      &sessionState,
	})
	require.NoError(t, err)
	require.NotNil(t, acc)
	assert.Equal(t, "acc-4", acc.ID)
	assert.NoError(t, mock.ExpectationsWereMet())
}
