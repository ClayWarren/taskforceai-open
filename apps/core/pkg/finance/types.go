package finance

import (
	"context"
	"time"
)

const (
	ProviderPlaid = "plaid"
	StatusActive  = "active"
)

type Provider interface {
	CreateLinkToken(ctx context.Context, input LinkTokenInput) (LinkTokenResult, error)
	ExchangePublicToken(ctx context.Context, publicToken string) (ExchangeResult, error)
	SyncTransactions(ctx context.Context, input SyncInput) (SyncResult, error)
	GetRecurringTransactions(ctx context.Context, accessToken string) (RecurringResult, error)
	RemoveItem(ctx context.Context, accessToken string) error
}

type Store interface {
	ListConnections(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error)
	GetConnection(ctx context.Context, input DisconnectConnectionInput) (ConnectionRecord, error)
	UpsertConnection(ctx context.Context, input UpsertConnectionInput) (ConnectionRecord, error)
	DisconnectConnection(ctx context.Context, input DisconnectConnectionInput) error
	UpsertAccounts(ctx context.Context, connectionID int32, accounts []AccountRecord) error
	UpsertTransactions(ctx context.Context, connectionID int32, transactions []TransactionRecord) error
	MarkTransactionsRemoved(ctx context.Context, connectionID int32, transactionIDs []string) error
	UpdateTransactionsCursor(ctx context.Context, connectionID int32, cursor string) error
	UpsertRecurringStreams(ctx context.Context, connectionID int32, streams []RecurringStreamRecord) error
	GetDashboard(ctx context.Context, input ScopeInput) (DashboardData, error)
}

type ScopeInput struct {
	UserID         int32
	OrganizationID *int32
}

type LinkTokenInput struct {
	UserID      int32
	ClientName  string
	WebhookURL  string
	RedirectURI string
}

type LinkTokenResult struct {
	LinkToken  string
	Expiration string
}

type ExchangeResult struct {
	AccessToken     string
	ItemID          string
	InstitutionID   *string
	InstitutionName *string
}

type ExchangeMetadata struct {
	InstitutionID   *string
	InstitutionName *string
}

type SyncInput struct {
	AccessToken string
	Cursor      *string
}

type SyncResult struct {
	Accounts     []AccountRecord
	Added        []TransactionRecord
	Modified     []TransactionRecord
	RemovedIDs   []string
	NextCursor   string
	HasMore      bool
	LastSyncedAt time.Time
}

type RecurringResult struct {
	Streams []RecurringStreamRecord
}

type ConnectionRecord struct {
	ID                   int32
	UserID               int32
	OrganizationID       *int32
	Provider             string
	ProviderItemID       string
	EncryptedAccessToken string
	Status               string
	Products             []string
	TransactionsCursor   *string
	InstitutionID        *string
	InstitutionName      *string
	LastSyncedAt         *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type UpsertConnectionInput struct {
	UserID               int32
	OrganizationID       *int32
	Provider             string
	ProviderItemID       string
	EncryptedAccessToken string
	Products             []string
	InstitutionID        *string
	InstitutionName      *string
}

type DisconnectConnectionInput struct {
	ID             int32
	UserID         int32
	OrganizationID *int32
}

type AccountRecord struct {
	ProviderAccountID string
	Name              string
	Mask              *string
	Type              *string
	Subtype           *string
	CurrentBalance    *float64
	AvailableBalance  *float64
	ISOCurrencyCode   *string
}

type TransactionRecord struct {
	ProviderTransactionID string
	ProviderAccountID     string
	Amount                float64
	ISOCurrencyCode       *string
	Date                  time.Time
	AuthorizedDate        *time.Time
	Name                  string
	MerchantName          *string
	PrimaryCategory       *string
	DetailedCategory      *string
	Pending               bool
	Raw                   []byte
}

type RecurringStreamRecord struct {
	ProviderStreamID  string
	ProviderAccountID string
	StreamType        string
	MerchantName      *string
	Description       *string
	Frequency         *string
	LastAmount        *float64
	ISOCurrencyCode   *string
	LastDate          *time.Time
	Status            *string
	Raw               []byte
}

type DashboardData struct {
	Connections        []ConnectionRecord
	Accounts           []AccountRecord
	RecentTransactions []TransactionRecord
	RecurringStreams   []RecurringStreamRecord
}
