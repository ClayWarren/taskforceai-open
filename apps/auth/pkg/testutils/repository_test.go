package testutils

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/auth-service/pkg/auth"
)

func TestMockRepository_FindLoginByEmail(t *testing.T) {
	repo := &MockRepository{
		FindByEmailUser: &auth.AuthUser{ID: 1, Email: "user@example.com"},
	}
	rec, err := repo.FindLoginByEmail(context.Background(), "user@example.com")
	require.NoError(t, err)
	if assert.NotNil(t, rec) {
		assert.Equal(t, 1, rec.ID)
		assert.Equal(t, "user@example.com", rec.Email)
	}
}

func TestMockRepository_RecordDeviceLoginPoll(t *testing.T) {
	repo := &MockRepository{PollDenied: true, PollErr: assert.AnError}
	allowed, err := repo.RecordDeviceLoginPoll(context.Background(), 1, time.Now())
	assert.False(t, allowed)
	assert.ErrorIs(t, err, assert.AnError)
}
