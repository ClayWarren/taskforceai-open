package integrations_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	intpkg "github.com/TaskForceAI/go-engine/pkg/integrations"
)

type repositoryFake struct {
	accounts     []intpkg.Account
	devices      []intpkg.DeviceLogin
	accountsErr  error
	devicesErr   error
	deleted      []string
	deviceDelete bool
}

func (f *repositoryFake) GetAccountsByUserID(ctx context.Context, userID int32) ([]intpkg.Account, error) {
	return f.accounts, f.accountsErr
}

func (f *repositoryFake) GetActiveDeviceLoginsByUserID(ctx context.Context, userID int32) ([]intpkg.DeviceLogin, error) {
	return f.devices, f.devicesErr
}

func (f *repositoryFake) DeleteAccount(ctx context.Context, userID int32, provider string) error {
	f.deleted = append(f.deleted, provider)
	return nil
}

func (f *repositoryFake) DeleteDeviceLoginByUserID(ctx context.Context, userID int32) error {
	f.deviceDelete = true
	return nil
}

func TestIntegrationService_ListIntegrations_WithAccountsAndDevices(t *testing.T) {
	repo := &repositoryFake{
		accounts: []intpkg.Account{
			{ID: "acc-1", Provider: "google-drive"},
			{ID: "acc-2", Provider: "some-other"},
		},
		devices: []intpkg.DeviceLogin{{ID: "device-1"}},
	}

	svc := intpkg.NewService(repo)

	resp, err := svc.ListIntegrations(context.Background(), 1)
	require.NoError(t, err)
	if assert.Len(t, resp, 3) {
		assert.Equal(t, "google-drive", resp[0].Provider)
		assert.True(t, resp[0].Connected)
		assert.Equal(t, "taskforce-cli", resp[1].Provider)
		assert.True(t, resp[1].Connected)
		assert.Equal(t, "github", resp[2].Provider)
		assert.False(t, resp[2].Connected)
	}
}

func TestIntegrationService_ListIntegrations_DedupesTaskforceCli(t *testing.T) {
	repo := &repositoryFake{
		accounts: []intpkg.Account{{ID: "acc-cli", Provider: "taskforce-cli"}},
		devices:  []intpkg.DeviceLogin{{ID: "device-1"}},
	}
	svc := intpkg.NewService(repo)

	resp, err := svc.ListIntegrations(context.Background(), 1)
	require.NoError(t, err)

	count := 0
	for _, item := range resp {
		if item.Provider == "taskforce-cli" {
			count++
			assert.True(t, item.Connected)
		}
	}
	assert.Equal(t, 1, count)
	assert.Len(t, resp, 3)
}

func TestIntegrationService_ListIntegrations_NoAccounts(t *testing.T) {
	repo := &repositoryFake{}

	svc := intpkg.NewService(repo)

	resp, err := svc.ListIntegrations(context.Background(), 1)
	require.NoError(t, err)
	if assert.Len(t, resp, 3) {
		assert.Equal(t, "google-drive", resp[0].Provider)
		assert.False(t, resp[0].Connected)
		assert.Equal(t, "taskforce-cli", resp[1].Provider)
		assert.False(t, resp[1].Connected)
		assert.Equal(t, "github", resp[2].Provider)
		assert.False(t, resp[2].Connected)
	}
}

func TestIntegrationService_Disconnect_TaskforceCli(t *testing.T) {
	repo := &repositoryFake{}

	svc := intpkg.NewService(repo)

	err := svc.Disconnect(context.Background(), 12, "taskforce-cli")
	require.NoError(t, err)
	assert.True(t, repo.deviceDelete)
}

func TestIntegrationService_ListIntegrations_AccountsError(t *testing.T) {
	repo := &repositoryFake{accountsErr: errors.New("accounts failed")}

	svc := intpkg.NewService(repo)
	_, err := svc.ListIntegrations(context.Background(), 2)
	assert.Error(t, err)
}

func TestIntegrationService_ListIntegrations_DeviceLookupErrorContinues(t *testing.T) {
	repo := &repositoryFake{
		accounts:   []intpkg.Account{{ID: "acc-1", Provider: "github"}},
		devicesErr: errors.New("devices failed"),
	}

	svc := intpkg.NewService(repo)
	resp, err := svc.ListIntegrations(context.Background(), 3)
	require.NoError(t, err)
	assert.Len(t, resp, 3)
}

func TestIntegrationService_Disconnect_Provider(t *testing.T) {
	repo := &repositoryFake{}

	svc := intpkg.NewService(repo)

	err := svc.Disconnect(context.Background(), 12, "google-drive")
	require.NoError(t, err)
	assert.Equal(t, []string{"google-drive"}, repo.deleted)
}
