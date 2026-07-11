package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	defaultPlaidTimeout       = 15 * time.Second
	plaidResponseReadLimit    = 10 << 20
	plaidTransactionSyncCount = 500
)

type PlaidClient struct {
	clientID string
	secret   string
	baseURL  string
	http     *http.Client
}

func NewPlaidClientFromEnv() (*PlaidClient, bool) {
	clientID := strings.TrimSpace(os.Getenv("PLAID_CLIENT_ID"))
	secret := strings.TrimSpace(os.Getenv("PLAID_SECRET"))
	if clientID == "" || secret == "" {
		return nil, false
	}
	return NewPlaidClient(clientID, secret, plaidBaseURL(os.Getenv("PLAID_ENV")), nil), true
}

func NewPlaidClient(clientID, secret, baseURL string, httpClient *http.Client) *PlaidClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultPlaidTimeout}
	}
	return &PlaidClient{
		clientID: strings.TrimSpace(clientID),
		secret:   strings.TrimSpace(secret),
		baseURL:  strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		http:     httpClient,
	}
}

func (c *PlaidClient) CreateLinkToken(ctx context.Context, input LinkTokenInput) (LinkTokenResult, error) {
	body := map[string]any{
		"client_name":   input.ClientName,
		"country_codes": []string{"US"},
		"language":      "en",
		"products":      []string{"transactions"},
		"user": map[string]string{
			"client_user_id": fmt.Sprintf("user-%d", input.UserID),
		},
		"transactions": map[string]int{
			"days_requested": 180,
		},
	}
	if strings.TrimSpace(input.WebhookURL) != "" {
		body["webhook"] = strings.TrimSpace(input.WebhookURL)
	}
	if strings.TrimSpace(input.RedirectURI) != "" {
		body["redirect_uri"] = strings.TrimSpace(input.RedirectURI)
	}

	var resp struct {
		LinkToken  string `json:"link_token"`
		Expiration string `json:"expiration"`
	}
	if err := c.post(ctx, "/link/token/create", body, &resp); err != nil {
		return LinkTokenResult{}, err
	}
	return LinkTokenResult{LinkToken: resp.LinkToken, Expiration: resp.Expiration}, nil
}

func (c *PlaidClient) ExchangePublicToken(ctx context.Context, publicToken string) (ExchangeResult, error) {
	var resp struct {
		AccessToken string `json:"access_token"`
		ItemID      string `json:"item_id"`
	}
	if err := c.post(ctx, "/item/public_token/exchange", map[string]any{
		"public_token": publicToken,
	}, &resp); err != nil {
		return ExchangeResult{}, err
	}
	return ExchangeResult{AccessToken: resp.AccessToken, ItemID: resp.ItemID}, nil
}

func (c *PlaidClient) SyncTransactions(ctx context.Context, input SyncInput) (SyncResult, error) {
	body := map[string]any{
		"access_token": input.AccessToken,
		"count":        plaidTransactionSyncCount,
	}
	if input.Cursor != nil && strings.TrimSpace(*input.Cursor) != "" {
		body["cursor"] = strings.TrimSpace(*input.Cursor)
	}

	var resp plaidTransactionsSyncResponse
	if err := c.post(ctx, "/transactions/sync", body, &resp); err != nil {
		return SyncResult{}, err
	}
	return resp.toSyncResult()
}

func (c *PlaidClient) GetRecurringTransactions(ctx context.Context, accessToken string) (RecurringResult, error) {
	var resp plaidRecurringResponse
	if err := c.post(ctx, "/transactions/recurring/get", map[string]any{
		"access_token": accessToken,
	}, &resp); err != nil {
		return RecurringResult{}, err
	}
	return resp.toRecurringResult()
}

func (c *PlaidClient) RemoveItem(ctx context.Context, accessToken string) error {
	return c.post(ctx, "/item/remove", map[string]any{
		"access_token": accessToken,
	}, nil)
}

func (c *PlaidClient) post(ctx context.Context, path string, body map[string]any, out any) error {
	body["client_id"] = c.clientID
	body["secret"] = c.secret
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, plaidResponseReadLimit+1))
	if err != nil {
		return err
	}
	if len(raw) > plaidResponseReadLimit {
		return fmt.Errorf("plaid %s response exceeded %d bytes", path, plaidResponseReadLimit)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("plaid %s failed with status %d: %s", path, resp.StatusCode, string(raw))
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

func plaidBaseURL(env string) string {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "production":
		return "https://production.plaid.com"
	default:
		return "https://sandbox.plaid.com"
	}
}

type plaidTransactionsSyncResponse struct {
	Accounts []plaidAccount     `json:"accounts"`
	Added    []plaidTransaction `json:"added"`
	Modified []plaidTransaction `json:"modified"`
	Removed  []struct {
		TransactionID string `json:"transaction_id"`
	} `json:"removed"`
	NextCursor string `json:"next_cursor"`
	HasMore    bool   `json:"has_more"`
}

func (r plaidTransactionsSyncResponse) toSyncResult() (SyncResult, error) {
	accounts := make([]AccountRecord, 0, len(r.Accounts))
	for _, account := range r.Accounts {
		accounts = append(accounts, account.toRecord())
	}
	removed := make([]string, 0, len(r.Removed))
	for _, item := range r.Removed {
		if item.TransactionID != "" {
			removed = append(removed, item.TransactionID)
		}
	}
	added, err := plaidTransactionsToRecords(r.Added)
	if err != nil {
		return SyncResult{}, err
	}
	modified, err := plaidTransactionsToRecords(r.Modified)
	if err != nil {
		return SyncResult{}, err
	}
	return SyncResult{
		Accounts:     accounts,
		Added:        added,
		Modified:     modified,
		RemovedIDs:   removed,
		NextCursor:   r.NextCursor,
		HasMore:      r.HasMore,
		LastSyncedAt: time.Now(),
	}, nil
}

func plaidTransactionsToRecords(items []plaidTransaction) ([]TransactionRecord, error) {
	records := make([]TransactionRecord, 0, len(items))
	for _, item := range items {
		record, err := item.toRecord()
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

type plaidAccount struct {
	AccountID string  `json:"account_id"`
	Name      string  `json:"name"`
	Mask      *string `json:"mask"`
	Type      *string `json:"type"`
	Subtype   *string `json:"subtype"`
	Balances  struct {
		Current     *float64 `json:"current"`
		Available   *float64 `json:"available"`
		ISOCurrency *string  `json:"iso_currency_code"`
	} `json:"balances"`
}

func (a plaidAccount) toRecord() AccountRecord {
	return AccountRecord{
		ProviderAccountID: a.AccountID,
		Name:              a.Name,
		Mask:              a.Mask,
		Type:              a.Type,
		Subtype:           a.Subtype,
		CurrentBalance:    a.Balances.Current,
		AvailableBalance:  a.Balances.Available,
		ISOCurrencyCode:   a.Balances.ISOCurrency,
	}
}

type plaidTransaction struct {
	AccountID               string          `json:"account_id"`
	TransactionID           string          `json:"transaction_id"`
	Amount                  float64         `json:"amount"`
	ISOCurrencyCode         *string         `json:"iso_currency_code"`
	Date                    string          `json:"date"`
	AuthorizedDate          *string         `json:"authorized_date"`
	Name                    string          `json:"name"`
	MerchantName            *string         `json:"merchant_name"`
	PersonalFinanceCategory *plaidCategory  `json:"personal_finance_category"`
	Pending                 bool            `json:"pending"`
	Raw                     json.RawMessage `json:"-"`
}

func (t *plaidTransaction) UnmarshalJSON(data []byte) error {
	type alias plaidTransaction
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*t = plaidTransaction(decoded)
	t.Raw = append(t.Raw[:0], data...)
	return nil
}

type plaidCategory struct {
	Primary  string `json:"primary"`
	Detailed string `json:"detailed"`
}

func (t plaidTransaction) toRecord() (TransactionRecord, error) {
	date, err := parsePlaidDate(t.Date)
	if err != nil {
		return TransactionRecord{}, err
	}
	var authorized *time.Time
	if t.AuthorizedDate != nil && *t.AuthorizedDate != "" {
		parsed, err := parsePlaidDate(*t.AuthorizedDate)
		if err != nil {
			return TransactionRecord{}, err
		}
		authorized = &parsed
	}
	var primary *string
	var detailed *string
	if t.PersonalFinanceCategory != nil {
		primary = emptyStringToNil(t.PersonalFinanceCategory.Primary)
		detailed = emptyStringToNil(t.PersonalFinanceCategory.Detailed)
	}
	raw := t.Raw
	if len(raw) == 0 {
		raw, err = json.Marshal(t)
		if err != nil {
			return TransactionRecord{}, fmt.Errorf("encode Plaid transaction: %w", err)
		}
	}
	return TransactionRecord{
		ProviderTransactionID: t.TransactionID,
		ProviderAccountID:     t.AccountID,
		Amount:                t.Amount,
		ISOCurrencyCode:       t.ISOCurrencyCode,
		Date:                  date,
		AuthorizedDate:        authorized,
		Name:                  t.Name,
		MerchantName:          t.MerchantName,
		PrimaryCategory:       primary,
		DetailedCategory:      detailed,
		Pending:               t.Pending,
		Raw:                   raw,
	}, nil
}

type plaidRecurringResponse struct {
	OutflowStreams []plaidRecurringStream `json:"outflow_streams"`
	InflowStreams  []plaidRecurringStream `json:"inflow_streams"`
}

func (r plaidRecurringResponse) toRecurringResult() (RecurringResult, error) {
	streams := make([]RecurringStreamRecord, 0, len(r.OutflowStreams)+len(r.InflowStreams))
	for _, stream := range r.OutflowStreams {
		record, err := stream.toRecord("outflow")
		if err != nil {
			return RecurringResult{}, err
		}
		streams = append(streams, record)
	}
	for _, stream := range r.InflowStreams {
		record, err := stream.toRecord("inflow")
		if err != nil {
			return RecurringResult{}, err
		}
		streams = append(streams, record)
	}
	return RecurringResult{Streams: streams}, nil
}

type plaidRecurringStream struct {
	StreamID     string   `json:"stream_id"`
	AccountID    string   `json:"account_id"`
	MerchantName *string  `json:"merchant_name"`
	Description  *string  `json:"description"`
	Frequency    *string  `json:"frequency"`
	LastAmount   *float64 `json:"last_amount"`
	ISOCurrency  *string  `json:"iso_currency_code"`
	LastDate     *string  `json:"last_date"`
	Status       *string  `json:"status"`
}

func (s plaidRecurringStream) toRecord(streamType string) (RecurringStreamRecord, error) {
	var lastDate *time.Time
	if s.LastDate != nil && *s.LastDate != "" {
		parsed, err := parsePlaidDate(*s.LastDate)
		if err != nil {
			return RecurringStreamRecord{}, err
		}
		lastDate = &parsed
	}
	raw, err := json.Marshal(s)
	if err != nil {
		return RecurringStreamRecord{}, fmt.Errorf("encode Plaid recurring stream: %w", err)
	}
	return RecurringStreamRecord{
		ProviderStreamID:  s.StreamID,
		ProviderAccountID: s.AccountID,
		StreamType:        streamType,
		MerchantName:      s.MerchantName,
		Description:       s.Description,
		Frequency:         s.Frequency,
		LastAmount:        s.LastAmount,
		ISOCurrencyCode:   s.ISOCurrency,
		LastDate:          lastDate,
		Status:            s.Status,
		Raw:               raw,
	}, nil
}

func parsePlaidDate(value string) (time.Time, error) {
	return time.Parse("2006-01-02", value)
}

func emptyStringToNil(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}
