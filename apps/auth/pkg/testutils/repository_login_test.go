package testutils

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMockRepository_FindLoginByEmail_WithUser(t *testing.T) {
	repo := &MockRepository{
		FindByEmailUser: &auth.AuthUser{ID: 5, Email: "login@example.com", Disabled: true},
	}
	record, err := repo.FindLoginByEmail(context.Background(), "login@example.com")
	require.NoError(t, err)
	assert.Equal(t, 5, record.ID)
	assert.True(t, record.Disabled)
}

func TestMockRepository_FindLoginByEmail_Error(t *testing.T) {
	repo := &MockRepository{FindByEmailErr: errors.New("lookup failed")}
	_, err := repo.FindLoginByEmail(context.Background(), "login@example.com")
	assert.Error(t, err)
}
