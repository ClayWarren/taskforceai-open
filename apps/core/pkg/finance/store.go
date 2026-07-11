package finance

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5"
)

type SQLStore struct {
	db db.DBTX
}

func NewSQLStore(dbtx db.DBTX) *SQLStore {
	return &SQLStore{db: dbtx}
}

type accountBatchRow struct {
	ProviderAccountID string   `json:"provider_account_id"`
	Name              string   `json:"name"`
	Mask              *string  `json:"mask"`
	Type              *string  `json:"type"`
	Subtype           *string  `json:"subtype"`
	CurrentBalance    *float64 `json:"current_balance"`
	AvailableBalance  *float64 `json:"available_balance"`
	ISOCurrencyCode   *string  `json:"iso_currency_code"`
}

type transactionBatchRow struct {
	ProviderTransactionID string          `json:"provider_transaction_id"`
	ProviderAccountID     string          `json:"provider_account_id"`
	Amount                float64         `json:"amount"`
	ISOCurrencyCode       *string         `json:"iso_currency_code"`
	Date                  string          `json:"date"`
	AuthorizedDate        *string         `json:"authorized_date"`
	Name                  string          `json:"name"`
	MerchantName          *string         `json:"merchant_name"`
	PrimaryCategory       *string         `json:"primary_category"`
	DetailedCategory      *string         `json:"detailed_category"`
	Pending               bool            `json:"pending"`
	Raw                   json.RawMessage `json:"raw"`
}

func accountBatchRows(accounts []AccountRecord) []accountBatchRow {
	rows := make([]accountBatchRow, len(accounts))
	for i, account := range accounts {
		rows[i] = accountBatchRow(account)
	}
	return rows
}

func transactionBatchRows(transactions []TransactionRecord) []transactionBatchRow {
	rows := make([]transactionBatchRow, len(transactions))
	for i, tx := range transactions {
		rows[i] = transactionBatchRow{
			ProviderTransactionID: tx.ProviderTransactionID,
			ProviderAccountID:     tx.ProviderAccountID,
			Amount:                tx.Amount,
			ISOCurrencyCode:       tx.ISOCurrencyCode,
			Date:                  dateString(tx.Date),
			AuthorizedDate:        optionalDateString(tx.AuthorizedDate),
			Name:                  tx.Name,
			MerchantName:          tx.MerchantName,
			PrimaryCategory:       tx.PrimaryCategory,
			DetailedCategory:      tx.DetailedCategory,
			Pending:               tx.Pending,
			Raw:                   rawMessageOrNil(tx.Raw),
		}
	}
	return rows
}

func rawMessageOrNil(raw []byte) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	return json.RawMessage(raw)
}

func dateString(value time.Time) string {
	return value.Format(time.DateOnly)
}

func optionalDateString(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := dateString(*value)
	return &formatted
}

func (s *SQLStore) ListConnections(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, user_id, organization_id, provider, provider_item_id, encrypted_access_token,
		       status, products, transactions_cursor, institution_id, institution_name,
		       last_synced_at, created_at, updated_at
		FROM financial_connections
		WHERE user_id = $1
		  AND (($2::integer IS NULL AND organization_id IS NULL) OR organization_id = $2)
		  AND status = 'active'
		ORDER BY created_at DESC
	`, input.UserID, input.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanConnections(rows)
}

func (s *SQLStore) GetConnection(ctx context.Context, input DisconnectConnectionInput) (ConnectionRecord, error) {
	row := s.db.QueryRow(ctx, `
		SELECT id, user_id, organization_id, provider, provider_item_id, encrypted_access_token,
		       status, products, transactions_cursor, institution_id, institution_name,
		       last_synced_at, created_at, updated_at
		FROM financial_connections
		WHERE id = $1
		  AND user_id = $2
		  AND (($3::integer IS NULL AND organization_id IS NULL) OR organization_id = $3)
		  AND status = 'active'
	`, input.ID, input.UserID, input.OrganizationID)
	return scanConnection(row)
}

func (s *SQLStore) UpsertConnection(ctx context.Context, input UpsertConnectionInput) (ConnectionRecord, error) {
	row := s.db.QueryRow(ctx, `
		INSERT INTO financial_connections (
			user_id, organization_id, provider, provider_item_id, encrypted_access_token,
			status, products, institution_id, institution_name, updated_at
		) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, CURRENT_TIMESTAMP)
		ON CONFLICT (provider, provider_item_id) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			organization_id = EXCLUDED.organization_id,
			encrypted_access_token = EXCLUDED.encrypted_access_token,
			status = 'active',
			products = EXCLUDED.products,
			institution_id = EXCLUDED.institution_id,
			institution_name = EXCLUDED.institution_name,
			updated_at = CURRENT_TIMESTAMP
		RETURNING id, user_id, organization_id, provider, provider_item_id, encrypted_access_token,
		          status, products, transactions_cursor, institution_id, institution_name,
		          last_synced_at, created_at, updated_at
	`, input.UserID, input.OrganizationID, input.Provider, input.ProviderItemID, input.EncryptedAccessToken,
		input.Products, input.InstitutionID, input.InstitutionName)
	return scanConnection(row)
}

func (s *SQLStore) DisconnectConnection(ctx context.Context, input DisconnectConnectionInput) error {
	_, err := s.db.Exec(ctx, `
		UPDATE financial_connections
		SET status = 'disconnected', encrypted_access_token = '', updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
		  AND user_id = $2
		  AND (($3::integer IS NULL AND organization_id IS NULL) OR organization_id = $3)
	`, input.ID, input.UserID, input.OrganizationID)
	return err
}

func (s *SQLStore) UpsertAccounts(ctx context.Context, connectionID int32, accounts []AccountRecord) error {
	if len(accounts) == 0 {
		return nil
	}

	payload, err := json.Marshal(accountBatchRows(accounts))
	if err != nil {
		return err
	}

	_, err = s.db.Exec(ctx, `
		WITH input AS (
			SELECT *
			FROM jsonb_to_recordset($2::jsonb) AS rows (
				provider_account_id text,
				name text,
				mask text,
				type text,
				subtype text,
				current_balance numeric,
				available_balance numeric,
				iso_currency_code text
			)
		)
		INSERT INTO financial_accounts (
			connection_id, provider_account_id, name, mask, type, subtype,
			current_balance, available_balance, iso_currency_code, updated_at
		)
		SELECT
			$1,
			provider_account_id,
			name,
			mask,
			type,
			subtype,
			current_balance,
			available_balance,
			iso_currency_code,
			CURRENT_TIMESTAMP
		FROM input
		ON CONFLICT (connection_id, provider_account_id) DO UPDATE SET
			name = EXCLUDED.name,
			mask = EXCLUDED.mask,
			type = EXCLUDED.type,
			subtype = EXCLUDED.subtype,
			current_balance = EXCLUDED.current_balance,
			available_balance = EXCLUDED.available_balance,
			iso_currency_code = EXCLUDED.iso_currency_code,
			updated_at = CURRENT_TIMESTAMP
	`, connectionID, string(payload))
	return err
}

func (s *SQLStore) UpsertTransactions(ctx context.Context, connectionID int32, transactions []TransactionRecord) error {
	if len(transactions) == 0 {
		return nil
	}

	payload, err := json.Marshal(transactionBatchRows(transactions))
	if err != nil {
		return err
	}

	_, err = s.db.Exec(ctx, `
		WITH input AS (
			SELECT *
			FROM jsonb_to_recordset($2::jsonb) AS rows (
				provider_transaction_id text,
				provider_account_id text,
				amount numeric,
				iso_currency_code text,
				date date,
				authorized_date date,
				name text,
				merchant_name text,
				primary_category text,
				detailed_category text,
				pending boolean,
				raw jsonb
			)
		)
		INSERT INTO financial_transactions (
			connection_id, provider_transaction_id, provider_account_id, amount,
			iso_currency_code, date, authorized_date, name, merchant_name,
			primary_category, detailed_category, pending, removed, raw, updated_at
		)
		SELECT
			$1,
			provider_transaction_id,
			provider_account_id,
			amount,
			iso_currency_code,
			date,
			authorized_date,
			name,
			merchant_name,
			primary_category,
			detailed_category,
			pending,
			false,
			raw,
			CURRENT_TIMESTAMP
		FROM input
		ON CONFLICT (connection_id, provider_transaction_id) DO UPDATE SET
			provider_account_id = EXCLUDED.provider_account_id,
			amount = EXCLUDED.amount,
			iso_currency_code = EXCLUDED.iso_currency_code,
			date = EXCLUDED.date,
			authorized_date = EXCLUDED.authorized_date,
			name = EXCLUDED.name,
			merchant_name = EXCLUDED.merchant_name,
			primary_category = EXCLUDED.primary_category,
			detailed_category = EXCLUDED.detailed_category,
			pending = EXCLUDED.pending,
			removed = false,
			raw = EXCLUDED.raw,
			updated_at = CURRENT_TIMESTAMP
	`, connectionID, string(payload))
	return err
}

func (s *SQLStore) MarkTransactionsRemoved(ctx context.Context, connectionID int32, transactionIDs []string) error {
	if len(transactionIDs) == 0 {
		return nil
	}

	_, err := s.db.Exec(ctx, `
		UPDATE financial_transactions
		SET removed = true, updated_at = CURRENT_TIMESTAMP
		WHERE connection_id = $1 AND provider_transaction_id = ANY($2::text[])
	`, connectionID, transactionIDs)
	return err
}

func (s *SQLStore) UpdateTransactionsCursor(ctx context.Context, connectionID int32, cursor string) error {
	_, err := s.db.Exec(ctx, `
		UPDATE financial_connections
		SET transactions_cursor = $2, last_synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, connectionID, cursor)
	return err
}

func (s *SQLStore) UpsertRecurringStreams(ctx context.Context, connectionID int32, streams []RecurringStreamRecord) error {
	for _, stream := range streams {
		if _, err := s.db.Exec(ctx, `
			INSERT INTO financial_recurring_streams (
				connection_id, provider_stream_id, provider_account_id, stream_type,
				merchant_name, description, frequency, last_amount, iso_currency_code,
				last_date, status, raw, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
			ON CONFLICT (connection_id, provider_stream_id) DO UPDATE SET
				provider_account_id = EXCLUDED.provider_account_id,
				stream_type = EXCLUDED.stream_type,
				merchant_name = EXCLUDED.merchant_name,
				description = EXCLUDED.description,
				frequency = EXCLUDED.frequency,
				last_amount = EXCLUDED.last_amount,
				iso_currency_code = EXCLUDED.iso_currency_code,
				last_date = EXCLUDED.last_date,
				status = EXCLUDED.status,
				raw = EXCLUDED.raw,
				updated_at = CURRENT_TIMESTAMP
		`, connectionID, stream.ProviderStreamID, stream.ProviderAccountID, stream.StreamType,
			stream.MerchantName, stream.Description, stream.Frequency, stream.LastAmount,
			stream.ISOCurrencyCode, stream.LastDate, stream.Status, stream.Raw); err != nil {
			return err
		}
	}
	return nil
}

func (s *SQLStore) GetDashboard(ctx context.Context, input ScopeInput) (DashboardData, error) {
	connections, err := s.ListConnections(ctx, input)
	if err != nil {
		return DashboardData{}, err
	}
	if len(connections) == 0 {
		return DashboardData{}, nil
	}
	ids := make([]int32, 0, len(connections))
	for _, connection := range connections {
		ids = append(ids, connection.ID)
	}

	accounts, err := s.listAccounts(ctx, ids)
	if err != nil {
		return DashboardData{}, err
	}
	transactions, err := s.listRecentTransactions(ctx, ids)
	if err != nil {
		return DashboardData{}, err
	}
	streams, err := s.listRecurringStreams(ctx, ids)
	if err != nil {
		return DashboardData{}, err
	}
	return DashboardData{
		Connections:        connections,
		Accounts:           accounts,
		RecentTransactions: transactions,
		RecurringStreams:   streams,
	}, nil
}

func (s *SQLStore) listAccounts(ctx context.Context, connectionIDs []int32) ([]AccountRecord, error) {
	rows, err := s.db.Query(ctx, `
		SELECT provider_account_id, name, mask, type, subtype, current_balance::float8,
		       available_balance::float8, iso_currency_code
		FROM financial_accounts
		WHERE connection_id = ANY($1)
		ORDER BY name ASC
	`, connectionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []AccountRecord
	for rows.Next() {
		var account AccountRecord
		if err := rows.Scan(&account.ProviderAccountID, &account.Name, &account.Mask, &account.Type,
			&account.Subtype, &account.CurrentBalance, &account.AvailableBalance, &account.ISOCurrencyCode); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

func (s *SQLStore) listRecentTransactions(ctx context.Context, connectionIDs []int32) ([]TransactionRecord, error) {
	rows, err := s.db.Query(ctx, `
		SELECT provider_transaction_id, provider_account_id, amount::float8, iso_currency_code,
		       date::timestamp, authorized_date::timestamp, name, merchant_name,
		       primary_category, detailed_category, pending, raw
		FROM financial_transactions
		WHERE connection_id = ANY($1) AND removed = false
		ORDER BY date DESC, id DESC
		LIMIT 50
	`, connectionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transactions []TransactionRecord
	for rows.Next() {
		record, err := scanTransaction(rows)
		if err != nil {
			return nil, err
		}
		transactions = append(transactions, record)
	}
	return transactions, rows.Err()
}

func (s *SQLStore) listRecurringStreams(ctx context.Context, connectionIDs []int32) ([]RecurringStreamRecord, error) {
	rows, err := s.db.Query(ctx, `
		SELECT provider_stream_id, provider_account_id, stream_type, merchant_name,
		       description, frequency, last_amount::float8, iso_currency_code,
		       last_date::timestamp, status, raw
		FROM financial_recurring_streams
		WHERE connection_id = ANY($1)
		ORDER BY merchant_name ASC NULLS LAST, description ASC NULLS LAST
	`, connectionIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var streams []RecurringStreamRecord
	for rows.Next() {
		var stream RecurringStreamRecord
		if err := rows.Scan(&stream.ProviderStreamID, &stream.ProviderAccountID, &stream.StreamType,
			&stream.MerchantName, &stream.Description, &stream.Frequency, &stream.LastAmount,
			&stream.ISOCurrencyCode, &stream.LastDate, &stream.Status, &stream.Raw); err != nil {
			return nil, err
		}
		streams = append(streams, stream)
	}
	return streams, rows.Err()
}

func scanConnections(rows pgx.Rows) ([]ConnectionRecord, error) {
	var records []ConnectionRecord
	for rows.Next() {
		record, err := scanConnection(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

type connectionScanner interface {
	Scan(dest ...any) error
}

func scanConnection(row connectionScanner) (ConnectionRecord, error) {
	var record ConnectionRecord
	if err := row.Scan(
		&record.ID,
		&record.UserID,
		&record.OrganizationID,
		&record.Provider,
		&record.ProviderItemID,
		&record.EncryptedAccessToken,
		&record.Status,
		&record.Products,
		&record.TransactionsCursor,
		&record.InstitutionID,
		&record.InstitutionName,
		&record.LastSyncedAt,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return ConnectionRecord{}, fmt.Errorf("scan financial connection: %w", err)
	}
	return record, nil
}

func scanTransaction(row connectionScanner) (TransactionRecord, error) {
	var record TransactionRecord
	if err := row.Scan(
		&record.ProviderTransactionID,
		&record.ProviderAccountID,
		&record.Amount,
		&record.ISOCurrencyCode,
		&record.Date,
		&record.AuthorizedDate,
		&record.Name,
		&record.MerchantName,
		&record.PrimaryCategory,
		&record.DetailedCategory,
		&record.Pending,
		&record.Raw,
	); err != nil {
		return TransactionRecord{}, fmt.Errorf("scan financial transaction: %w", err)
	}
	return record, nil
}
