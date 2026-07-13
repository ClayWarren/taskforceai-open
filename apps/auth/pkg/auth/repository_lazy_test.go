package auth_test

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLazyAuthRepository_FindByEmail(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("Failed to create mock: %v", err)
	}
	defer mock.Close()

	queries := db.New(mock)

	// Success case
	getQueriesSuccess := func(ctx context.Context) (*db.Queries, error) {
		return queries, nil
	}
	repo := auth.NewLazyAuthUserRepository(getQueriesSuccess)

	email := "lazy@example.com"
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email = \\$1").
		WithArgs(email).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 1, Email: email, APITier: "STARTER", APIRequestsLimit: 100,
		}))

	user, err := repo.FindByEmail(context.Background(), email)
	require.NoError(t, err)
	assert.NotNil(t, user)
	assert.Equal(t, email, user.Email)

	// Error case - resolver fails
	getQueriesError := func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("resolver error")
	}
	repoErr := auth.NewLazyAuthUserRepository(getQueriesError)
	_, err = repoErr.FindByEmail(context.Background(), email)
	require.Error(t, err)
	assert.Equal(t, "resolver error", err.Error())
}

func TestLazyAuthRepository_FindByID(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("Failed to create mock: %v", err)
	}
	defer mock.Close()

	queries := db.New(mock)
	getQueries := func(ctx context.Context) (*db.Queries, error) {
		return queries, nil
	}
	repo := auth.NewLazyAuthUserRepository(getQueries)

	userID := 123
	mock.ExpectQuery("SELECT (.+) FROM users WHERE id = \\$1").
		WithArgs(int32(userID)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: int32(userID), Email: "id@example.com", APITier: "STARTER", APIRequestsLimit: 100,
		}))

	user, err := repo.FindByID(context.Background(), userID)
	require.NoError(t, err)
	assert.NotNil(t, user)
	assert.Equal(t, userID, user.ID)

	// Error case - resolver fails
	getQueriesError := func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("resolver error")
	}
	repoErr := auth.NewLazyAuthUserRepository(getQueriesError)
	_, err = repoErr.FindByID(context.Background(), userID)
	assert.Error(t, err)
}
