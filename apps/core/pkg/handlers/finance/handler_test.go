package finance

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/memories"
	corefinance "github.com/TaskForceAI/go-core/pkg/finance"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockFinanceMemoryService struct {
	getFunc    func(ctx context.Context, userID int32, orgID *int32) ([]memories.MemoryRecord, error)
	saveFunc   func(ctx context.Context, userID int32, orgID *int32, content string) error
	deleteFunc func(ctx context.Context, id int32, userID int32, orgID *int32) error
}

func (m *mockFinanceMemoryService) GetFinancialMemories(ctx context.Context, userID int32, orgID *int32) ([]memories.MemoryRecord, error) {
	if m.getFunc != nil {
		return m.getFunc(ctx, userID, orgID)
	}
	return nil, nil
}

func (m *mockFinanceMemoryService) SaveFinancialMemory(ctx context.Context, userID int32, orgID *int32, content string) error {
	if m.saveFunc != nil {
		return m.saveFunc(ctx, userID, orgID, content)
	}
	return nil
}

func (m *mockFinanceMemoryService) DeleteMemory(ctx context.Context, id int32, userID int32, orgID *int32) error {
	if m.deleteFunc != nil {
		return m.deleteFunc(ctx, id, userID, orgID)
	}
	return nil
}

type mockFinanceProviderService struct {
	configured     bool
	linkTokenFunc  func(ctx context.Context, input corefinance.ScopeInput) (corefinance.LinkTokenResult, error)
	exchangeFunc   func(ctx context.Context, input corefinance.ScopeInput, publicToken string, metadata ...corefinance.ExchangeMetadata) (corefinance.ConnectionRecord, error)
	syncFunc       func(ctx context.Context, input corefinance.ScopeInput) error
	dashboardFunc  func(ctx context.Context, input corefinance.ScopeInput) (corefinance.DashboardData, error)
	disconnectFunc func(ctx context.Context, input corefinance.DisconnectConnectionInput) error
}

func (m *mockFinanceProviderService) ProviderConfigured() bool {
	return m.configured
}

func (m *mockFinanceProviderService) CreateLinkToken(ctx context.Context, input corefinance.ScopeInput) (corefinance.LinkTokenResult, error) {
	if m.linkTokenFunc != nil {
		return m.linkTokenFunc(ctx, input)
	}
	return corefinance.LinkTokenResult{}, nil
}

func (m *mockFinanceProviderService) ExchangePublicToken(ctx context.Context, input corefinance.ScopeInput, publicToken string, metadata ...corefinance.ExchangeMetadata) (corefinance.ConnectionRecord, error) {
	if m.exchangeFunc != nil {
		return m.exchangeFunc(ctx, input, publicToken, metadata...)
	}
	return corefinance.ConnectionRecord{}, nil
}

func (m *mockFinanceProviderService) Sync(ctx context.Context, input corefinance.ScopeInput) error {
	if m.syncFunc != nil {
		return m.syncFunc(ctx, input)
	}
	return nil
}

func (m *mockFinanceProviderService) Dashboard(ctx context.Context, input corefinance.ScopeInput) (corefinance.DashboardData, error) {
	if m.dashboardFunc != nil {
		return m.dashboardFunc(ctx, input)
	}
	return corefinance.DashboardData{}, nil
}

func (m *mockFinanceProviderService) Disconnect(ctx context.Context, input corefinance.DisconnectConnectionInput) error {
	if m.disconnectFunc != nil {
		return m.disconnectFunc(ctx, input)
	}
	return nil
}

func setupFinanceRouter(service *mockFinanceMemoryService, user *auth.AuthenticatedUser, orgID int, providers ...ProviderService) *chi.Mux {
	return setupFinanceRouterWithAuthMethod(service, user, orgID, "", providers...)
}

func setupFinanceRouterWithAuthMethod(service *mockFinanceMemoryService, user *auth.AuthenticatedUser, orgID int, authMethod string, providers ...ProviderService) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				if authMethod != "" {
					ctx = context.WithValue(ctx, adapterhandler.AuthMethodContextKey, authMethod)
				}
				if orgID != 0 {
					ctx = context.WithValue(ctx, adapterhandler.OrgIDContextKey, orgID)
				}
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	var provider ProviderService
	if len(providers) > 0 {
		provider = providers[0]
	}
	RegisterHandlers(api, service, provider)
	return r
}

func TestFinanceEndpointsRejectAPIKeyAuth(t *testing.T) {
	provider := &mockFinanceProviderService{configured: true}
	router := setupFinanceRouterWithAuthMethod(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0, adapterhandler.AuthMethodAPIKey, provider)

	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "dashboard", method: http.MethodGet, path: "/api/v1/finances"},
		{name: "link token", method: http.MethodPost, path: "/api/v1/finances/link-token"},
		{name: "exchange public token", method: http.MethodPost, path: "/api/v1/finances/exchange-public-token", body: `{"public_token":"public-sandbox"}`},
		{name: "sync", method: http.MethodPost, path: "/api/v1/finances/sync"},
		{name: "disconnect", method: http.MethodDelete, path: "/api/v1/finances/connections/7"},
		{name: "create memory", method: http.MethodPost, path: "/api/v1/finances/memories", body: `{"content":"Budget planning"}`},
		{name: "delete memory", method: http.MethodDelete, path: "/api/v1/finances/memories/7"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, http.StatusForbidden, resp.Code)
		})
	}
}

func TestFinanceEndpointsRejectInvalidResolvedUserID(t *testing.T) {
	provider := &mockFinanceProviderService{configured: true}
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 1 << 40}, 0, provider)

	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "dashboard", method: http.MethodGet, path: "/api/v1/finances"},
		{name: "link token", method: http.MethodPost, path: "/api/v1/finances/link-token"},
		{name: "exchange public token", method: http.MethodPost, path: "/api/v1/finances/exchange-public-token", body: `{"public_token":"public-sandbox"}`},
		{name: "sync", method: http.MethodPost, path: "/api/v1/finances/sync"},
		{name: "disconnect", method: http.MethodDelete, path: "/api/v1/finances/connections/7"},
		{name: "create memory", method: http.MethodPost, path: "/api/v1/finances/memories", body: `{"content":"Budget planning"}`},
		{name: "delete memory", method: http.MethodDelete, path: "/api/v1/finances/memories/7"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, http.StatusBadRequest, resp.Code)
		})
	}
}

func TestFinanceDashboardSuccess(t *testing.T) {
	service := &mockFinanceMemoryService{
		getFunc: func(ctx context.Context, userID int32, orgID *int32) ([]memories.MemoryRecord, error) {
			assert.Equal(t, int32(12), userID)
			require.NotNil(t, orgID)
			assert.Equal(t, int32(24), *orgID)
			return []memories.MemoryRecord{{ID: 1, Content: "Saving for a house", Type: "finance"}}, nil
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 24)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/finances", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body FinanceDashboardResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.False(t, body.ConnectedAccounts)
	assert.Equal(t, "not_connected", body.ProviderStatus)
	require.Len(t, body.Memories, 1)
	assert.Empty(t, body.Connections)
	assert.Empty(t, body.Accounts)
	assert.Empty(t, body.RecentTransactions)
	assert.Empty(t, body.RecurringStreams)
	assert.False(t, body.Privacy.CanMutateAccounts)
}

func TestFinanceDashboardWithConnectedData(t *testing.T) {
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	service := &mockFinanceMemoryService{}
	provider := &mockFinanceProviderService{
		configured: true,
		dashboardFunc: func(ctx context.Context, input corefinance.ScopeInput) (corefinance.DashboardData, error) {
			assert.Equal(t, int32(12), input.UserID)
			return corefinance.DashboardData{
				Connections: []corefinance.ConnectionRecord{{
					ID:              4,
					Provider:        corefinance.ProviderPlaid,
					InstitutionName: new("Demo Bank"),
					LastSyncedAt:    &now,
				}},
				Accounts: []corefinance.AccountRecord{{
					ProviderAccountID: "account-1",
					Name:              "Checking",
					ISOCurrencyCode:   new("USD"),
				}},
				RecentTransactions: []corefinance.TransactionRecord{{
					ProviderTransactionID: "transaction-1",
					ProviderAccountID:     "account-1",
					Amount:                24.5,
					Date:                  now,
					Name:                  "Coffee",
				}},
				RecurringStreams: []corefinance.RecurringStreamRecord{{
					ProviderStreamID:  "stream-1",
					ProviderAccountID: "account-1",
					StreamType:        "outflow",
				}},
			}, nil
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/finances", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body FinanceDashboardResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.True(t, body.ConnectedAccounts)
	assert.Equal(t, "connected", body.ProviderStatus)
	require.Len(t, body.Connections, 1)
	assert.Equal(t, "Demo Bank", *body.Connections[0].InstitutionName)
	require.Len(t, body.Accounts, 1)
	require.Len(t, body.RecentTransactions, 1)
	require.Len(t, body.RecurringStreams, 1)
}

func TestFinanceDashboardSkipsConnectedDataWhenProviderUnavailable(t *testing.T) {
	service := &mockFinanceMemoryService{}
	provider := &mockFinanceProviderService{
		configured: false,
		dashboardFunc: func(ctx context.Context, input corefinance.ScopeInput) (corefinance.DashboardData, error) {
			return corefinance.DashboardData{}, errors.New("tables unavailable")
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/finances", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body FinanceDashboardResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.False(t, body.ConnectedAccounts)
	assert.Equal(t, "not_connected", body.ProviderStatus)
	assert.Empty(t, body.Connections)
}

func TestFinanceDashboardProviderError(t *testing.T) {
	service := &mockFinanceMemoryService{}
	provider := &mockFinanceProviderService{
		configured: true,
		dashboardFunc: func(ctx context.Context, input corefinance.ScopeInput) (corefinance.DashboardData, error) {
			return corefinance.DashboardData{}, errors.New("plaid unavailable")
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/finances", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestCreateFinanceLinkTokenUnavailableWithoutProvider(t *testing.T) {
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/link-token", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestCreateFinanceLinkTokenSuccess(t *testing.T) {
	provider := &mockFinanceProviderService{
		configured: true,
		linkTokenFunc: func(ctx context.Context, input corefinance.ScopeInput) (corefinance.LinkTokenResult, error) {
			assert.Equal(t, int32(12), input.UserID)
			return corefinance.LinkTokenResult{LinkToken: "link-sandbox", Expiration: "2026-06-06T20:00:00Z"}, nil
		},
	}
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/link-token", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	var body CreateFinanceLinkTokenResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, "link-sandbox", body.LinkToken)
}

func TestCreateFinanceLinkTokenProviderError(t *testing.T) {
	provider := &mockFinanceProviderService{
		configured: true,
		linkTokenFunc: func(ctx context.Context, input corefinance.ScopeInput) (corefinance.LinkTokenResult, error) {
			return corefinance.LinkTokenResult{}, errors.New("provider error")
		},
	}
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/link-token", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestExchangeFinancePublicTokenSuccess(t *testing.T) {
	var capturedToken string
	provider := &mockFinanceProviderService{
		configured: true,
		exchangeFunc: func(ctx context.Context, input corefinance.ScopeInput, publicToken string, metadata ...corefinance.ExchangeMetadata) (corefinance.ConnectionRecord, error) {
			capturedToken = publicToken
			require.Len(t, metadata, 1)
			assert.Equal(t, "ins_123", *metadata[0].InstitutionID)
			assert.Equal(t, "Demo Bank", *metadata[0].InstitutionName)
			return corefinance.ConnectionRecord{ID: 9}, nil
		},
	}
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/exchange-public-token", strings.NewReader(`{"public_token":"public-sandbox","institution_id":"ins_123","institution_name":"Demo Bank"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, "public-sandbox", capturedToken)
}

func TestExchangeFinancePublicTokenUnavailableWithoutProvider(t *testing.T) {
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/exchange-public-token", strings.NewReader(`{"public_token":"public-sandbox"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestExchangeFinancePublicTokenProviderError(t *testing.T) {
	provider := &mockFinanceProviderService{
		configured: true,
		exchangeFunc: func(ctx context.Context, input corefinance.ScopeInput, publicToken string, metadata ...corefinance.ExchangeMetadata) (corefinance.ConnectionRecord, error) {
			return corefinance.ConnectionRecord{}, errors.New("exchange failed")
		},
	}
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/exchange-public-token", strings.NewReader(`{"public_token":"public-sandbox"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestSyncFinanceDataSuccess(t *testing.T) {
	var synced bool
	provider := &mockFinanceProviderService{
		configured: true,
		syncFunc: func(ctx context.Context, input corefinance.ScopeInput) error {
			synced = true
			return nil
		},
	}
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/sync", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.True(t, synced)
}

func TestSyncFinanceDataUnavailableWithoutProvider(t *testing.T) {
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/sync", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestSyncFinanceDataMapsProviderNotConfigured(t *testing.T) {
	provider := &mockFinanceProviderService{
		configured: true,
		syncFunc: func(ctx context.Context, input corefinance.ScopeInput) error {
			return corefinance.ErrProviderNotConfigured
		},
	}
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/sync", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestSyncFinanceDataProviderError(t *testing.T) {
	provider := &mockFinanceProviderService{
		configured: true,
		syncFunc: func(ctx context.Context, input corefinance.ScopeInput) error {
			return errors.New("sync failed")
		},
	}
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/sync", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestDisconnectFinanceConnectionSuccess(t *testing.T) {
	var captured corefinance.DisconnectConnectionInput
	provider := &mockFinanceProviderService{
		configured: true,
		disconnectFunc: func(ctx context.Context, input corefinance.DisconnectConnectionInput) error {
			captured = input
			return nil
		},
	}
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 24, provider)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/finances/connections/7", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, int32(7), captured.ID)
	assert.Equal(t, int32(12), captured.UserID)
	require.NotNil(t, captured.OrganizationID)
	assert.Equal(t, int32(24), *captured.OrganizationID)
}

func TestDisconnectFinanceConnectionUnavailableWithoutProvider(t *testing.T) {
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/finances/connections/7", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
}

func TestDisconnectFinanceConnectionProviderError(t *testing.T) {
	provider := &mockFinanceProviderService{
		configured: true,
		disconnectFunc: func(ctx context.Context, input corefinance.DisconnectConnectionInput) error {
			return errors.New("disconnect failed")
		},
	}
	router := setupFinanceRouter(&mockFinanceMemoryService{}, &auth.AuthenticatedUser{ID: 12}, 0, provider)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/finances/connections/7", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestFinanceDashboardPersonalScope(t *testing.T) {
	var capturedOrg *int32
	service := &mockFinanceMemoryService{
		getFunc: func(ctx context.Context, userID int32, orgID *int32) ([]memories.MemoryRecord, error) {
			assert.Equal(t, int32(12), userID)
			capturedOrg = orgID
			return []memories.MemoryRecord{}, nil
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/finances", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Nil(t, capturedOrg)
}

func TestFinanceDashboardServiceError(t *testing.T) {
	service := &mockFinanceMemoryService{
		getFunc: func(ctx context.Context, userID int32, orgID *int32) ([]memories.MemoryRecord, error) {
			return nil, errors.New("db error")
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/finances", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestCreateFinanceMemorySuccess(t *testing.T) {
	var capturedContent string
	service := &mockFinanceMemoryService{
		saveFunc: func(ctx context.Context, userID int32, orgID *int32, content string) error {
			assert.Equal(t, int32(12), userID)
			require.Nil(t, orgID)
			capturedContent = content
			return nil
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/memories", strings.NewReader(`{"content":"Saving for a house"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, "Saving for a house", capturedContent)
}

func TestCreateFinanceMemoryPassesOrgContext(t *testing.T) {
	var capturedOrg *int32
	service := &mockFinanceMemoryService{
		saveFunc: func(ctx context.Context, userID int32, orgID *int32, content string) error {
			capturedOrg = orgID
			return nil
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 24)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/memories", strings.NewReader(`{"content":"Team budget context"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	require.Equal(t, http.StatusNoContent, resp.Code)
	require.NotNil(t, capturedOrg)
	assert.Equal(t, int32(24), *capturedOrg)
}

func TestCreateFinanceMemoryRejectsInvalidMemory(t *testing.T) {
	service := &mockFinanceMemoryService{
		saveFunc: func(ctx context.Context, userID int32, orgID *int32, content string) error {
			return errors.New("invalid financial memory")
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/finances/memories", strings.NewReader(`{"content":"full card number 4111"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestDeleteFinanceMemorySuccess(t *testing.T) {
	var capturedID int32
	var capturedUser int32
	var capturedOrg *int32
	service := &mockFinanceMemoryService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			capturedID = id
			capturedUser = userID
			capturedOrg = orgID
			return nil
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/finances/memories/7", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, int32(7), capturedID)
	assert.Equal(t, int32(12), capturedUser)
	assert.Nil(t, capturedOrg)
}

func TestDeleteFinanceMemoryPassesOrgContext(t *testing.T) {
	var capturedOrg *int32
	service := &mockFinanceMemoryService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			capturedOrg = orgID
			return nil
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 24)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/finances/memories/7", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	require.NotNil(t, capturedOrg)
	assert.Equal(t, int32(24), *capturedOrg)
}

func TestDeleteFinanceMemoryServiceError(t *testing.T) {
	service := &mockFinanceMemoryService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			return errors.New("delete failed")
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12}, 0)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/finances/memories/7", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestFinanceTimePointerHelpersHandleNil(t *testing.T) {
	assert.Nil(t, timePtrString(nil))
	assert.Nil(t, timePtrDate(nil))

	value := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	formatted := timePtrDate(&value)
	require.NotNil(t, formatted)
	assert.Equal(t, "2026-06-06", *formatted)
}

//go:fix inline
