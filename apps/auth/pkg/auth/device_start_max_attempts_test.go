package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/stretchr/testify/assert"
)

type alwaysCollidingRepo struct{}

func (alwaysCollidingRepo) FindActiveLoginByCodes(context.Context, string, string) (*auth.DeviceLoginRecord, error) {
	return &auth.DeviceLoginRecord{ID: 1}, nil
}

func (alwaysCollidingRepo) CreateLogin(context.Context, auth.DeviceLoginCreateInput) (*auth.DeviceLoginRecord, error) {
	return nil, nil
}

func (alwaysCollidingRepo) FindByUserCode(context.Context, string) (*auth.DeviceLoginRecord, error) {
	return nil, nil
}

func (alwaysCollidingRepo) FindByDeviceCode(context.Context, string) (*auth.DeviceLoginRecord, error) {
	return nil, nil
}

func (alwaysCollidingRepo) UpdateLogin(context.Context, int, auth.DeviceLoginUpdate) error {
	return nil
}

func (alwaysCollidingRepo) RecordDeviceLoginPoll(context.Context, int, time.Time) (bool, error) {
	return true, nil
}

func (alwaysCollidingRepo) MarkDeviceLoginAsCompleted(context.Context, int) (bool, error) {
	return false, nil
}

func (alwaysCollidingRepo) FindUserByID(context.Context, int) (*auth.DeviceLoginUser, error) {
	return nil, nil
}

func TestDeviceLoginService_StartDeviceLogin_MaxAttemptsExceeded(t *testing.T) {
	service := auth.NewDeviceLoginService(alwaysCollidingRepo{})
	_, err := service.StartDeviceLogin(context.Background(), "https://auth.example.com")
	assert.ErrorIs(t, err, auth.ErrUnavailable)
}
