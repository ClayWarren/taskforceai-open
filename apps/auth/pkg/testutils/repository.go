package testutils

import (
	"context"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
)

type MockRepository struct {
	// AuthUserRepository
	FindByEmailUser *auth.AuthUser
	FindByEmailErr  error
	FindByIDUser    *auth.AuthUser
	FindByIDErr     error

	// RegisterRepository
	ExistingUserRecord *auth.ExistingUserRecord
	CreateUserRecord   *auth.RegisterUserRecord
	CreateUserErr      error

	// AccountRepository
	GetAccountRecord     *auth.AccountRecord
	GetAccountErr        error
	CreateAccountRecord  *auth.AccountRecord
	CreateAccountErr     error
	GetUserByAccountUser *auth.AuthUser
	GetUserByAccountErr  error

	// DeviceLoginRepository
	DeviceLoginRecord   *auth.DeviceLoginRecord
	DeviceLoginErr      error
	DeviceUser          *auth.DeviceLoginUser
	DeviceUserErr       error
	PollDenied          bool
	PollErr             error
	MarkCompletedResult bool
	MarkCompletedErr    error

	// AuditLogRepository
	CreateAuditLogErr error
}

func (m *MockRepository) FindByEmail(ctx context.Context, email string) (*auth.AuthUser, error) {
	return m.FindByEmailUser, m.FindByEmailErr
}

func (m *MockRepository) FindLoginByEmail(ctx context.Context, email string) (*auth.LoginUserRecord, error) {
	if m.FindByEmailUser != nil {
		return &auth.LoginUserRecord{
			ID:       m.FindByEmailUser.ID,
			Email:    m.FindByEmailUser.Email,
			FullName: m.FindByEmailUser.FullName,
			Disabled: m.FindByEmailUser.Disabled,
		}, m.FindByEmailErr
	}
	return nil, m.FindByEmailErr
}

func (m *MockRepository) FindByID(ctx context.Context, id int) (*auth.AuthUser, error) {
	return m.FindByIDUser, m.FindByIDErr
}

func (m *MockRepository) FindExistingUser(ctx context.Context, email string) (*auth.ExistingUserRecord, error) {
	return m.ExistingUserRecord, nil
}

func (m *MockRepository) CreateUser(ctx context.Context, input auth.RegisterUserInput) (*auth.RegisterUserRecord, error) {
	return m.CreateUserRecord, m.CreateUserErr
}

func (m *MockRepository) GetAccountByProvider(ctx context.Context, provider, providerAccountID string) (*auth.AccountRecord, error) {
	return m.GetAccountRecord, m.GetAccountErr
}

func (m *MockRepository) CreateAccount(ctx context.Context, input auth.CreateAccountInput) (*auth.AccountRecord, error) {
	return m.CreateAccountRecord, m.CreateAccountErr
}

func (m *MockRepository) GetUserByAccount(ctx context.Context, provider, providerAccountID string) (*auth.AuthUser, error) {
	return m.GetUserByAccountUser, m.GetUserByAccountErr
}

func (m *MockRepository) CreateAuditLog(ctx context.Context, data auth.AuditLogWrite) error {
	return m.CreateAuditLogErr
}

// DeviceLoginRepository Implementation
func (m *MockRepository) FindActiveLoginByCodes(ctx context.Context, deviceCode, userCode string) (*auth.DeviceLoginRecord, error) {
	return m.DeviceLoginRecord, m.DeviceLoginErr
}

func (m *MockRepository) CreateLogin(ctx context.Context, input auth.DeviceLoginCreateInput) (*auth.DeviceLoginRecord, error) {
	return &auth.DeviceLoginRecord{
		DeviceCode: input.DeviceCode,
		UserCode:   input.UserCode,
		ExpiresAt:  input.ExpiresAt,
	}, m.DeviceLoginErr
}

func (m *MockRepository) FindByUserCode(ctx context.Context, userCode string) (*auth.DeviceLoginRecord, error) {
	return m.DeviceLoginRecord, m.DeviceLoginErr
}

func (m *MockRepository) FindByDeviceCode(ctx context.Context, deviceCode string) (*auth.DeviceLoginRecord, error) {
	return m.DeviceLoginRecord, m.DeviceLoginErr
}

func (m *MockRepository) UpdateLogin(ctx context.Context, id int, update auth.DeviceLoginUpdate) error {
	return m.DeviceLoginErr
}

func (m *MockRepository) RecordDeviceLoginPoll(context.Context, int, time.Time) (bool, error) {
	return !m.PollDenied, m.PollErr
}

func (m *MockRepository) MarkDeviceLoginAsCompleted(ctx context.Context, id int) (bool, error) {
	return m.MarkCompletedResult, m.MarkCompletedErr
}

func (m *MockRepository) FindUserByID(ctx context.Context, userID int) (*auth.DeviceLoginUser, error) {
	return m.DeviceUser, m.DeviceUserErr
}
