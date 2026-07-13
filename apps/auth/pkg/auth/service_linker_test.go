package auth_test

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

func TestLinkerService_LinkOrCreateWorkOSUser_FindByEmailError(t *testing.T) {
	repo := &testutils.MockRepository{
		GetAccountRecord: nil,
		FindByEmailErr:   errors.New("lookup failed"),
	}
	service := auth.NewLinkerService(repo, repo, repo)

	_, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_lookup",
		Email: "lookup@example.com",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to find user by email")
}

func TestLinkerService_LinkOrCreateWorkOSUser_CreateAccountError(t *testing.T) {
	repo := &testutils.MockRepository{
		GetAccountRecord: nil,
		FindByEmailUser:  &auth.AuthUser{ID: 10, Email: "link@example.com"},
		CreateAccountErr: errors.New("account create failed"),
	}
	service := auth.NewLinkerService(repo, repo, repo)

	_, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_link",
		Email: "link@example.com",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create account link")
}

func TestLinkerService_LinkOrCreateWorkOSUser_WithFullName(t *testing.T) {
	name := "Work OS"
	repo := &testutils.MockRepository{
		GetAccountRecord: nil,
		FindByEmailUser:  nil,
		CreateUserRecord: &auth.RegisterUserRecord{
			ID:       11,
			Email:    "name@example.com",
			FullName: &name,
		},
		CreateAccountRecord: &auth.AccountRecord{ID: "acc_11"},
	}
	service := auth.NewLinkerService(repo, repo, repo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:        "workos_name",
		Email:     "name@example.com",
		FirstName: "Work",
		LastName:  "OS",
	})
	require.NoError(t, err)
	assert.Equal(t, 11, user.ID)
}

func TestLinkerService_LinkOrCreateWorkOSUser_ExplicitNotFound(t *testing.T) {
	repo := &testutils.MockRepository{
		GetUserByAccountErr: auth.ErrUserNotFound,
		FindByEmailErr:      auth.ErrUserNotFound,
		CreateUserRecord: &auth.RegisterUserRecord{
			ID:    12,
			Email: "new@example.com",
		},
		CreateAccountRecord: &auth.AccountRecord{ID: "acc_12"},
	}
	service := auth.NewLinkerService(repo, repo, repo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_new",
		Email: "new@example.com",
	})
	require.NoError(t, err)
	assert.Equal(t, 12, user.ID)
}
