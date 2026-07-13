package finance

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
)

var ErrProviderNotConfigured = errors.New("finance provider is not configured")

type Service struct {
	store          Store
	provider       Provider
	tokenProtector TokenProtector
	linkConfig     LinkConfig
}

// TokenProtector keeps encryption mechanics outside the finance use cases.
type TokenProtector interface {
	Encrypt(*string) (*string, error)
	Decrypt(*string) (*string, error)
}

// LinkConfig contains provider-facing presentation values supplied by the
// composition root rather than read from the process environment.
type LinkConfig struct {
	ClientName  string
	WebhookURL  string
	RedirectURI string
}

// NewServiceWithDependencies constructs the finance use cases with their
// outward-facing ports explicitly supplied.
func NewServiceWithDependencies(store Store, provider Provider, tokenProtector TokenProtector, linkConfig LinkConfig) *Service {
	clientName := strings.TrimSpace(linkConfig.ClientName)
	if clientName == "" {
		clientName = "TaskForceAI"
	}
	return &Service{
		store:          store,
		provider:       provider,
		tokenProtector: tokenProtector,
		linkConfig: LinkConfig{
			ClientName:  clientName,
			WebhookURL:  strings.TrimSpace(linkConfig.WebhookURL),
			RedirectURI: strings.TrimSpace(linkConfig.RedirectURI),
		},
	}
}

func (s *Service) ProviderConfigured() bool {
	return s != nil && s.provider != nil
}

func (s *Service) CreateLinkToken(ctx context.Context, input ScopeInput) (LinkTokenResult, error) {
	if s.provider == nil {
		return LinkTokenResult{}, ErrProviderNotConfigured
	}
	return s.provider.CreateLinkToken(ctx, LinkTokenInput{
		UserID:      input.UserID,
		ClientName:  s.linkConfig.ClientName,
		WebhookURL:  s.linkConfig.WebhookURL,
		RedirectURI: s.linkConfig.RedirectURI,
	})
}

func (s *Service) ExchangePublicToken(ctx context.Context, input ScopeInput, publicToken string, metadata ...ExchangeMetadata) (ConnectionRecord, error) {
	if s.provider == nil {
		return ConnectionRecord{}, ErrProviderNotConfigured
	}
	publicToken = strings.TrimSpace(publicToken)
	if publicToken == "" {
		return ConnectionRecord{}, fmt.Errorf("public token is required")
	}

	exchanged, err := s.provider.ExchangePublicToken(ctx, publicToken)
	if err != nil {
		return ConnectionRecord{}, err
	}
	if s.tokenProtector == nil {
		return ConnectionRecord{}, errors.New("finance token protector is not configured")
	}
	encryptedToken, err := s.tokenProtector.Encrypt(&exchanged.AccessToken)
	if err != nil {
		return ConnectionRecord{}, err
	}
	institutionID := exchanged.InstitutionID
	institutionName := exchanged.InstitutionName
	if len(metadata) > 0 {
		if metadata[0].InstitutionID != nil {
			institutionID = trimStringPtr(metadata[0].InstitutionID)
		}
		if metadata[0].InstitutionName != nil {
			institutionName = trimStringPtr(metadata[0].InstitutionName)
		}
	}

	return s.store.UpsertConnection(ctx, UpsertConnectionInput{
		UserID:               input.UserID,
		OrganizationID:       input.OrganizationID,
		Provider:             ProviderPlaid,
		ProviderItemID:       exchanged.ItemID,
		EncryptedAccessToken: *encryptedToken,
		Products:             []string{"transactions", "recurring_transactions"},
		InstitutionID:        institutionID,
		InstitutionName:      institutionName,
	})
}

func (s *Service) Sync(ctx context.Context, input ScopeInput) error {
	if s.provider == nil {
		return ErrProviderNotConfigured
	}
	connections, err := s.store.ListConnections(ctx, input)
	if err != nil {
		return err
	}
	for _, connection := range connections {
		if err := s.syncConnection(ctx, connection); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Dashboard(ctx context.Context, input ScopeInput) (DashboardData, error) {
	return s.store.GetDashboard(ctx, input)
}

func (s *Service) Disconnect(ctx context.Context, input DisconnectConnectionInput) error {
	if s.provider == nil {
		return s.store.DisconnectConnection(ctx, input)
	}

	connection, err := s.store.GetConnection(ctx, input)
	if err != nil {
		return err
	}
	if s.tokenProtector == nil {
		return errors.New("finance token protector is not configured")
	}
	accessToken, err := s.tokenProtector.Decrypt(&connection.EncryptedAccessToken)
	if err != nil {
		return err
	}
	if accessToken != nil && strings.TrimSpace(*accessToken) != "" {
		if err := s.provider.RemoveItem(ctx, *accessToken); err != nil {
			return fmt.Errorf("remove plaid item: %w", err)
		}
	}
	return s.store.DisconnectConnection(ctx, input)
}

func (s *Service) syncConnection(ctx context.Context, connection ConnectionRecord) error {
	if s.tokenProtector == nil {
		return errors.New("finance token protector is not configured")
	}
	accessToken, err := s.tokenProtector.Decrypt(&connection.EncryptedAccessToken)
	if err != nil {
		return err
	}
	cursor := connection.TransactionsCursor
	for {
		result, err := s.provider.SyncTransactions(ctx, SyncInput{
			AccessToken: *accessToken,
			Cursor:      cursor,
		})
		if err != nil {
			return err
		}
		if err := s.store.UpsertAccounts(ctx, connection.ID, result.Accounts); err != nil {
			return err
		}
		if err := s.store.UpsertTransactions(ctx, connection.ID, result.Added); err != nil {
			return err
		}
		if err := s.store.UpsertTransactions(ctx, connection.ID, result.Modified); err != nil {
			return err
		}
		if err := s.store.MarkTransactionsRemoved(ctx, connection.ID, result.RemovedIDs); err != nil {
			return err
		}
		if err := s.store.UpdateTransactionsCursor(ctx, connection.ID, result.NextCursor); err != nil {
			return err
		}
		cursor = &result.NextCursor
		if !result.HasMore {
			break
		}
	}

	recurring, err := s.provider.GetRecurringTransactions(ctx, *accessToken)
	if err == nil {
		return s.store.UpsertRecurringStreams(ctx, connection.ID, recurring.Streams)
	}
	slog.Warn("Finance recurring transaction sync failed", "connectionId", connection.ID, "provider", connection.Provider, "error", err)
	return nil
}

func trimStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
