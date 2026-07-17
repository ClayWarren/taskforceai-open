package finance

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	infracrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockProvider struct {
	createFunc    func(ctx context.Context, input LinkTokenInput) (LinkTokenResult, error)
	exchangeFunc  func(ctx context.Context, publicToken string) (ExchangeResult, error)
	removeFunc    func(ctx context.Context, accessToken string) error
	syncFunc      func(ctx context.Context, input SyncInput) (SyncResult, error)
	recurringFunc func(ctx context.Context, accessToken string) (RecurringResult, error)
}

func (m *mockProvider) CreateLinkToken(ctx context.Context, input LinkTokenInput) (LinkTokenResult, error) {
	if m.createFunc != nil {
		return m.createFunc(ctx, input)
	}
	return LinkTokenResult{}, nil
}

func (m *mockProvider) ExchangePublicToken(ctx context.Context, publicToken string) (ExchangeResult, error) {
	if m.exchangeFunc != nil {
		return m.exchangeFunc(ctx, publicToken)
	}
	return ExchangeResult{}, nil
}

func (m *mockProvider) SyncTransactions(ctx context.Context, input SyncInput) (SyncResult, error) {
	if m.syncFunc != nil {
		return m.syncFunc(ctx, input)
	}
	return SyncResult{NextCursor: "cursor", LastSyncedAt: time.Now()}, nil
}

func (m *mockProvider) GetRecurringTransactions(ctx context.Context, accessToken string) (RecurringResult, error) {
	if m.recurringFunc != nil {
		return m.recurringFunc(ctx, accessToken)
	}
	return RecurringResult{}, nil
}

func (m *mockProvider) RemoveItem(ctx context.Context, accessToken string) error {
	if m.removeFunc != nil {
		return m.removeFunc(ctx, accessToken)
	}
	return nil
}

type mockStore struct {
	upsertConnectionFunc   func(ctx context.Context, input UpsertConnectionInput) (ConnectionRecord, error)
	getConnectionFunc      func(ctx context.Context, input DisconnectConnectionInput) (ConnectionRecord, error)
	disconnectFunc         func(ctx context.Context, input DisconnectConnectionInput) error
	listFunc               func(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error)
	upsertAccountsFunc     func(ctx context.Context, connectionID int32, accounts []AccountRecord) error
	upsertTransactionsFunc func(ctx context.Context, connectionID int32, transactions []TransactionRecord) error
	markRemovedFunc        func(ctx context.Context, connectionID int32, transactionIDs []string) error
	updateCursorFunc       func(ctx context.Context, connectionID int32, cursor string) error
	upsertRecurringFunc    func(ctx context.Context, connectionID int32, streams []RecurringStreamRecord) error
	dashboardFunc          func(ctx context.Context, input ScopeInput) (DashboardData, error)
}

func (m *mockStore) ListConnections(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error) {
	if m.listFunc != nil {
		return m.listFunc(ctx, input)
	}
	return nil, nil
}

func (m *mockStore) GetConnection(ctx context.Context, input DisconnectConnectionInput) (ConnectionRecord, error) {
	if m.getConnectionFunc != nil {
		return m.getConnectionFunc(ctx, input)
	}
	return ConnectionRecord{}, nil
}

func (m *mockStore) UpsertConnection(ctx context.Context, input UpsertConnectionInput) (ConnectionRecord, error) {
	if m.upsertConnectionFunc != nil {
		return m.upsertConnectionFunc(ctx, input)
	}
	return ConnectionRecord{}, nil
}

func (m *mockStore) DisconnectConnection(ctx context.Context, input DisconnectConnectionInput) error {
	if m.disconnectFunc != nil {
		return m.disconnectFunc(ctx, input)
	}
	return nil
}

func (m *mockStore) UpsertAccounts(ctx context.Context, connectionID int32, accounts []AccountRecord) error {
	if m.upsertAccountsFunc != nil {
		return m.upsertAccountsFunc(ctx, connectionID, accounts)
	}
	return nil
}

func (m *mockStore) UpsertTransactions(ctx context.Context, connectionID int32, transactions []TransactionRecord) error {
	if m.upsertTransactionsFunc != nil {
		return m.upsertTransactionsFunc(ctx, connectionID, transactions)
	}
	return nil
}

func (m *mockStore) MarkTransactionsRemoved(ctx context.Context, connectionID int32, transactionIDs []string) error {
	if m.markRemovedFunc != nil {
		return m.markRemovedFunc(ctx, connectionID, transactionIDs)
	}
	return nil
}

func (m *mockStore) UpdateTransactionsCursor(ctx context.Context, connectionID int32, cursor string) error {
	if m.updateCursorFunc != nil {
		return m.updateCursorFunc(ctx, connectionID, cursor)
	}
	return nil
}

func (m *mockStore) UpsertRecurringStreams(ctx context.Context, connectionID int32, streams []RecurringStreamRecord) error {
	if m.upsertRecurringFunc != nil {
		return m.upsertRecurringFunc(ctx, connectionID, streams)
	}
	return nil
}

func (m *mockStore) GetDashboard(ctx context.Context, input ScopeInput) (DashboardData, error) {
	if m.dashboardFunc != nil {
		return m.dashboardFunc(ctx, input)
	}
	return DashboardData{}, nil
}

func TestProviderConfiguredReportsProviderAvailability(t *testing.T) {
	assert.False(t, (*Service)(nil).ProviderConfigured())
	assert.False(t, NewService(&mockStore{}, nil).ProviderConfigured())
	assert.True(t, NewService(&mockStore{}, &mockProvider{}).ProviderConfigured())
}

func TestCreateLinkTokenPassesConfiguredClientMetadata(t *testing.T) {
	t.Setenv("PLAID_CLIENT_NAME", "  TaskForce Research  ")
	t.Setenv("PLAID_WEBHOOK_URL", " https://example.com/plaid/webhook ")
	t.Setenv("PLAID_REDIRECT_URI", " taskforceai://oauth/plaid ")

	provider := &mockProvider{
		createFunc: func(ctx context.Context, input LinkTokenInput) (LinkTokenResult, error) {
			assert.Equal(t, int32(12), input.UserID)
			assert.Equal(t, "TaskForce Research", input.ClientName)
			assert.Equal(t, "https://example.com/plaid/webhook", input.WebhookURL)
			assert.Equal(t, "taskforceai://oauth/plaid", input.RedirectURI)
			return LinkTokenResult{LinkToken: "link-token", Expiration: "2026-06-06T20:00:00Z"}, nil
		},
	}

	result, err := NewService(&mockStore{}, provider).CreateLinkToken(context.Background(), ScopeInput{UserID: 12})

	require.NoError(t, err)
	assert.Equal(t, "link-token", result.LinkToken)
}

func TestFinanceClientNameDefaultsAndTrimStringPtr(t *testing.T) {
	t.Setenv("PLAID_CLIENT_NAME", "")
	assert.Equal(t, "TaskForceAI", financeClientName())

	value := "  Demo Bank  "
	trimmed := trimStringPtr(&value)
	require.NotNil(t, trimmed)
	assert.Equal(t, "Demo Bank", *trimmed)

	blank := "   "
	assert.Nil(t, trimStringPtr(&blank))
	assert.Nil(t, trimStringPtr(nil))
}

func TestCreateLinkTokenRequiresConfiguredProvider(t *testing.T) {
	_, err := NewService(&mockStore{}, nil).CreateLinkToken(context.Background(), ScopeInput{UserID: 12})

	require.ErrorIs(t, err, ErrProviderNotConfigured)
}

func TestExchangePublicTokenStoresPlaidMetadata(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	institutionID := "ins_123"
	institutionName := "Demo Bank"
	store := &mockStore{
		upsertConnectionFunc: func(ctx context.Context, input UpsertConnectionInput) (ConnectionRecord, error) {
			require.NotNil(t, input.InstitutionID)
			require.NotNil(t, input.InstitutionName)
			assert.Equal(t, institutionID, *input.InstitutionID)
			assert.Equal(t, institutionName, *input.InstitutionName)
			assert.Equal(t, "item-1", input.ProviderItemID)
			return ConnectionRecord{ID: 1}, nil
		},
	}
	provider := &mockProvider{
		exchangeFunc: func(ctx context.Context, publicToken string) (ExchangeResult, error) {
			assert.Equal(t, "public-sandbox", publicToken)
			return ExchangeResult{AccessToken: "access-token", ItemID: "item-1"}, nil
		},
	}

	_, err := NewService(store, provider).ExchangePublicToken(context.Background(), ScopeInput{UserID: 12}, "public-sandbox", ExchangeMetadata{
		InstitutionID:   &institutionID,
		InstitutionName: &institutionName,
	})

	require.NoError(t, err)
}

func TestExchangePublicTokenRejectsMissingProviderAndToken(t *testing.T) {
	_, err := NewService(&mockStore{}, nil).ExchangePublicToken(context.Background(), ScopeInput{UserID: 12}, "public-token")
	require.ErrorIs(t, err, ErrProviderNotConfigured)

	_, err = NewService(&mockStore{}, &mockProvider{}).ExchangePublicToken(context.Background(), ScopeInput{UserID: 12}, " ")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "public token is required")
}

func TestFinanceOperationsRequireTokenProtectorWhenProviderIsConfigured(t *testing.T) {
	service := NewServiceWithDependencies(&mockStore{
		listFunc: func(context.Context, ScopeInput) ([]ConnectionRecord, error) {
			return []ConnectionRecord{{ID: 1, EncryptedAccessToken: "encrypted"}}, nil
		},
	}, &mockProvider{}, nil, LinkConfig{})

	_, err := service.ExchangePublicToken(context.Background(), ScopeInput{UserID: 12}, "public-token")
	require.ErrorContains(t, err, "token protector is not configured")

	err = service.Disconnect(context.Background(), DisconnectConnectionInput{UserID: 12, ID: 1})
	require.ErrorContains(t, err, "token protector is not configured")

	err = service.Sync(context.Background(), ScopeInput{UserID: 12})
	require.ErrorContains(t, err, "token protector is not configured")
}

func TestExchangePublicTokenPropagatesProviderAndStoreErrors(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	providerErr := errors.New("plaid exchange failed")
	_, err := NewService(&mockStore{}, &mockProvider{
		exchangeFunc: func(ctx context.Context, publicToken string) (ExchangeResult, error) {
			return ExchangeResult{}, providerErr
		},
	}).ExchangePublicToken(context.Background(), ScopeInput{UserID: 12}, "public-token")
	require.ErrorIs(t, err, providerErr)

	storeErr := errors.New("connection upsert failed")
	store := &mockStore{
		upsertConnectionFunc: func(ctx context.Context, input UpsertConnectionInput) (ConnectionRecord, error) {
			return ConnectionRecord{}, storeErr
		},
	}
	_, err = NewService(store, &mockProvider{
		exchangeFunc: func(ctx context.Context, publicToken string) (ExchangeResult, error) {
			return ExchangeResult{AccessToken: "access-token", ItemID: "item-1"}, nil
		},
	}).ExchangePublicToken(context.Background(), ScopeInput{UserID: 12}, "public-token")
	require.ErrorIs(t, err, storeErr)
}

func TestExchangePublicTokenPropagatesTokenEncryptionError(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "not-a-valid-key")
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	_, err := NewService(&mockStore{}, &mockProvider{
		exchangeFunc: func(ctx context.Context, publicToken string) (ExchangeResult, error) {
			return ExchangeResult{AccessToken: "access-token", ItemID: "item-1"}, nil
		},
	}).ExchangePublicToken(context.Background(), ScopeInput{UserID: 12}, "public-token")

	require.Error(t, err)
}

func TestDashboardDelegatesToStoreWithScope(t *testing.T) {
	orgID := int32(24)
	store := &mockStore{
		dashboardFunc: func(ctx context.Context, input ScopeInput) (DashboardData, error) {
			assert.Equal(t, int32(12), input.UserID)
			require.NotNil(t, input.OrganizationID)
			assert.Equal(t, orgID, *input.OrganizationID)
			return DashboardData{
				Connections: []ConnectionRecord{{ID: 4, Provider: ProviderPlaid}},
				Accounts:    []AccountRecord{{ProviderAccountID: "account-1", Name: "Checking"}},
			}, nil
		},
	}

	result, err := NewService(store, nil).Dashboard(context.Background(), ScopeInput{
		UserID:         12,
		OrganizationID: &orgID,
	})

	require.NoError(t, err)
	require.Len(t, result.Connections, 1)
	require.Len(t, result.Accounts, 1)
	assert.Equal(t, int32(4), result.Connections[0].ID)
}

func TestDisconnectRemovesPlaidItemBeforeLocalDisconnect(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	accessToken := "access-token"
	encrypted, err := infracrypto.EncryptOAuthTokenField(&accessToken)
	require.NoError(t, err)

	var removedToken string
	var disconnected bool
	store := &mockStore{
		getConnectionFunc: func(ctx context.Context, input DisconnectConnectionInput) (ConnectionRecord, error) {
			return ConnectionRecord{ID: input.ID, EncryptedAccessToken: *encrypted, Status: StatusActive}, nil
		},
		disconnectFunc: func(ctx context.Context, input DisconnectConnectionInput) error {
			disconnected = true
			return nil
		},
	}
	provider := &mockProvider{
		removeFunc: func(ctx context.Context, token string) error {
			removedToken = token
			return nil
		},
	}

	err = NewService(store, provider).Disconnect(context.Background(), DisconnectConnectionInput{ID: 7, UserID: 12})

	require.NoError(t, err)
	assert.Equal(t, accessToken, removedToken)
	assert.True(t, disconnected)
}

func TestDisconnectStopsWhenPlaidRemoveFails(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	accessToken := "access-token"
	encrypted, err := infracrypto.EncryptOAuthTokenField(&accessToken)
	require.NoError(t, err)

	var disconnected bool
	store := &mockStore{
		getConnectionFunc: func(ctx context.Context, input DisconnectConnectionInput) (ConnectionRecord, error) {
			return ConnectionRecord{ID: input.ID, EncryptedAccessToken: *encrypted, Status: StatusActive}, nil
		},
		disconnectFunc: func(ctx context.Context, input DisconnectConnectionInput) error {
			disconnected = true
			return nil
		},
	}
	provider := &mockProvider{
		removeFunc: func(ctx context.Context, token string) error {
			return errors.New("plaid unavailable")
		},
	}

	err = NewService(store, provider).Disconnect(context.Background(), DisconnectConnectionInput{ID: 7, UserID: 12})

	require.Error(t, err)
	assert.False(t, disconnected)
}

func TestDisconnectFallsBackToLocalDisconnectWithoutProvider(t *testing.T) {
	var disconnected bool
	store := &mockStore{
		disconnectFunc: func(ctx context.Context, input DisconnectConnectionInput) error {
			assert.Equal(t, int32(7), input.ID)
			assert.Equal(t, int32(12), input.UserID)
			disconnected = true
			return nil
		},
	}

	err := NewService(store, nil).Disconnect(context.Background(), DisconnectConnectionInput{ID: 7, UserID: 12})

	require.NoError(t, err)
	assert.True(t, disconnected)
}

func TestDisconnectSkipsPlaidRemoveWhenStoredTokenIsEmpty(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	emptyToken := " "
	encrypted, err := infracrypto.EncryptOAuthTokenField(&emptyToken)
	require.NoError(t, err)

	var removeCalled bool
	var disconnected bool
	store := &mockStore{
		getConnectionFunc: func(ctx context.Context, input DisconnectConnectionInput) (ConnectionRecord, error) {
			return ConnectionRecord{ID: input.ID, EncryptedAccessToken: *encrypted, Status: StatusActive}, nil
		},
		disconnectFunc: func(ctx context.Context, input DisconnectConnectionInput) error {
			disconnected = true
			return nil
		},
	}
	provider := &mockProvider{
		removeFunc: func(ctx context.Context, token string) error {
			removeCalled = true
			return nil
		},
	}

	err = NewService(store, provider).Disconnect(context.Background(), DisconnectConnectionInput{ID: 7, UserID: 12})

	require.NoError(t, err)
	assert.False(t, removeCalled)
	assert.True(t, disconnected)
}

func TestDisconnectPropagatesLookupDecryptAndLocalDisconnectErrors(t *testing.T) {
	t.Run("lookup", func(t *testing.T) {
		expected := errors.New("connection unavailable")
		store := &mockStore{
			getConnectionFunc: func(ctx context.Context, input DisconnectConnectionInput) (ConnectionRecord, error) {
				return ConnectionRecord{}, expected
			},
		}

		err := NewService(store, &mockProvider{}).Disconnect(context.Background(), DisconnectConnectionInput{ID: 7, UserID: 12})

		require.ErrorIs(t, err, expected)
	})

	t.Run("decrypt", func(t *testing.T) {
		store := &mockStore{
			getConnectionFunc: func(ctx context.Context, input DisconnectConnectionInput) (ConnectionRecord, error) {
				return ConnectionRecord{ID: input.ID, EncryptedAccessToken: "not-encrypted", Status: StatusActive}, nil
			},
		}

		err := NewService(store, &mockProvider{}).Disconnect(context.Background(), DisconnectConnectionInput{ID: 7, UserID: 12})

		require.Error(t, err)
	})

	t.Run("local disconnect", func(t *testing.T) {
		t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
		t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")
		token := "access-token"
		encrypted, err := infracrypto.EncryptOAuthTokenField(&token)
		require.NoError(t, err)
		expected := errors.New("disconnect failed")
		store := &mockStore{
			getConnectionFunc: func(ctx context.Context, input DisconnectConnectionInput) (ConnectionRecord, error) {
				return ConnectionRecord{ID: input.ID, EncryptedAccessToken: *encrypted, Status: StatusActive}, nil
			},
			disconnectFunc: func(ctx context.Context, input DisconnectConnectionInput) error {
				return expected
			},
		}

		err = NewService(store, &mockProvider{}).Disconnect(context.Background(), DisconnectConnectionInput{ID: 7, UserID: 12})

		require.ErrorIs(t, err, expected)
	})
}

func TestSyncIgnoresRecurringTransactionErrorsAfterTransactionSync(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	accessToken := "access-token"
	encrypted, err := infracrypto.EncryptOAuthTokenField(&accessToken)
	require.NoError(t, err)

	store := &mockStore{
		listFunc: func(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error) {
			return []ConnectionRecord{{ID: 4, Provider: ProviderPlaid, EncryptedAccessToken: *encrypted}}, nil
		},
		upsertRecurringFunc: func(ctx context.Context, connectionID int32, streams []RecurringStreamRecord) error {
			t.Fatal("recurring streams should not be upserted after provider error")
			return nil
		},
	}
	provider := &mockProvider{
		recurringFunc: func(ctx context.Context, token string) (RecurringResult, error) {
			assert.Equal(t, accessToken, token)
			return RecurringResult{}, errors.New("recurring unavailable")
		},
	}

	err = NewService(store, provider).Sync(context.Background(), ScopeInput{UserID: 12})

	require.NoError(t, err)
}

func TestSyncRequiresProviderAndPropagatesListError(t *testing.T) {
	err := NewService(&mockStore{}, nil).Sync(context.Background(), ScopeInput{UserID: 12})
	require.ErrorIs(t, err, ErrProviderNotConfigured)

	expected := errors.New("list failed")
	store := &mockStore{
		listFunc: func(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error) {
			return nil, expected
		},
	}

	err = NewService(store, &mockProvider{}).Sync(context.Background(), ScopeInput{UserID: 12})
	require.ErrorIs(t, err, expected)
}

func TestSyncPropagatesConnectionAndStoreWriteErrors(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")
	accessToken := "access-token"
	encrypted, err := infracrypto.EncryptOAuthTokenField(&accessToken)
	require.NoError(t, err)

	makeStore := func(mutate func(*mockStore)) *mockStore {
		store := &mockStore{
			listFunc: func(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error) {
				return []ConnectionRecord{{ID: 4, Provider: ProviderPlaid, EncryptedAccessToken: *encrypted}}, nil
			},
		}
		mutate(store)
		return store
	}
	makeProvider := func() *mockProvider {
		return &mockProvider{
			syncFunc: func(ctx context.Context, input SyncInput) (SyncResult, error) {
				return SyncResult{
					Accounts:   []AccountRecord{{ProviderAccountID: "account-1"}},
					Added:      []TransactionRecord{{ProviderTransactionID: "tx-added"}},
					Modified:   []TransactionRecord{{ProviderTransactionID: "tx-modified"}},
					RemovedIDs: []string{"tx-removed"},
					NextCursor: "cursor-1",
				}, nil
			},
		}
	}

	tests := []struct {
		name   string
		mutate func(*mockStore, error)
	}{
		{
			name: "upsert accounts",
			mutate: func(store *mockStore, expected error) {
				store.upsertAccountsFunc = func(ctx context.Context, connectionID int32, accounts []AccountRecord) error {
					return expected
				}
			},
		},
		{
			name: "upsert added transactions",
			mutate: func(store *mockStore, expected error) {
				store.upsertTransactionsFunc = func(ctx context.Context, connectionID int32, transactions []TransactionRecord) error {
					if len(transactions) == 1 && transactions[0].ProviderTransactionID == "tx-added" {
						return expected
					}
					return nil
				}
			},
		},
		{
			name: "upsert modified transactions",
			mutate: func(store *mockStore, expected error) {
				store.upsertTransactionsFunc = func(ctx context.Context, connectionID int32, transactions []TransactionRecord) error {
					if len(transactions) == 1 && transactions[0].ProviderTransactionID == "tx-modified" {
						return expected
					}
					return nil
				}
			},
		},
		{
			name: "mark removed",
			mutate: func(store *mockStore, expected error) {
				store.markRemovedFunc = func(ctx context.Context, connectionID int32, transactionIDs []string) error {
					return expected
				}
			},
		},
		{
			name: "update cursor",
			mutate: func(store *mockStore, expected error) {
				store.updateCursorFunc = func(ctx context.Context, connectionID int32, cursor string) error {
					return expected
				}
			},
		},
		{
			name: "upsert recurring",
			mutate: func(store *mockStore, expected error) {
				store.upsertRecurringFunc = func(ctx context.Context, connectionID int32, streams []RecurringStreamRecord) error {
					return expected
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			expected := fmt.Errorf("%s failed", tt.name)
			store := makeStore(func(store *mockStore) {
				tt.mutate(store, expected)
			})
			provider := makeProvider()
			if tt.name == "upsert recurring" {
				provider.recurringFunc = func(ctx context.Context, accessToken string) (RecurringResult, error) {
					return RecurringResult{Streams: []RecurringStreamRecord{{ProviderStreamID: "stream-1"}}}, nil
				}
			}

			err := NewService(store, provider).Sync(context.Background(), ScopeInput{UserID: 12})

			require.ErrorIs(t, err, expected)
		})
	}
}

func TestSyncPropagatesProviderAndDecryptErrors(t *testing.T) {
	t.Run("provider sync", func(t *testing.T) {
		t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
		t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")
		accessToken := "access-token"
		encrypted, err := infracrypto.EncryptOAuthTokenField(&accessToken)
		require.NoError(t, err)
		expected := errors.New("sync failed")
		store := &mockStore{
			listFunc: func(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error) {
				return []ConnectionRecord{{ID: 4, Provider: ProviderPlaid, EncryptedAccessToken: *encrypted}}, nil
			},
		}
		provider := &mockProvider{
			syncFunc: func(ctx context.Context, input SyncInput) (SyncResult, error) {
				return SyncResult{}, expected
			},
		}

		err = NewService(store, provider).Sync(context.Background(), ScopeInput{UserID: 12})
		require.ErrorIs(t, err, expected)
	})

	t.Run("decrypt", func(t *testing.T) {
		store := &mockStore{
			listFunc: func(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error) {
				return []ConnectionRecord{{ID: 4, Provider: ProviderPlaid, EncryptedAccessToken: "not-encrypted"}}, nil
			},
		}

		err := NewService(store, &mockProvider{}).Sync(context.Background(), ScopeInput{UserID: 12})
		require.Error(t, err)
	})
}

func TestSyncProcessesPagedTransactionsAndRecurringStreams(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	accessToken := "access-token"
	encrypted, err := infracrypto.EncryptOAuthTokenField(&accessToken)
	require.NoError(t, err)

	initialCursor := "cursor-0"
	var syncInputs []SyncInput
	var accountIDs []string
	var transactionIDs []string
	var removedIDs []string
	var cursors []string
	var recurringStreams []RecurringStreamRecord
	store := &mockStore{
		listFunc: func(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error) {
			assert.Equal(t, int32(12), input.UserID)
			return []ConnectionRecord{{
				ID:                   4,
				Provider:             ProviderPlaid,
				EncryptedAccessToken: *encrypted,
				TransactionsCursor:   &initialCursor,
			}}, nil
		},
		upsertAccountsFunc: func(ctx context.Context, connectionID int32, accounts []AccountRecord) error {
			assert.Equal(t, int32(4), connectionID)
			for _, account := range accounts {
				accountIDs = append(accountIDs, account.ProviderAccountID)
			}
			return nil
		},
		upsertTransactionsFunc: func(ctx context.Context, connectionID int32, transactions []TransactionRecord) error {
			assert.Equal(t, int32(4), connectionID)
			for _, tx := range transactions {
				transactionIDs = append(transactionIDs, tx.ProviderTransactionID)
			}
			return nil
		},
		markRemovedFunc: func(ctx context.Context, connectionID int32, ids []string) error {
			assert.Equal(t, int32(4), connectionID)
			removedIDs = append(removedIDs, ids...)
			return nil
		},
		updateCursorFunc: func(ctx context.Context, connectionID int32, cursor string) error {
			assert.Equal(t, int32(4), connectionID)
			cursors = append(cursors, cursor)
			return nil
		},
		upsertRecurringFunc: func(ctx context.Context, connectionID int32, streams []RecurringStreamRecord) error {
			assert.Equal(t, int32(4), connectionID)
			recurringStreams = append(recurringStreams, streams...)
			return nil
		},
	}
	provider := &mockProvider{
		syncFunc: func(ctx context.Context, input SyncInput) (SyncResult, error) {
			syncInputs = append(syncInputs, input)
			if len(syncInputs) == 1 {
				return SyncResult{
					Accounts:   []AccountRecord{{ProviderAccountID: "account-1"}},
					Added:      []TransactionRecord{{ProviderTransactionID: "tx-added"}},
					Modified:   []TransactionRecord{{ProviderTransactionID: "tx-modified"}},
					RemovedIDs: []string{"tx-removed"},
					NextCursor: "cursor-1",
					HasMore:    true,
				}, nil
			}
			return SyncResult{
				Accounts:   []AccountRecord{{ProviderAccountID: "account-2"}},
				Added:      []TransactionRecord{{ProviderTransactionID: "tx-added-2"}},
				NextCursor: "cursor-2",
			}, nil
		},
		recurringFunc: func(ctx context.Context, token string) (RecurringResult, error) {
			assert.Equal(t, accessToken, token)
			return RecurringResult{Streams: []RecurringStreamRecord{{ProviderStreamID: "stream-1"}}}, nil
		},
	}

	err = NewService(store, provider).Sync(context.Background(), ScopeInput{UserID: 12})

	require.NoError(t, err)
	require.Len(t, syncInputs, 2)
	require.NotNil(t, syncInputs[0].Cursor)
	assert.Equal(t, "cursor-0", *syncInputs[0].Cursor)
	require.NotNil(t, syncInputs[1].Cursor)
	assert.Equal(t, "cursor-1", *syncInputs[1].Cursor)
	assert.Equal(t, []string{"account-1", "account-2"}, accountIDs)
	assert.Equal(t, []string{"tx-added", "tx-modified", "tx-added-2"}, transactionIDs)
	assert.Equal(t, []string{"tx-removed"}, removedIDs)
	assert.Equal(t, []string{"cursor-1", "cursor-2"}, cursors)
	require.Len(t, recurringStreams, 1)
	assert.Equal(t, "stream-1", recurringStreams[0].ProviderStreamID)
}

func TestPlaidTransactionRawPreservesUnknownFields(t *testing.T) {
	var tx plaidTransaction
	err := tx.UnmarshalJSON([]byte(`{"account_id":"acct","transaction_id":"tx","amount":10.5,"date":"2026-06-06","name":"Coffee","pending":false,"unknown_field":"kept"}`))
	require.NoError(t, err)

	record, err := tx.toRecord()
	require.NoError(t, err)
	assert.Contains(t, string(record.Raw), `"unknown_field":"kept"`)
}
