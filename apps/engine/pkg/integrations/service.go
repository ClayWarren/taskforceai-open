package integrations

import (
	"context"
	"log/slog"
)

var supportedProviders = []string{"google-drive", "taskforce-cli", "github"}

type IntegrationStatus struct {
	ID        string `json:"id"`
	Provider  string `json:"provider"`
	Connected bool   `json:"connected"`
}

type Service interface {
	ListIntegrations(ctx context.Context, userID int32) ([]IntegrationStatus, error)
	Disconnect(ctx context.Context, userID int32, provider string) error
}

type IntegrationService struct {
	repo Repository
}

func NewService(repo Repository) *IntegrationService {
	return &IntegrationService{repo: repo}
}

func (s *IntegrationService) ListIntegrations(ctx context.Context, userID int32) ([]IntegrationStatus, error) {
	accounts, err := s.repo.GetAccountsByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	supportedProviderSet := make(map[string]bool, len(supportedProviders))
	for _, provider := range supportedProviders {
		supportedProviderSet[provider] = true
	}

	found := make(map[string]bool)

	for _, acc := range accounts {
		if supportedProviderSet[acc.Provider] {
			found[acc.Provider] = true
		}
	}

	devices, devErr := s.repo.GetActiveDeviceLoginsByUserID(ctx, userID)
	if devErr != nil {
		// Non-fatal: log and continue reporting status without device session data.
		slog.Warn("[IntegrationService] Failed to fetch device logins", "userId", userID, "error", devErr)
	}
	if len(devices) > 0 {
		found["taskforce-cli"] = true
	}

	resp := make([]IntegrationStatus, 0, len(supportedProviders))
	for _, provider := range supportedProviders {
		resp = append(resp, IntegrationStatus{
			ID:        provider,
			Provider:  provider,
			Connected: found[provider],
		})
	}

	return resp, nil
}

func (s *IntegrationService) Disconnect(ctx context.Context, userID int32, provider string) error {
	if provider == "taskforce-cli" {
		return s.repo.DeleteDeviceLoginByUserID(ctx, userID)
	}
	return s.repo.DeleteAccount(ctx, userID, provider)
}
