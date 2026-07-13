package finance

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/memories"
	corefinance "github.com/TaskForceAI/go-core/pkg/finance"
	"github.com/danielgtaylor/huma/v2"
)

type MemoryService interface {
	GetFinancialMemories(ctx context.Context, userID int32, orgID *int32) ([]memories.MemoryRecord, error)
	SaveFinancialMemory(ctx context.Context, userID int32, orgID *int32, content string) error
	DeleteMemory(ctx context.Context, id int32, userID int32, orgID *int32) error
}

type ProviderService interface {
	ProviderConfigured() bool
	CreateLinkToken(ctx context.Context, input corefinance.ScopeInput) (corefinance.LinkTokenResult, error)
	ExchangePublicToken(ctx context.Context, input corefinance.ScopeInput, publicToken string, metadata ...corefinance.ExchangeMetadata) (corefinance.ConnectionRecord, error)
	Sync(ctx context.Context, input corefinance.ScopeInput) error
	Dashboard(ctx context.Context, input corefinance.ScopeInput) (corefinance.DashboardData, error)
	Disconnect(ctx context.Context, input corefinance.DisconnectConnectionInput) error
}

func RegisterHandlers(api huma.API, memoryService MemoryService, providerService ProviderService) {
	registerDashboard(api, memoryService, providerService)
	registerCreateLinkToken(api, providerService)
	registerExchangePublicToken(api, providerService)
	registerSync(api, providerService)
	registerDisconnect(api, providerService)
	registerCreateMemory(api, memoryService)
	registerDeleteMemory(api, memoryService)
}

func registerDashboard(api huma.API, memoryService MemoryService, providerService ProviderService) {
	huma.Register(api, huma.Operation{
		OperationID: "get-finance-dashboard",
		Method:      http.MethodGet,
		Path:        "/api/v1/finances",
		Summary:     "Get personal finance context",
		Tags:        []string{"Finance"},
	}, func(ctx context.Context, input *struct {
		handler.SessionAuthContext
	}) (*struct{ Body FinanceDashboardResponse }, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		mems, err := memoryService.GetFinancialMemories(ctx, ids.UserID32, ids.OrgID32)
		if err != nil {
			slog.Error("Failed to fetch financial memories", "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch finance context")
		}

		providerConfigured := providerService != nil && providerService.ProviderConfigured()
		resp := baseDashboardResponse(mems, providerConfigured)
		if providerConfigured {
			data, err := providerService.Dashboard(ctx, corefinance.ScopeInput{UserID: ids.UserID32, OrganizationID: ids.OrgID32})
			if err != nil {
				slog.Error("Failed to fetch connected finance data", "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
				return nil, huma.Error500InternalServerError("Failed to fetch finance context")
			}
			applyDashboardData(&resp, data)
		}

		return &struct{ Body FinanceDashboardResponse }{Body: resp}, nil
	})
}

func registerCreateLinkToken(api huma.API, providerService ProviderService) {
	huma.Register(api, huma.Operation{
		OperationID: "create-finance-link-token",
		Method:      http.MethodPost,
		Path:        "/api/v1/finances/link-token",
		Summary:     "Create a Plaid Link token",
		Tags:        []string{"Finance"},
	}, func(ctx context.Context, input *struct {
		handler.SessionAuthContext
	}) (*struct {
		Body CreateFinanceLinkTokenResponse
	}, error) {
		if providerService == nil || !providerService.ProviderConfigured() {
			return nil, huma.Error503ServiceUnavailable("Finance provider is not configured")
		}
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}
		token, err := providerService.CreateLinkToken(ctx, corefinance.ScopeInput{UserID: ids.UserID32, OrganizationID: ids.OrgID32})
		if err != nil {
			slog.Error("Failed to create finance link token", "userId", ids.UserID32, "error", err)
			return nil, huma.Error500InternalServerError("Failed to create finance link token")
		}
		return &struct {
			Body CreateFinanceLinkTokenResponse
		}{Body: CreateFinanceLinkTokenResponse{
			LinkToken:  token.LinkToken,
			Expiration: token.Expiration,
		}}, nil
	})
}

func registerExchangePublicToken(api huma.API, providerService ProviderService) {
	huma.Register(api, huma.Operation{
		OperationID: "exchange-finance-public-token",
		Method:      http.MethodPost,
		Path:        "/api/v1/finances/exchange-public-token",
		Summary:     "Exchange a Plaid public token",
		Tags:        []string{"Finance"},
	}, func(ctx context.Context, input *struct {
		Body ExchangeFinancePublicTokenRequest
		handler.SessionAuthContext
	}) (*struct{}, error) {
		if providerService == nil || !providerService.ProviderConfigured() {
			return nil, huma.Error503ServiceUnavailable("Finance provider is not configured")
		}
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}
		if _, err := providerService.ExchangePublicToken(ctx, corefinance.ScopeInput{
			UserID: ids.UserID32, OrganizationID: ids.OrgID32,
		}, input.Body.PublicToken, corefinance.ExchangeMetadata{
			InstitutionID:   input.Body.InstitutionID,
			InstitutionName: input.Body.InstitutionName,
		}); err != nil {
			slog.Error("Failed to exchange finance public token", "userId", ids.UserID32, "error", err)
			return nil, huma.Error500InternalServerError("Failed to connect financial account")
		}
		return &struct{}{}, nil
	})
}

func registerSync(api huma.API, providerService ProviderService) {
	huma.Register(api, huma.Operation{
		OperationID: "sync-finance-data",
		Method:      http.MethodPost,
		Path:        "/api/v1/finances/sync",
		Summary:     "Sync connected finance data",
		Tags:        []string{"Finance"},
	}, func(ctx context.Context, input *struct {
		handler.SessionAuthContext
	}) (*struct{}, error) {
		if providerService == nil || !providerService.ProviderConfigured() {
			return nil, huma.Error503ServiceUnavailable("Finance provider is not configured")
		}
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}
		if err := providerService.Sync(ctx, corefinance.ScopeInput{UserID: ids.UserID32, OrganizationID: ids.OrgID32}); err != nil {
			if errors.Is(err, corefinance.ErrProviderNotConfigured) {
				return nil, huma.Error503ServiceUnavailable("Finance provider is not configured")
			}
			slog.Error("Failed to sync finance data", "userId", ids.UserID32, "error", err)
			return nil, huma.Error500InternalServerError("Failed to sync finance data")
		}
		return &struct{}{}, nil
	})
}

func registerDisconnect(api huma.API, providerService ProviderService) {
	huma.Register(api, huma.Operation{
		OperationID: "disconnect-finance-connection",
		Method:      http.MethodDelete,
		Path:        "/api/v1/finances/connections/{id}",
		Summary:     "Disconnect a finance connection",
		Tags:        []string{"Finance"},
	}, func(ctx context.Context, input *struct {
		ID int32 `path:"id"`
		handler.SessionAuthContext
	}) (*struct{}, error) {
		if providerService == nil || !providerService.ProviderConfigured() {
			return nil, huma.Error503ServiceUnavailable("Finance provider is not configured")
		}
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}
		if err := providerService.Disconnect(ctx, corefinance.DisconnectConnectionInput{
			ID:             input.ID,
			UserID:         ids.UserID32,
			OrganizationID: ids.OrgID32,
		}); err != nil {
			slog.Error("Failed to disconnect finance connection", "connectionId", input.ID, "userId", ids.UserID32, "error", err)
			return nil, huma.Error500InternalServerError("Failed to disconnect finance connection")
		}
		return &struct{}{}, nil
	})
}

func registerCreateMemory(api huma.API, memoryService MemoryService) {
	huma.Register(api, huma.Operation{
		OperationID: "create-finance-memory",
		Method:      http.MethodPost,
		Path:        "/api/v1/finances/memories",
		Summary:     "Save personal finance context",
		Tags:        []string{"Finance"},
	}, func(ctx context.Context, input *struct {
		Body CreateFinanceMemoryRequest
		handler.SessionAuthContext
	}) (*struct{}, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		if err := memoryService.SaveFinancialMemory(ctx, ids.UserID32, ids.OrgID32, input.Body.Content); err != nil {
			slog.Warn("Rejected financial memory", "userId", ids.UserID32, "error", err)
			return nil, huma.Error400BadRequest("Invalid financial memory")
		}
		return &struct{}{}, nil
	})
}

func registerDeleteMemory(api huma.API, memoryService MemoryService) {
	huma.Register(api, huma.Operation{
		OperationID: "delete-finance-memory",
		Method:      http.MethodDelete,
		Path:        "/api/v1/finances/memories/{id}",
		Summary:     "Delete personal finance context",
		Tags:        []string{"Finance"},
	}, func(ctx context.Context, input *struct {
		ID int32 `path:"id" doc:"Financial memory ID"`
		handler.SessionAuthContext
	}) (*struct{}, error) {
		ids, err := handler.ResolveAuthIDs(input.User, input.OrgID)
		if err != nil {
			return nil, err
		}

		if err := memoryService.DeleteMemory(ctx, input.ID, ids.UserID32, ids.OrgID32); err != nil {
			slog.Error("Failed to delete financial memory", "memoryId", input.ID, "userId", ids.UserID32, "orgId", ids.OrgID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to delete financial memory")
		}
		return &struct{}{}, nil
	})
}

func baseDashboardResponse(mems []memories.MemoryRecord, providerConfigured bool) FinanceDashboardResponse {
	status := "not_connected"
	if providerConfigured {
		status = "provider_configured"
	}
	return FinanceDashboardResponse{
		ConnectedAccounts:  false,
		ProviderStatus:     status,
		Memories:           mapFinanceMemories(mems),
		Connections:        []FinanceConnectionResponse{},
		Accounts:           []FinanceAccountResponse{},
		RecentTransactions: []FinanceTransactionResponse{},
		RecurringStreams:   []FinanceRecurringResponse{},
		Capabilities: []string{
			"goal_planning",
			"spending_context",
			"subscription_review_context",
			"scenario_planning",
		},
		Privacy: FinancePrivacyResponse{
			ConnectedAccountsAvailable: providerConfigured,
			CanMutateAccounts:          false,
			TrainingControls:           "uses account-level data controls",
			DataControls: []string{
				"financial memories can be deleted at any time",
				"connected financial accounts can be disconnected at any time",
				"temporary chats should not load finance context",
			},
		},
	}
}

func applyDashboardData(resp *FinanceDashboardResponse, data corefinance.DashboardData) {
	resp.Connections = mapFinanceConnections(data.Connections)
	resp.Accounts = mapFinanceAccounts(data.Accounts)
	resp.RecentTransactions = mapFinanceTransactions(data.RecentTransactions)
	resp.RecurringStreams = mapFinanceRecurringStreams(data.RecurringStreams)
	if len(data.Connections) > 0 {
		resp.ConnectedAccounts = true
		resp.ProviderStatus = "connected"
	}
}

func mapFinanceMemories(mems []memories.MemoryRecord) []FinanceMemoryResponse {
	resp := make([]FinanceMemoryResponse, 0, len(mems))
	for _, memory := range mems {
		resp = append(resp, FinanceMemoryResponse{
			ID:      memory.ID,
			Content: memory.Content,
			Type:    memory.Type,
		})
	}
	return resp
}

func mapFinanceConnections(items []corefinance.ConnectionRecord) []FinanceConnectionResponse {
	resp := make([]FinanceConnectionResponse, 0, len(items))
	for _, item := range items {
		resp = append(resp, FinanceConnectionResponse{
			ID:              item.ID,
			Provider:        item.Provider,
			InstitutionName: item.InstitutionName,
			LastSyncedAt:    timePtrString(item.LastSyncedAt),
		})
	}
	return resp
}

func mapFinanceAccounts(items []corefinance.AccountRecord) []FinanceAccountResponse {
	resp := make([]FinanceAccountResponse, 0, len(items))
	for _, item := range items {
		resp = append(resp, FinanceAccountResponse{
			ProviderAccountID: item.ProviderAccountID,
			Name:              item.Name,
			Mask:              item.Mask,
			Type:              item.Type,
			Subtype:           item.Subtype,
			CurrentBalance:    item.CurrentBalance,
			AvailableBalance:  item.AvailableBalance,
			ISOCurrencyCode:   item.ISOCurrencyCode,
		})
	}
	return resp
}

func mapFinanceTransactions(items []corefinance.TransactionRecord) []FinanceTransactionResponse {
	resp := make([]FinanceTransactionResponse, 0, len(items))
	for _, item := range items {
		resp = append(resp, FinanceTransactionResponse{
			ProviderTransactionID: item.ProviderTransactionID,
			ProviderAccountID:     item.ProviderAccountID,
			Amount:                item.Amount,
			ISOCurrencyCode:       item.ISOCurrencyCode,
			Date:                  item.Date.Format("2006-01-02"),
			Name:                  item.Name,
			MerchantName:          item.MerchantName,
			PrimaryCategory:       item.PrimaryCategory,
			DetailedCategory:      item.DetailedCategory,
			Pending:               item.Pending,
		})
	}
	return resp
}

func mapFinanceRecurringStreams(items []corefinance.RecurringStreamRecord) []FinanceRecurringResponse {
	resp := make([]FinanceRecurringResponse, 0, len(items))
	for _, item := range items {
		resp = append(resp, FinanceRecurringResponse{
			ProviderStreamID:  item.ProviderStreamID,
			ProviderAccountID: item.ProviderAccountID,
			StreamType:        item.StreamType,
			MerchantName:      item.MerchantName,
			Description:       item.Description,
			Frequency:         item.Frequency,
			LastAmount:        item.LastAmount,
			ISOCurrencyCode:   item.ISOCurrencyCode,
			LastDate:          timePtrDate(item.LastDate),
			Status:            item.Status,
		})
	}
	return resp
}

func timePtrString(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}

func timePtrDate(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.Format("2006-01-02")
	return &formatted
}
