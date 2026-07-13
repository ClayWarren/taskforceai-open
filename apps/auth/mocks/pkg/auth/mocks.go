package mocks

import (
	"context"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/stretchr/testify/mock"
)

type testingT interface {
	mock.TestingT
	Cleanup(func())
}

func register[T interface{ AssertExpectations(mock.TestingT) bool }](t testingT, m T) T {
	t.Cleanup(func() { m.AssertExpectations(t) })
	return m
}

func typedResult[T any](args mock.Arguments) (T, error) {
	var zero T
	if v := args.Get(0); v != nil {
		if typed, ok := v.(T); ok {
			return typed, args.Error(1)
		}
	}
	return zero, args.Error(1)
}

type AuthUserRepository struct{ mock.Mock }

func NewAuthUserRepository(t testingT) *AuthUserRepository {
	return register(t, &AuthUserRepository{})
}

func (m *AuthUserRepository) FindByEmail(ctx context.Context, email string) (*auth.AuthUser, error) {
	return typedResult[*auth.AuthUser](m.Called(ctx, email))
}

func (m *AuthUserRepository) FindByID(ctx context.Context, id int) (*auth.AuthUser, error) {
	return typedResult[*auth.AuthUser](m.Called(ctx, id))
}

type LoginRepository struct{ mock.Mock }

func NewLoginRepository(t testingT) *LoginRepository {
	return register(t, &LoginRepository{})
}

func (m *LoginRepository) FindLoginByEmail(ctx context.Context, email string) (*auth.LoginUserRecord, error) {
	return typedResult[*auth.LoginUserRecord](m.Called(ctx, email))
}

type RegisterRepository struct{ mock.Mock }

func NewRegisterRepository(t testingT) *RegisterRepository {
	return register(t, &RegisterRepository{})
}

func (m *RegisterRepository) FindExistingUser(ctx context.Context, email string) (*auth.ExistingUserRecord, error) {
	return typedResult[*auth.ExistingUserRecord](m.Called(ctx, email))
}

func (m *RegisterRepository) CreateUser(ctx context.Context, input auth.RegisterUserInput) (*auth.RegisterUserRecord, error) {
	return typedResult[*auth.RegisterUserRecord](m.Called(ctx, input))
}

type DeviceLoginRepository struct{ mock.Mock }

func NewDeviceLoginRepository(t testingT) *DeviceLoginRepository {
	return register(t, &DeviceLoginRepository{})
}

func (m *DeviceLoginRepository) FindActiveLoginByCodes(ctx context.Context, deviceCode, userCode string) (*auth.DeviceLoginRecord, error) {
	return typedResult[*auth.DeviceLoginRecord](m.Called(ctx, deviceCode, userCode))
}

func (m *DeviceLoginRepository) CreateLogin(ctx context.Context, input auth.DeviceLoginCreateInput) (*auth.DeviceLoginRecord, error) {
	return typedResult[*auth.DeviceLoginRecord](m.Called(ctx, input))
}

func (m *DeviceLoginRepository) FindByUserCode(ctx context.Context, userCode string) (*auth.DeviceLoginRecord, error) {
	return typedResult[*auth.DeviceLoginRecord](m.Called(ctx, userCode))
}

func (m *DeviceLoginRepository) FindByDeviceCode(ctx context.Context, deviceCode string) (*auth.DeviceLoginRecord, error) {
	return typedResult[*auth.DeviceLoginRecord](m.Called(ctx, deviceCode))
}

func (m *DeviceLoginRepository) UpdateLogin(ctx context.Context, id int, update auth.DeviceLoginUpdate) error {
	return m.Called(ctx, id, update).Error(0)
}

func (m *DeviceLoginRepository) RecordDeviceLoginPoll(ctx context.Context, id int, polledAt time.Time) (bool, error) {
	args := m.Called(ctx, id, polledAt)
	return args.Bool(0), args.Error(1)
}

func (m *DeviceLoginRepository) MarkDeviceLoginAsCompleted(ctx context.Context, id int) (bool, error) {
	args := m.Called(ctx, id)
	return args.Bool(0), args.Error(1)
}

func (m *DeviceLoginRepository) FindUserByID(ctx context.Context, userID int) (*auth.DeviceLoginUser, error) {
	return typedResult[*auth.DeviceLoginUser](m.Called(ctx, userID))
}

type DeviceService struct{ mock.Mock }

func NewDeviceService(t testingT) *DeviceService {
	return register(t, &DeviceService{})
}

func (m *DeviceService) StartDeviceLogin(ctx context.Context, baseURL string) (*auth.DeviceLoginStartPayload, error) {
	return typedResult[*auth.DeviceLoginStartPayload](m.Called(ctx, baseURL))
}

func (m *DeviceService) AuthorizeDeviceLogin(ctx context.Context, userID int, userCode string) error {
	return m.Called(ctx, userID, userCode).Error(0)
}

func (m *DeviceService) ExchangeDeviceToken(ctx context.Context, deviceCode, secret string) (*auth.DeviceLoginTokenOutcome, error) {
	return typedResult[*auth.DeviceLoginTokenOutcome](m.Called(ctx, deviceCode, secret))
}

type AccountRepository struct{ mock.Mock }

func NewAccountRepository(t testingT) *AccountRepository {
	return register(t, &AccountRepository{})
}

func (m *AccountRepository) GetAccountByProvider(ctx context.Context, provider, providerAccountID string) (*auth.AccountRecord, error) {
	return typedResult[*auth.AccountRecord](m.Called(ctx, provider, providerAccountID))
}

func (m *AccountRepository) CreateAccount(ctx context.Context, input auth.CreateAccountInput) (*auth.AccountRecord, error) {
	return typedResult[*auth.AccountRecord](m.Called(ctx, input))
}

func (m *AccountRepository) GetUserByAccount(ctx context.Context, provider, providerAccountID string) (*auth.AuthUser, error) {
	return typedResult[*auth.AuthUser](m.Called(ctx, provider, providerAccountID))
}

type AuditLogRepository struct{ mock.Mock }

func NewAuditLogRepository(t testingT) *AuditLogRepository {
	return register(t, &AuditLogRepository{})
}

func (m *AuditLogRepository) CreateAuditLog(ctx context.Context, data auth.AuditLogWrite) error {
	return m.Called(ctx, data).Error(0)
}

type RateLimiter struct{ mock.Mock }

func NewRateLimiter(t testingT) *RateLimiter {
	return register(t, &RateLimiter{})
}

func (m *RateLimiter) Check(ctx context.Context, key string, limit int, window time.Duration) (*auth.RateLimitResult, error) {
	return typedResult[*auth.RateLimitResult](m.Called(ctx, key, limit, window))
}

type UserLinker struct{ mock.Mock }

func NewUserLinker(t testingT) *UserLinker {
	return register(t, &UserLinker{})
}

func (m *UserLinker) LinkOrCreateExternalUser(ctx context.Context, identity auth.ExternalIdentity) (*auth.AuthUser, error) {
	return typedResult[*auth.AuthUser](m.Called(ctx, identity))
}
