package finance

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newFinanceDBMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()

	mock, err := pgxmock.NewPool()
	require.NoError(t, err)
	t.Cleanup(func() {
		assert.NoError(t, mock.ExpectationsWereMet())
		mock.Close()
	})
	return mock
}

func financialConnectionColumns() []string {
	return []string{
		"id",
		"user_id",
		"organization_id",
		"provider",
		"provider_item_id",
		"encrypted_access_token",
		"status",
		"products",
		"transactions_cursor",
		"institution_id",
		"institution_name",
		"last_synced_at",
		"created_at",
		"updated_at",
	}
}

func TestSQLStoreConnectionLookupUpsertAndDisconnect(t *testing.T) {
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	orgID := int32(24)
	cursor := "cursor-1"
	institutionID := "ins_123"
	institutionName := "Demo Bank"

	t.Run("get connection", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		mock.ExpectQuery("SELECT id, user_id, organization_id, provider, provider_item_id").
			WithArgs(int32(7), int32(12), &orgID).
			WillReturnRows(pgxmock.NewRows(financialConnectionColumns()).AddRow(
				int32(7),
				int32(12),
				&orgID,
				ProviderPlaid,
				"item-1",
				"encrypted-token",
				StatusActive,
				[]string{"transactions"},
				&cursor,
				&institutionID,
				&institutionName,
				&now,
				now,
				now,
			))

		connection, err := store.GetConnection(context.Background(), DisconnectConnectionInput{
			ID:             7,
			UserID:         12,
			OrganizationID: &orgID,
		})

		require.NoError(t, err)
		assert.Equal(t, int32(7), connection.ID)
		assert.Equal(t, ProviderPlaid, connection.Provider)
		require.NotNil(t, connection.InstitutionName)
		assert.Equal(t, institutionName, *connection.InstitutionName)
	})

	t.Run("upsert connection", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		mock.ExpectQuery("INSERT INTO financial_connections").
			WithArgs(
				int32(12),
				&orgID,
				ProviderPlaid,
				"item-1",
				"encrypted-token",
				[]string{"transactions", "recurring_transactions"},
				&institutionID,
				&institutionName,
			).
			WillReturnRows(pgxmock.NewRows(financialConnectionColumns()).AddRow(
				int32(7),
				int32(12),
				&orgID,
				ProviderPlaid,
				"item-1",
				"encrypted-token",
				StatusActive,
				[]string{"transactions", "recurring_transactions"},
				&cursor,
				&institutionID,
				&institutionName,
				&now,
				now,
				now,
			))

		connection, err := store.UpsertConnection(context.Background(), UpsertConnectionInput{
			UserID:               12,
			OrganizationID:       &orgID,
			Provider:             ProviderPlaid,
			ProviderItemID:       "item-1",
			EncryptedAccessToken: "encrypted-token",
			Products:             []string{"transactions", "recurring_transactions"},
			InstitutionID:        &institutionID,
			InstitutionName:      &institutionName,
		})

		require.NoError(t, err)
		assert.Equal(t, int32(7), connection.ID)
		assert.Equal(t, []string{"transactions", "recurring_transactions"}, connection.Products)
	})

	t.Run("disconnect connection", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		mock.ExpectExec("UPDATE financial_connections").
			WithArgs(int32(7), int32(12), &orgID).
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))

		err := store.DisconnectConnection(context.Background(), DisconnectConnectionInput{
			ID:             7,
			UserID:         12,
			OrganizationID: &orgID,
		})

		require.NoError(t, err)
	})
}

func TestSQLStoreGetDashboardReturnsEmptyWhenNoConnections(t *testing.T) {
	mock := newFinanceDBMock(t)
	store := NewSQLStore(mock)
	mock.ExpectQuery("SELECT id, user_id, organization_id, provider, provider_item_id").
		WithArgs(int32(12), (*int32)(nil)).
		WillReturnRows(pgxmock.NewRows(financialConnectionColumns()))

	dashboard, err := store.GetDashboard(context.Background(), ScopeInput{UserID: 12})

	require.NoError(t, err)
	assert.Empty(t, dashboard.Connections)
	assert.Empty(t, dashboard.Accounts)
	assert.Empty(t, dashboard.RecentTransactions)
	assert.Empty(t, dashboard.RecurringStreams)
}

func TestSQLStoreGetDashboardLoadsFinancialDataForScopedConnections(t *testing.T) {
	mock := newFinanceDBMock(t)
	store := NewSQLStore(mock)
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	orgID := int32(24)
	cursor := "cursor-1"
	institutionID := "ins_123"
	institutionName := "Demo Bank"
	mask := "1234"
	accountType := "depository"
	accountSubtype := "checking"
	currentBalance := 120.5
	availableBalance := 100.25
	currency := "USD"
	authorizedDate := now.Add(-24 * time.Hour)
	merchant := "Cafe"
	primary := "FOOD_AND_DRINK"
	detailed := "FOOD_AND_DRINK_COFFEE"
	raw := []byte(`{"transaction_id":"tx-1"}`)
	streamDescription := "Monthly rent"
	streamFrequency := "monthly"
	streamAmount := 2000.0
	streamStatus := "active"

	mock.ExpectQuery("SELECT id, user_id, organization_id, provider, provider_item_id").
		WithArgs(int32(12), &orgID).
		WillReturnRows(pgxmock.NewRows(financialConnectionColumns()).AddRow(
			int32(4),
			int32(12),
			&orgID,
			ProviderPlaid,
			"item-1",
			"encrypted-token",
			StatusActive,
			[]string{"transactions", "recurring_transactions"},
			&cursor,
			&institutionID,
			&institutionName,
			&now,
			now,
			now,
		))
	mock.ExpectQuery("SELECT provider_account_id, name, mask, type, subtype").
		WithArgs([]int32{4}).
		WillReturnRows(pgxmock.NewRows([]string{
			"provider_account_id",
			"name",
			"mask",
			"type",
			"subtype",
			"current_balance",
			"available_balance",
			"iso_currency_code",
		}).AddRow(
			"account-1",
			"Checking",
			&mask,
			&accountType,
			&accountSubtype,
			&currentBalance,
			&availableBalance,
			&currency,
		))
	mock.ExpectQuery("SELECT provider_transaction_id, provider_account_id, amount").
		WithArgs([]int32{4}).
		WillReturnRows(pgxmock.NewRows([]string{
			"provider_transaction_id",
			"provider_account_id",
			"amount",
			"iso_currency_code",
			"date",
			"authorized_date",
			"name",
			"merchant_name",
			"primary_category",
			"detailed_category",
			"pending",
			"raw",
		}).AddRow(
			"tx-1",
			"account-1",
			24.5,
			&currency,
			now,
			&authorizedDate,
			"Coffee",
			&merchant,
			&primary,
			&detailed,
			false,
			raw,
		))
	mock.ExpectQuery("SELECT provider_stream_id, provider_account_id, stream_type").
		WithArgs([]int32{4}).
		WillReturnRows(pgxmock.NewRows([]string{
			"provider_stream_id",
			"provider_account_id",
			"stream_type",
			"merchant_name",
			"description",
			"frequency",
			"last_amount",
			"iso_currency_code",
			"last_date",
			"status",
			"raw",
		}).AddRow(
			"stream-1",
			"account-1",
			"outflow",
			&merchant,
			&streamDescription,
			&streamFrequency,
			&streamAmount,
			&currency,
			&now,
			&streamStatus,
			[]byte(`{"stream_id":"stream-1"}`),
		))

	dashboard, err := store.GetDashboard(context.Background(), ScopeInput{
		UserID:         12,
		OrganizationID: &orgID,
	})

	require.NoError(t, err)
	require.Len(t, dashboard.Connections, 1)
	assert.Equal(t, int32(4), dashboard.Connections[0].ID)
	assert.Equal(t, "Demo Bank", *dashboard.Connections[0].InstitutionName)
	require.Len(t, dashboard.Accounts, 1)
	assert.Equal(t, "Checking", dashboard.Accounts[0].Name)
	require.Len(t, dashboard.RecentTransactions, 1)
	assert.Equal(t, "tx-1", dashboard.RecentTransactions[0].ProviderTransactionID)
	assert.Equal(t, "FOOD_AND_DRINK", *dashboard.RecentTransactions[0].PrimaryCategory)
	require.Len(t, dashboard.RecurringStreams, 1)
	assert.Equal(t, "stream-1", dashboard.RecurringStreams[0].ProviderStreamID)
}

func TestSQLStoreWritesFinancialSyncData(t *testing.T) {
	mock := newFinanceDBMock(t)
	store := NewSQLStore(mock)
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	mask := "1234"
	accountType := "depository"
	accountSubtype := "checking"
	currentBalance := 120.5
	availableBalance := 100.25
	currency := "USD"
	authorizedDate := now.Add(-24 * time.Hour)
	merchant := "Cafe"
	primary := "FOOD_AND_DRINK"
	detailed := "FOOD_AND_DRINK_COFFEE"
	streamDescription := "Monthly rent"
	streamFrequency := "monthly"
	streamAmount := 2000.0
	streamStatus := "active"

	mock.ExpectExec("INSERT INTO financial_accounts").
		WithArgs(
			int32(4),
			pgxmock.AnyArg(),
		).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec("INSERT INTO financial_transactions").
		WithArgs(
			int32(4),
			pgxmock.AnyArg(),
		).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec("UPDATE financial_transactions").
		WithArgs(int32(4), []string{"tx-removed"}).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectExec("UPDATE financial_connections").
		WithArgs(int32(4), "cursor-2").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectExec("INSERT INTO financial_recurring_streams").
		WithArgs(
			int32(4),
			"stream-1",
			"account-1",
			"outflow",
			&merchant,
			&streamDescription,
			&streamFrequency,
			&streamAmount,
			&currency,
			&now,
			&streamStatus,
			[]byte(`{"stream_id":"stream-1"}`),
		).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	err := store.UpsertAccounts(context.Background(), 4, []AccountRecord{{
		ProviderAccountID: "account-1",
		Name:              "Checking",
		Mask:              &mask,
		Type:              &accountType,
		Subtype:           &accountSubtype,
		CurrentBalance:    &currentBalance,
		AvailableBalance:  &availableBalance,
		ISOCurrencyCode:   &currency,
	}})
	require.NoError(t, err)

	err = store.UpsertTransactions(context.Background(), 4, []TransactionRecord{{
		ProviderTransactionID: "tx-1",
		ProviderAccountID:     "account-1",
		Amount:                24.5,
		ISOCurrencyCode:       &currency,
		Date:                  now,
		AuthorizedDate:        &authorizedDate,
		Name:                  "Coffee",
		MerchantName:          &merchant,
		PrimaryCategory:       &primary,
		DetailedCategory:      &detailed,
		Raw:                   []byte(`{"transaction_id":"tx-1"}`),
	}})
	require.NoError(t, err)

	require.NoError(t, store.MarkTransactionsRemoved(context.Background(), 4, []string{"tx-removed"}))
	require.NoError(t, store.UpdateTransactionsCursor(context.Background(), 4, "cursor-2"))
	require.NoError(t, store.UpsertRecurringStreams(context.Background(), 4, []RecurringStreamRecord{{
		ProviderStreamID:  "stream-1",
		ProviderAccountID: "account-1",
		StreamType:        "outflow",
		MerchantName:      &merchant,
		Description:       &streamDescription,
		Frequency:         &streamFrequency,
		LastAmount:        &streamAmount,
		ISOCurrencyCode:   &currency,
		LastDate:          &now,
		Status:            &streamStatus,
		Raw:               []byte(`{"stream_id":"stream-1"}`),
	}}))
}

func TestSQLStoreBatchWritesEdgeCases(t *testing.T) {
	ctx := context.Background()
	store := NewSQLStore(newFinanceDBMock(t))

	// Empty batches short-circuit before any database call.
	require.NoError(t, store.UpsertAccounts(ctx, 4, nil))
	require.NoError(t, store.UpsertTransactions(ctx, 4, nil))
	require.NoError(t, store.MarkTransactionsRemoved(ctx, 4, nil))

	// A NaN numeric value fails json.Marshal before the database call.
	nan := math.NaN()
	require.Error(t, store.UpsertAccounts(ctx, 4, []AccountRecord{{ProviderAccountID: "a", CurrentBalance: &nan}}))
	require.Error(t, store.UpsertTransactions(ctx, 4, []TransactionRecord{{ProviderTransactionID: "t", Amount: nan}}))
}

func TestSQLStoreWriteMethodsPropagateExecErrors(t *testing.T) {
	storeErr := assert.AnError

	t.Run("upsert accounts", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		mock.ExpectExec("INSERT INTO financial_accounts").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnError(storeErr)

		err := store.UpsertAccounts(context.Background(), 4, []AccountRecord{{ProviderAccountID: "account-1"}})

		require.ErrorIs(t, err, storeErr)
	})

	t.Run("upsert transactions", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		mock.ExpectExec("INSERT INTO financial_transactions").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnError(storeErr)

		err := store.UpsertTransactions(context.Background(), 4, []TransactionRecord{{ProviderTransactionID: "tx-1"}})

		require.ErrorIs(t, err, storeErr)
	})

	t.Run("mark removed", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		mock.ExpectExec("UPDATE financial_transactions").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnError(storeErr)

		err := store.MarkTransactionsRemoved(context.Background(), 4, []string{"tx-1"})

		require.ErrorIs(t, err, storeErr)
	})

	t.Run("upsert recurring streams", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		mock.ExpectExec("INSERT INTO financial_recurring_streams").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnError(storeErr)

		err := store.UpsertRecurringStreams(context.Background(), 4, []RecurringStreamRecord{{ProviderStreamID: "stream-1"}})

		require.ErrorIs(t, err, storeErr)
	})
}

func TestSQLStoreListAndDashboardErrorBranches(t *testing.T) {
	t.Run("list connections query error", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		mock.ExpectQuery("SELECT id, user_id, organization_id, provider, provider_item_id").
			WithArgs(int32(12), (*int32)(nil)).
			WillReturnError(assert.AnError)

		_, err := store.GetDashboard(context.Background(), ScopeInput{UserID: 12})

		require.Error(t, err)
	})

	t.Run("list connections scan error", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		mock.ExpectQuery("SELECT id, user_id, organization_id, provider, provider_item_id").
			WithArgs(int32(12), (*int32)(nil)).
			WillReturnRows(pgxmock.NewRows(financialConnectionColumns()).AddRow(
				"bad-id", int32(12), (*int32)(nil), ProviderPlaid, "item-1", "encrypted-token",
				StatusActive, []string{"transactions"}, (*string)(nil), (*string)(nil), (*string)(nil),
				(*time.Time)(nil), time.Now(), time.Now(),
			))

		_, err := store.ListConnections(context.Background(), ScopeInput{UserID: 12})

		require.Error(t, err)
	})

	t.Run("dashboard accounts query error", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		expectDashboardConnection(mock)
		mock.ExpectQuery("SELECT provider_account_id, name, mask, type, subtype").
			WithArgs([]int32{4}).
			WillReturnError(assert.AnError)

		_, err := store.GetDashboard(context.Background(), ScopeInput{UserID: 12})

		require.Error(t, err)
	})

	t.Run("dashboard accounts scan error", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		expectDashboardConnection(mock)
		mock.ExpectQuery("SELECT provider_account_id, name, mask, type, subtype").
			WithArgs([]int32{4}).
			WillReturnRows(pgxmock.NewRows(financialAccountColumns()).AddRow(
				"account-1", "Checking", (*string)(nil), (*string)(nil), (*string)(nil), (*float64)(nil), (*float64)(nil), (*string)(nil),
			).RowError(0, assert.AnError))

		_, err := store.GetDashboard(context.Background(), ScopeInput{UserID: 12})

		require.Error(t, err)
	})

	t.Run("dashboard transactions query error", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		expectDashboardConnection(mock)
		expectEmptyAccounts(mock)
		mock.ExpectQuery("SELECT provider_transaction_id, provider_account_id, amount").
			WithArgs([]int32{4}).
			WillReturnError(assert.AnError)

		_, err := store.GetDashboard(context.Background(), ScopeInput{UserID: 12})

		require.Error(t, err)
	})

	t.Run("dashboard transactions scan error", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		expectDashboardConnection(mock)
		expectEmptyAccounts(mock)
		mock.ExpectQuery("SELECT provider_transaction_id, provider_account_id, amount").
			WithArgs([]int32{4}).
			WillReturnRows(pgxmock.NewRows(financialTransactionColumns()).AddRow(
				"tx-1", "account-1", "bad-amount", (*string)(nil), time.Now(), (*time.Time)(nil),
				"Coffee", (*string)(nil), (*string)(nil), (*string)(nil), false, []byte(`{}`),
			))

		_, err := store.GetDashboard(context.Background(), ScopeInput{UserID: 12})

		require.Error(t, err)
	})

	t.Run("dashboard recurring query error", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		expectDashboardConnection(mock)
		expectEmptyAccounts(mock)
		expectEmptyTransactions(mock)
		mock.ExpectQuery("SELECT provider_stream_id, provider_account_id, stream_type").
			WithArgs([]int32{4}).
			WillReturnError(assert.AnError)

		_, err := store.GetDashboard(context.Background(), ScopeInput{UserID: 12})

		require.Error(t, err)
	})

	t.Run("dashboard recurring scan error", func(t *testing.T) {
		mock := newFinanceDBMock(t)
		store := NewSQLStore(mock)
		expectDashboardConnection(mock)
		expectEmptyAccounts(mock)
		expectEmptyTransactions(mock)
		mock.ExpectQuery("SELECT provider_stream_id, provider_account_id, stream_type").
			WithArgs([]int32{4}).
			WillReturnRows(pgxmock.NewRows(financialRecurringStreamColumns()).AddRow(
				"stream-1", "account-1", 123, (*string)(nil), (*string)(nil), (*string)(nil),
				(*float64)(nil), (*string)(nil), (*time.Time)(nil), (*string)(nil), []byte(`{}`),
			).RowError(0, assert.AnError))

		_, err := store.GetDashboard(context.Background(), ScopeInput{UserID: 12})

		require.Error(t, err)
	})
}

func expectDashboardConnection(mock pgxmock.PgxPoolIface) {
	now := time.Date(2026, 6, 6, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT id, user_id, organization_id, provider, provider_item_id").
		WithArgs(int32(12), (*int32)(nil)).
		WillReturnRows(pgxmock.NewRows(financialConnectionColumns()).AddRow(
			int32(4),
			int32(12),
			(*int32)(nil),
			ProviderPlaid,
			"item-1",
			"encrypted-token",
			StatusActive,
			[]string{"transactions"},
			(*string)(nil),
			(*string)(nil),
			(*string)(nil),
			(*time.Time)(nil),
			now,
			now,
		))
}

func financialAccountColumns() []string {
	return []string{"provider_account_id", "name", "mask", "type", "subtype", "current_balance", "available_balance", "iso_currency_code"}
}

func financialTransactionColumns() []string {
	return []string{"provider_transaction_id", "provider_account_id", "amount", "iso_currency_code", "date", "authorized_date", "name", "merchant_name", "primary_category", "detailed_category", "pending", "raw"}
}

func financialRecurringStreamColumns() []string {
	return []string{"provider_stream_id", "provider_account_id", "stream_type", "merchant_name", "description", "frequency", "last_amount", "iso_currency_code", "last_date", "status", "raw"}
}

func expectEmptyAccounts(mock pgxmock.PgxPoolIface) {
	mock.ExpectQuery("SELECT provider_account_id, name, mask, type, subtype").
		WithArgs([]int32{4}).
		WillReturnRows(pgxmock.NewRows(financialAccountColumns()))
}

func expectEmptyTransactions(mock pgxmock.PgxPoolIface) {
	mock.ExpectQuery("SELECT provider_transaction_id, provider_account_id, amount").
		WithArgs([]int32{4}).
		WillReturnRows(pgxmock.NewRows(financialTransactionColumns()))
}
