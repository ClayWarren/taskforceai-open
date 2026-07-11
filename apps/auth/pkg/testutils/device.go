package testutils

import (
	"context"

	"github.com/TaskForceAI/auth-service/pkg/auth"
)

type MockDeviceService struct {
	StartPayload *auth.DeviceLoginStartPayload
	StartErr     error

	AuthorizeErr error

	TokenOutcome *auth.DeviceLoginTokenOutcome
	TokenErr     error
}

func (m *MockDeviceService) StartDeviceLogin(ctx context.Context, baseURL string) (*auth.DeviceLoginStartPayload, error) {
	return m.StartPayload, m.StartErr
}

func (m *MockDeviceService) AuthorizeDeviceLogin(ctx context.Context, userID int, userCode string) error {
	return m.AuthorizeErr
}

func (m *MockDeviceService) ExchangeDeviceToken(ctx context.Context, deviceCode, secret string) (*auth.DeviceLoginTokenOutcome, error) {
	return m.TokenOutcome, m.TokenErr
}
