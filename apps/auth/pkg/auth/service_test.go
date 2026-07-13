package auth_test

import (
	"context"
	"errors"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
	"strings"
	"testing"
)

type userRepoNoAudit struct{}

func (userRepoNoAudit) FindByEmail(context.Context, string) (*auth.AuthUser, error) {
	return nil, nil
}

func (userRepoNoAudit) FindByID(context.Context, int) (*auth.AuthUser, error) {
	return nil, errors.New("user not found")
}

func TestAuditService_DetachedAuditContext_NilParent(t *testing.T) {
	repo := &testutils.MockRepository{}
	service := auth.NewAuditService(repo)
	service.LogEvent(nilContext(), auth.AuditLogWrite{Action: "TEST", Resource: "user", Success: true})
}

func nilContext() context.Context {
	return nil
}

func TestAuditService_LogEvent_NilRepo(t *testing.T) {
	service := auth.NewAuditService(nil)
	service.LogEvent(context.Background(), auth.AuditLogWrite{Action: "TEST"})
}

func TestAuditService_LogEvent_WriteError(t *testing.T) {
	repo := &testutils.MockRepository{CreateAuditLogErr: errors.New("write failed")}
	service := auth.NewAuditService(repo)
	service.LogEvent(context.Background(), auth.AuditLogWrite{Action: "TEST"})
}

func TestLinkerService_CreateUserFromWorkOS_CreateError(t *testing.T) {
	mockRepo := &testutils.MockRepository{
		GetAccountRecord: nil,
		FindByEmailUser:  nil,
		CreateUserErr:    errors.New("create failed"),
	}
	service := auth.NewLinkerService(mockRepo, mockRepo, mockRepo)

	_, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_10",
		Email: "new@example.com",
	})
	assert.Error(t, err)
}

func TestLinkerService_LinkOrCreateWorkOSUser_InvalidEmail(t *testing.T) {
	mockRepo := &testutils.MockRepository{}
	service := auth.NewLinkerService(mockRepo, mockRepo, mockRepo)

	_, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_invalid",
		Email: " not-an-email ",
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid email")
}

func TestLinkerService_CreateUserFromWorkOS_Success(t *testing.T) {
	name := "New User"
	mockRepo := &testutils.MockRepository{
		GetAccountRecord: nil,
		FindByEmailUser:  nil,
		CreateUserRecord: &auth.RegisterUserRecord{
			ID:       10,
			Email:    "new@example.com",
			FullName: &name,
		},
		CreateAccountRecord: &auth.AccountRecord{ID: "acc_new"},
	}
	service := auth.NewLinkerService(mockRepo, mockRepo, mockRepo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:        "workos_10",
		Email:     "new@example.com",
		FirstName: "New",
		LastName:  "User",
	})
	require.NoError(t, err)
	assert.Equal(t, 10, user.ID)
}

func TestLinkerService_DBError(t *testing.T) {
	mockRepo := &testutils.MockRepository{
		GetUserByAccountErr: errors.New("db error"),
	}

	service := auth.NewLinkerService(mockRepo, mockRepo, mockRepo)

	_, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_123",
		Email: "db-error@example.com",
	})

	if err == nil {
		t.Fatal("Expected error, got nil")
	}
	if !strings.Contains(err.Error(), "db error") {
		t.Errorf("Expected error to contain 'db error', got %v", err)
	}
}

func TestLinkerService_LinkOrCreateWorkOSUser_DisabledExistingAccount(t *testing.T) {
	mockRepo := &testutils.MockRepository{
		GetUserByAccountUser: &auth.AuthUser{
			ID:       1,
			Email:    "disabled@example.com",
			Disabled: true,
		},
	}
	service := auth.NewLinkerService(mockRepo, mockRepo, mockRepo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_123",
		Email: "disabled@example.com",
	})

	if !errors.Is(err, auth.ErrUserDisabled) {
		t.Fatalf("expected ErrUserDisabled, got %v", err)
	}
	if user != nil {
		t.Fatalf("expected nil user, got %+v", user)
	}
}

func TestLinkerService_LinkOrCreateWorkOSUser_DisabledExistingEmail(t *testing.T) {
	mockRepo := &testutils.MockRepository{
		FindByEmailUser: &auth.AuthUser{
			ID:       2,
			Email:    "disabled@example.com",
			Disabled: true,
		},
	}
	service := auth.NewLinkerService(mockRepo, mockRepo, mockRepo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_456",
		Email: "disabled@example.com",
	})

	if !errors.Is(err, auth.ErrUserDisabled) {
		t.Fatalf("expected ErrUserDisabled, got %v", err)
	}
	if user != nil {
		t.Fatalf("expected nil user, got %+v", user)
	}
}

func TestLinkerService_LinkOrCreateWorkOSUser_ExistingAccount(t *testing.T) {
	mockRepo := &testutils.MockRepository{
		GetAccountRecord: &auth.AccountRecord{
			ID: "acc_123",
		},
		GetUserByAccountUser: &auth.AuthUser{
			ID:    1,
			Email: "test@example.com",
		},
	}

	service := auth.NewLinkerService(mockRepo, mockRepo, mockRepo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_123",
		Email: "test@example.com",
	})

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if user.ID != 1 {
		t.Errorf("Expected user ID 1, got %d", user.ID)
	}
}

func TestLinkerService_LinkOrCreateWorkOSUser_ExistingEmail(t *testing.T) {
	name := "Test User"
	mockRepo := &testutils.MockRepository{
		GetAccountRecord: nil, // Account doesn't exist
		FindByEmailUser: &auth.AuthUser{
			ID:       2,
			Email:    "test@example.com",
			FullName: &name,
		},
		CreateAccountRecord: &auth.AccountRecord{ID: "acc_new"},
	}

	service := auth.NewLinkerService(mockRepo, mockRepo, mockRepo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:        "workos_123",
		Email:     "test@example.com",
		FirstName: "Test",
		LastName:  "User",
	})

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if user.ID != 2 {
		t.Errorf("Expected user ID 2, got %d", user.ID)
	}
}

func TestLinkerService_LinkOrCreateWorkOSUser_NewUser(t *testing.T) {
	name := "New User"
	mockRepo := &testutils.MockRepository{
		GetAccountRecord: nil,
		FindByEmailUser:  nil, // User doesn't exist
		CreateUserRecord: &auth.RegisterUserRecord{
			ID:       3,
			Email:    "new@example.com",
			FullName: &name,
		},
		CreateAccountRecord: &auth.AccountRecord{ID: "acc_new"},
	}

	service := auth.NewLinkerService(mockRepo, mockRepo, mockRepo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:        "workos_new",
		Email:     "new@example.com",
		FirstName: "New",
		LastName:  "User",
	})

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if user.ID != 3 {
		t.Errorf("Expected user ID 3, got %d", user.ID)
	}
}

func TestLinkerService_LogUserCreated_AuditWriteError(t *testing.T) {
	name := "New User"
	mockRepo := &testutils.MockRepository{
		GetAccountRecord:    nil,
		FindByEmailUser:     nil,
		CreateUserRecord:    &auth.RegisterUserRecord{ID: 12, Email: "audit-fail@example.com", FullName: &name},
		CreateAccountRecord: &auth.AccountRecord{ID: "acc_12"},
		CreateAuditLogErr:   errors.New("audit write failed"),
	}
	service := auth.NewLinkerService(mockRepo, mockRepo, mockRepo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_12",
		Email: "audit-fail@example.com",
	})
	require.NoError(t, err)
	assert.Equal(t, 12, user.ID)
}

func TestLinkerService_LogUserCreated_SkipsWithoutAuditRepo(t *testing.T) {
	name := "New User"
	regRepo := &testutils.MockRepository{
		CreateUserRecord: &auth.RegisterUserRecord{
			ID:       11,
			Email:    "audit-skip@example.com",
			FullName: &name,
		},
	}
	accountRepo := &testutils.MockRepository{
		GetAccountRecord:    nil,
		CreateAccountRecord: &auth.AccountRecord{ID: "acc_11"},
	}
	service := auth.NewLinkerService(userRepoNoAudit{}, accountRepo, regRepo)

	user, err := service.LinkOrCreateWorkOSUser(context.Background(), usermanagement.User{
		ID:    "workos_11",
		Email: "audit-skip@example.com",
	})
	require.NoError(t, err)
	assert.Equal(t, 11, user.ID)
}
