package handler

import (
	"context"
	"strings"
	"testing"

	"github.com/TaskForceAI/go-core/pkg/admin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAdminQueriesAdapterListsFilteredUsers(t *testing.T) {
	q, backing := newQueuedQueries()
	backing.rows = [][][]any{{userValues()}}

	users, err := (adminQueriesAdapter{Queries: q}).ListUsersForAdmin(
		context.Background(),
		admin.ListUsersForAdminInput{Search: "clay", PageLimit: 10},
	)

	require.NoError(t, err)
	require.Len(t, users, 1)
	assert.Equal(t, "clay@example.com", users[0].Email)
}

func TestFinanceTokenProtectorRoundTrip(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")
	value := "plaid-access-token"
	protector := financeTokenProtector{}

	encrypted, err := protector.Encrypt(&value)
	require.NoError(t, err)
	require.NotNil(t, encrypted)
	assert.NotEqual(t, value, *encrypted)

	decrypted, err := protector.Decrypt(encrypted)
	require.NoError(t, err)
	require.NotNil(t, decrypted)
	assert.Equal(t, value, *decrypted)
}
