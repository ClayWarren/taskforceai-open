package auth_test

import (
	"context"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPgAuthRepository_FindLoginByEmail_Success(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	mock.ExpectQuery("SELECT (.+) FROM users WHERE email").
		WithArgs("login@example.com").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 5, Email: "login@example.com", APITier: db.DeveloperApiTier("free"),
		}))

	repo := auth.NewAuthUserRepository(db.New(mock)).(auth.LoginRepository)
	user, err := repo.FindLoginByEmail(context.Background(), "login@example.com")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "login@example.com", user.Email)
}

func TestPgAuthRepository_FindLoginByEmail_NotFound(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	mock.ExpectQuery("SELECT (.+) FROM users WHERE email").
		WithArgs("missing@example.com").
		WillReturnError(pgx.ErrNoRows)

	repo := auth.NewAuthUserRepository(db.New(mock)).(auth.LoginRepository)
	user, err := repo.FindLoginByEmail(context.Background(), "missing@example.com")
	require.ErrorIs(t, err, auth.ErrUserNotFound)
	assert.Nil(t, user)
}
