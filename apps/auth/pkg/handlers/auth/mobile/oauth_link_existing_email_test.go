package mobile

import (
	"context"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLinkOrCreateOAuthUser_ExistingEmailLinksAccount(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

	mockPool := dbtest.NewMockPool(t)
	q := db.New(mockPool)

	accountColumns := []string{
		"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token",
		"expires_at", "token_type", "scope", "id_token", "session_state",
	}

	mockPool.ExpectBegin()
	mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("github", "acct-link").
		WillReturnError(pgx.ErrNoRows)
	mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email =").
		WithArgs("linked@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 3, Email: "linked@example.com", APITier: db.DeveloperApiTier("free"),
		}))
	mockPool.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(3), "oauth", "github", "acct-link", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(accountColumns).
			AddRow("acc-3", int32(3), "oauth", "github", "acct-link", nil, nil, nil, nil, nil, nil, nil))
	mockPool.ExpectCommit()

	user, err := linkOrCreateOAuthUser(context.Background(), q, oauthLinkInput{
		Provider:          "github",
		ProviderAccountID: "acct-link",
		Email:             "linked@example.com",
	})
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, 3, user.ID)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}
