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

func TestPgAuthRepository_CreateAccount_Success(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

	mock := dbtest.NewMockPool(t)

	repo := auth.NewAccountRepository(db.New(mock))
	accessToken := "access-token"
	refreshToken := "refresh-token"

	accountColumns := []string{
		"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token",
		"expires_at", "token_type", "scope", "id_token", "session_state",
	}
	mock.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(1), "oauth", "github", "acct-1", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(accountColumns).
			AddRow("acc-id-1", int32(1), "oauth", "github", "acct-1", nil, nil, nil, nil, nil, nil, nil))

	acc, err := repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID:            1,
		Type:              "oauth",
		Provider:          "github",
		ProviderAccountID: "acct-1",
		AccessToken:       &accessToken,
		RefreshToken:      &refreshToken,
	})
	require.NoError(t, err)
	require.NotNil(t, acc)
	assert.Equal(t, "acc-id-1", acc.ID)
	assert.NoError(t, mock.ExpectationsWereMet())
}
