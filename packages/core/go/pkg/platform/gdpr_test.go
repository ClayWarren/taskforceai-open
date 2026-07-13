package platform

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type gdprStoreStub struct {
	getUserByEmailFunc         func(ctx context.Context, email string) (GdprUser, error)
	getConversationsByUserFunc func(ctx context.Context, input GetConversationsByUserInput) ([]GdprConversation, error)
	deleteUserFunc             func(ctx context.Context, userID int32) error
}

func (s gdprStoreStub) GetUserByEmail(ctx context.Context, email string) (GdprUser, error) {
	return s.getUserByEmailFunc(ctx, email)
}

func (s gdprStoreStub) GetConversationsByUser(ctx context.Context, input GetConversationsByUserInput) ([]GdprConversation, error) {
	return s.getConversationsByUserFunc(ctx, input)
}

func (s gdprStoreStub) DeleteUser(ctx context.Context, userID int32) error {
	return s.deleteUserFunc(ctx, userID)
}

func TestGdprService(t *testing.T) {
	email := "test@example.com"
	svc := NewGdprService(gdprStoreStub{
		getUserByEmailFunc: func(ctx context.Context, gotEmail string) (GdprUser, error) {
			require.Equal(t, email, gotEmail)
			return GdprUser{}, errors.New("db error")
		},
		getConversationsByUserFunc: func(ctx context.Context, input GetConversationsByUserInput) ([]GdprConversation, error) {
			require.Equal(t, "1", input.UserID)
			require.Equal(t, int32(1000), input.Limit)
			require.Equal(t, int32(0), input.Offset)
			return nil, errors.New("db error")
		},
		deleteUserFunc: func(ctx context.Context, userID int32) error {
			require.Equal(t, int32(1), userID)
			return nil
		},
	})

	// Test FindExportUserByEmail
	_, err := svc.FindExportUserByEmail(context.Background(), email)
	require.Error(t, err)

	// Test FindConversationsByEmail
	svc.store = gdprStoreStub{
		getUserByEmailFunc: func(ctx context.Context, gotEmail string) (GdprUser, error) {
			require.Equal(t, email, gotEmail)
			return GdprUser{ID: 1, Email: gotEmail}, nil
		},
		getConversationsByUserFunc: func(ctx context.Context, input GetConversationsByUserInput) ([]GdprConversation, error) {
			require.Equal(t, "1", input.UserID)
			require.Equal(t, int32(1000), input.Limit)
			require.Equal(t, int32(0), input.Offset)
			return nil, errors.New("db error")
		},
		deleteUserFunc: func(ctx context.Context, userID int32) error {
			return nil
		},
	}

	_, err = svc.FindConversationsByEmail(context.Background(), email)
	require.Error(t, err)

	// Test FindDeleteUserByEmail
	svc.store = gdprStoreStub{
		getUserByEmailFunc: func(ctx context.Context, gotEmail string) (GdprUser, error) {
			require.Equal(t, email, gotEmail)
			return GdprUser{}, errors.New("db error")
		},
		getConversationsByUserFunc: func(ctx context.Context, input GetConversationsByUserInput) ([]GdprConversation, error) {
			return nil, nil
		},
		deleteUserFunc: func(ctx context.Context, userID int32) error {
			return nil
		},
	}

	_, err = svc.FindDeleteUserByEmail(context.Background(), email)
	require.Error(t, err)

	// Test DeleteUserData
	err = svc.DeleteUserData(context.Background(), 1)
	assert.NoError(t, err)
}
