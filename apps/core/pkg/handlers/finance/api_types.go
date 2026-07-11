package finance

type FinanceMemoryResponse struct {
	ID      int32  `json:"id" doc:"Unique identifier for the financial memory"`
	Content string `json:"content" doc:"Financial context saved by the user"`
	Type    string `json:"type" doc:"Memory type"`
}

type FinancePrivacyResponse struct {
	ConnectedAccountsAvailable bool     `json:"connected_accounts_available"`
	CanMutateAccounts          bool     `json:"can_mutate_accounts"`
	TrainingControls           string   `json:"training_controls"`
	DataControls               []string `json:"data_controls"`
}

type FinanceDashboardResponse struct {
	ConnectedAccounts  bool                         `json:"connected_accounts"`
	ProviderStatus     string                       `json:"provider_status"`
	Memories           []FinanceMemoryResponse      `json:"memories"`
	Capabilities       []string                     `json:"capabilities"`
	Connections        []FinanceConnectionResponse  `json:"connections"`
	Accounts           []FinanceAccountResponse     `json:"accounts"`
	RecentTransactions []FinanceTransactionResponse `json:"recent_transactions"`
	RecurringStreams   []FinanceRecurringResponse   `json:"recurring_streams"`
	Privacy            FinancePrivacyResponse       `json:"privacy"`
}

type CreateFinanceMemoryRequest struct {
	Content string `json:"content" maxLength:"280" doc:"Goal, obligation, or other financial context to remember"`
}

type CreateFinanceLinkTokenResponse struct {
	LinkToken  string `json:"link_token"`
	Expiration string `json:"expiration"`
}

type ExchangeFinancePublicTokenRequest struct {
	PublicToken     string  `json:"public_token" minLength:"1"`
	InstitutionID   *string `json:"institution_id,omitempty"`
	InstitutionName *string `json:"institution_name,omitempty"`
}

type FinanceConnectionResponse struct {
	ID              int32   `json:"id"`
	Provider        string  `json:"provider"`
	InstitutionName *string `json:"institution_name,omitempty"`
	LastSyncedAt    *string `json:"last_synced_at,omitempty"`
}

type FinanceAccountResponse struct {
	ProviderAccountID string   `json:"provider_account_id"`
	Name              string   `json:"name"`
	Mask              *string  `json:"mask,omitempty"`
	Type              *string  `json:"type,omitempty"`
	Subtype           *string  `json:"subtype,omitempty"`
	CurrentBalance    *float64 `json:"current_balance,omitempty"`
	AvailableBalance  *float64 `json:"available_balance,omitempty"`
	ISOCurrencyCode   *string  `json:"iso_currency_code,omitempty"`
}

type FinanceTransactionResponse struct {
	ProviderTransactionID string  `json:"provider_transaction_id"`
	ProviderAccountID     string  `json:"provider_account_id"`
	Amount                float64 `json:"amount"`
	ISOCurrencyCode       *string `json:"iso_currency_code,omitempty"`
	Date                  string  `json:"date"`
	Name                  string  `json:"name"`
	MerchantName          *string `json:"merchant_name,omitempty"`
	PrimaryCategory       *string `json:"primary_category,omitempty"`
	DetailedCategory      *string `json:"detailed_category,omitempty"`
	Pending               bool    `json:"pending"`
}

type FinanceRecurringResponse struct {
	ProviderStreamID  string   `json:"provider_stream_id"`
	ProviderAccountID string   `json:"provider_account_id"`
	StreamType        string   `json:"stream_type"`
	MerchantName      *string  `json:"merchant_name,omitempty"`
	Description       *string  `json:"description,omitempty"`
	Frequency         *string  `json:"frequency,omitempty"`
	LastAmount        *float64 `json:"last_amount,omitempty"`
	ISOCurrencyCode   *string  `json:"iso_currency_code,omitempty"`
	LastDate          *string  `json:"last_date,omitempty"`
	Status            *string  `json:"status,omitempty"`
}
