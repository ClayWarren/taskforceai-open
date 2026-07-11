package auth_test

import (
	"context"
	"math"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPgAuthRepository_CreateAccount_ExpiresAtOverflow(t *testing.T) {
	repo := auth.NewAccountRepository(nil)
	overflow := math.MaxInt32 + 1
	_, err := repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID:            1,
		Provider:          "github",
		ProviderAccountID: "acct",
		ExpiresAt:         &overflow,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "expires_at exceeds int32 range")
}

func TestPgAuthRepository_CreateAccount_UserIDOverflow(t *testing.T) {
	repo := auth.NewAccountRepository(nil)
	_, err := repo.CreateAccount(context.Background(), auth.CreateAccountInput{
		UserID:            math.MaxInt32 + 1,
		Provider:          "github",
		ProviderAccountID: "acct",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "user_id exceeds int32 range")
}
