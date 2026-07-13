package finance

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewPlaidClientFromEnvRequiresCredentials(t *testing.T) {
	t.Setenv("PLAID_CLIENT_ID", "")
	t.Setenv("PLAID_SECRET", "secret")

	client, ok := NewPlaidClientFromEnv()

	assert.False(t, ok)
	assert.Nil(t, client)
}

func TestNewPlaidClientFromEnvUsesConfiguredEnvironment(t *testing.T) {
	t.Setenv("PLAID_CLIENT_ID", " client-id ")
	t.Setenv("PLAID_SECRET", " secret ")
	t.Setenv("PLAID_ENV", " production ")

	client, ok := NewPlaidClientFromEnv()

	require.True(t, ok)
	require.NotNil(t, client)
	assert.Equal(t, "client-id", client.clientID)
	assert.Equal(t, "secret", client.secret)
	assert.Equal(t, "https://production.plaid.com", client.baseURL)
}

func TestPlaidBaseURLDefaultsToSandbox(t *testing.T) {
	assert.Equal(t, "https://production.plaid.com", plaidBaseURL(" production "))
	assert.Equal(t, "https://sandbox.plaid.com", plaidBaseURL("DEVELOPMENT"))
	assert.Equal(t, "https://sandbox.plaid.com", plaidBaseURL(""))
	assert.Equal(t, "https://sandbox.plaid.com", plaidBaseURL("invalid"))
}

func TestPlaidCreateLinkTokenPostsExpectedPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/link/token/create", r.URL.Path)
		assert.Equal(t, "application/json", r.Header.Get("Content-Type"))

		var payload struct {
			ClientID     string   `json:"client_id"`
			Secret       string   `json:"secret"`
			ClientName   string   `json:"client_name"`
			CountryCodes []string `json:"country_codes"`
			Language     string   `json:"language"`
			Products     []string `json:"products"`
			User         struct {
				ClientUserID string `json:"client_user_id"`
			} `json:"user"`
			Transactions struct {
				DaysRequested int `json:"days_requested"`
			} `json:"transactions"`
			Webhook     string `json:"webhook"`
			RedirectURI string `json:"redirect_uri"`
		}
		if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload)) {
			return
		}
		assert.Equal(t, "client-id", payload.ClientID)
		assert.Equal(t, "secret", payload.Secret)
		assert.Equal(t, "TaskForceAI", payload.ClientName)
		assert.Equal(t, []string{"US"}, payload.CountryCodes)
		assert.Equal(t, "en", payload.Language)
		assert.Equal(t, []string{"transactions"}, payload.Products)
		assert.Equal(t, "user-12", payload.User.ClientUserID)
		assert.Equal(t, 180, payload.Transactions.DaysRequested)
		assert.Equal(t, "https://example.com/plaid", payload.Webhook)
		assert.Equal(t, "taskforceai://oauth/plaid", payload.RedirectURI)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"link_token":"link-sandbox","expiration":"2026-06-06T20:00:00Z"}`))
	}))
	defer server.Close()

	client := NewPlaidClient("client-id", "secret", server.URL+"/", server.Client())
	result, err := client.CreateLinkToken(context.Background(), LinkTokenInput{
		UserID:      12,
		ClientName:  "TaskForceAI",
		WebhookURL:  " https://example.com/plaid ",
		RedirectURI: " taskforceai://oauth/plaid ",
	})

	require.NoError(t, err)
	assert.Equal(t, "link-sandbox", result.LinkToken)
	assert.Equal(t, "2026-06-06T20:00:00Z", result.Expiration)
}

func TestPlaidExchangePublicTokenPostsExpectedPayload(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/item/public_token/exchange", r.URL.Path)

		var payload struct {
			ClientID    string `json:"client_id"`
			Secret      string `json:"secret"`
			PublicToken string `json:"public_token"`
		}
		if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload)) {
			return
		}
		assert.Equal(t, "client-id", payload.ClientID)
		assert.Equal(t, "secret", payload.Secret)
		assert.Equal(t, "public-sandbox", payload.PublicToken)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"access-token","item_id":"item-1"}`))
	}))
	defer server.Close()

	client := NewPlaidClient("client-id", "secret", server.URL, server.Client())
	result, err := client.ExchangePublicToken(context.Background(), "public-sandbox")

	require.NoError(t, err)
	assert.Equal(t, "access-token", result.AccessToken)
	assert.Equal(t, "item-1", result.ItemID)
}

func TestPlaidPostReturnsDecodeAndTransportErrors(t *testing.T) {
	t.Run("invalid json response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_, _ = w.Write([]byte(`{`))
		}))
		defer server.Close()

		client := NewPlaidClient("client-id", "secret", server.URL, server.Client())
		_, err := client.CreateLinkToken(context.Background(), LinkTokenInput{UserID: 12, ClientName: "TaskForceAI"})

		require.Error(t, err)
		assert.Contains(t, err.Error(), "unexpected")
	})

	t.Run("request create error", func(t *testing.T) {
		client := NewPlaidClient("client-id", "secret", "://bad-url", nil)
		_, err := client.ExchangePublicToken(context.Background(), "public-token")

		require.Error(t, err)
	})

	t.Run("request send error", func(t *testing.T) {
		client := NewPlaidClient("client-id", "secret", "https://plaid.test", &http.Client{
			Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return nil, errors.New("transport failed")
			}),
		})

		_, err := client.SyncTransactions(context.Background(), SyncInput{AccessToken: "access-token"})

		require.Error(t, err)
	})

	t.Run("response read error", func(t *testing.T) {
		client := NewPlaidClient("client-id", "secret", "https://plaid.test", &http.Client{
			Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       readErrorCloser{},
				}, nil
			}),
		})

		_, err := client.GetRecurringTransactions(context.Background(), "access-token")

		require.Error(t, err)
	})

	t.Run("request body marshal error", func(t *testing.T) {
		client := NewPlaidClient("client-id", "secret", "https://plaid.test", nil)

		err := client.post(context.Background(), "/bad", map[string]any{"bad": func() {}}, nil)

		require.Error(t, err)
	})

	t.Run("response exceeds read limit", func(t *testing.T) {
		client := NewPlaidClient("client-id", "secret", "https://plaid.test", &http.Client{
			Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: http.StatusOK,
					Body:       io.NopCloser(repeatByteReader{}),
				}, nil
			}),
		})

		err := client.post(context.Background(), "/big", map[string]any{}, nil)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "exceeded")
	})
}

// repeatByteReader yields an unbounded stream of a single byte, used to
// simulate a response larger than the read limit.
type repeatByteReader struct{}

func (repeatByteReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'a'
	}
	return len(p), nil
}

func TestPlaidSyncTransactionsMapsProviderResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/transactions/sync", r.URL.Path)

		var payload struct {
			ClientID    string `json:"client_id"`
			Secret      string `json:"secret"`
			AccessToken string `json:"access_token"`
			Count       int    `json:"count"`
			Cursor      string `json:"cursor"`
		}
		if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload)) {
			return
		}
		assert.Equal(t, "client-id", payload.ClientID)
		assert.Equal(t, "secret", payload.Secret)
		assert.Equal(t, "access-token", payload.AccessToken)
		assert.Equal(t, 500, payload.Count)
		assert.Equal(t, "cursor-old", payload.Cursor)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"accounts": [{
				"account_id": "account-1",
				"name": "Checking",
				"mask": "1234",
				"type": "depository",
				"subtype": "checking",
				"balances": {
					"current": 120.5,
					"available": 100.25,
					"iso_currency_code": "USD"
				}
			}],
			"added": [{
				"account_id": "account-1",
				"transaction_id": "tx-added",
				"amount": 24.5,
				"iso_currency_code": "USD",
				"date": "2026-06-06",
				"authorized_date": "2026-06-05",
				"name": "Coffee",
				"merchant_name": "Cafe",
				"personal_finance_category": {
					"primary": "FOOD_AND_DRINK",
					"detailed": "FOOD_AND_DRINK_COFFEE"
				},
				"pending": false,
				"unknown_field": "preserved"
			}],
			"modified": [{
				"account_id": "account-1",
				"transaction_id": "tx-modified",
				"amount": -1200,
				"date": "2026-06-01",
				"name": "Payroll",
				"pending": false
			}],
			"removed": [{"transaction_id": ""}, {"transaction_id": "tx-removed"}],
			"next_cursor": "cursor-new",
			"has_more": true
		}`))
	}))
	defer server.Close()

	cursor := " cursor-old "
	client := NewPlaidClient("client-id", "secret", server.URL, server.Client())
	result, err := client.SyncTransactions(context.Background(), SyncInput{
		AccessToken: "access-token",
		Cursor:      &cursor,
	})

	require.NoError(t, err)
	require.Len(t, result.Accounts, 1)
	assert.Equal(t, "account-1", result.Accounts[0].ProviderAccountID)
	assert.Equal(t, "Checking", result.Accounts[0].Name)
	require.Len(t, result.Added, 1)
	assert.Equal(t, "tx-added", result.Added[0].ProviderTransactionID)
	assert.Equal(t, "FOOD_AND_DRINK", *result.Added[0].PrimaryCategory)
	assert.Contains(t, string(result.Added[0].Raw), `"unknown_field"`)
	assert.Contains(t, string(result.Added[0].Raw), `"preserved"`)
	require.Len(t, result.Modified, 1)
	assert.Equal(t, "tx-modified", result.Modified[0].ProviderTransactionID)
	assert.Equal(t, []string{"tx-removed"}, result.RemovedIDs)
	assert.Equal(t, "cursor-new", result.NextCursor)
	assert.True(t, result.HasMore)
}

func TestPlaidSyncTransactionsAllowsLargeProviderResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/transactions/sync", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"accounts": [],
			"added": [{
				"account_id": "account-1",
				"transaction_id": "tx-large",
				"amount": 24.5,
				"date": "2026-06-06",
				"name": "Large transaction",
				"pending": false,
				"provider_payload": "` + strings.Repeat("x", 1<<20) + `"
			}],
			"modified": [],
			"removed": [],
			"next_cursor": "cursor-new",
			"has_more": false
		}`))
	}))
	defer server.Close()

	client := NewPlaidClient("client-id", "secret", server.URL, server.Client())
	result, err := client.SyncTransactions(context.Background(), SyncInput{AccessToken: "access-token"})

	require.NoError(t, err)
	require.Len(t, result.Added, 1)
	assert.Equal(t, "tx-large", result.Added[0].ProviderTransactionID)
	assert.Equal(t, "cursor-new", result.NextCursor)
	assert.Contains(t, string(result.Added[0].Raw), `"provider_payload"`)
}

func TestPlaidRecurringTransactionsMapsInflowAndOutflowStreams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/transactions/recurring/get", r.URL.Path)

		var payload struct {
			AccessToken string `json:"access_token"`
		}
		if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&payload)) {
			return
		}
		assert.Equal(t, "access-token", payload.AccessToken)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"outflow_streams": [{
				"stream_id": "stream-out",
				"account_id": "account-1",
				"merchant_name": "Rent",
				"description": "Monthly rent",
				"frequency": "monthly",
				"last_amount": 2000,
				"iso_currency_code": "USD",
				"last_date": "2026-06-01",
				"status": "active"
			}],
			"inflow_streams": [{
				"stream_id": "stream-in",
				"account_id": "account-1",
				"description": "Payroll",
				"frequency": "biweekly",
				"last_amount": -1200,
				"last_date": "2026-06-05"
			}]
		}`))
	}))
	defer server.Close()

	client := NewPlaidClient("client-id", "secret", server.URL, server.Client())
	result, err := client.GetRecurringTransactions(context.Background(), "access-token")

	require.NoError(t, err)
	require.Len(t, result.Streams, 2)
	assert.Equal(t, "stream-out", result.Streams[0].ProviderStreamID)
	assert.Equal(t, "outflow", result.Streams[0].StreamType)
	assert.Equal(t, "Rent", *result.Streams[0].MerchantName)
	require.NotNil(t, result.Streams[0].LastDate)
	assert.Equal(t, "stream-in", result.Streams[1].ProviderStreamID)
	assert.Equal(t, "inflow", result.Streams[1].StreamType)
}

func TestPlaidMappingRejectsInvalidDates(t *testing.T) {
	_, err := plaidTransactionsSyncResponse{
		Added: []plaidTransaction{{
			AccountID:     "account-1",
			TransactionID: "tx-1",
			Date:          "not-a-date",
			Name:          "Coffee",
		}},
	}.toSyncResult()
	require.Error(t, err)

	authorized := "not-a-date"
	_, err = plaidTransaction{
		AccountID:      "account-1",
		TransactionID:  "tx-1",
		Date:           "2026-06-06",
		AuthorizedDate: &authorized,
		Name:           "Coffee",
	}.toRecord()
	require.Error(t, err)

	lastDate := "not-a-date"
	_, err = plaidRecurringResponse{
		OutflowStreams: []plaidRecurringStream{{StreamID: "stream-1", LastDate: &lastDate}},
	}.toRecurringResult()
	require.Error(t, err)

	_, err = plaidTransactionsSyncResponse{
		Modified: []plaidTransaction{{
			AccountID:     "account-1",
			TransactionID: "tx-1",
			Date:          "not-a-date",
			Name:          "Coffee",
		}},
	}.toSyncResult()
	require.Error(t, err)

	_, err = plaidRecurringResponse{
		InflowStreams: []plaidRecurringStream{{StreamID: "stream-2", LastDate: &lastDate}},
	}.toRecurringResult()
	require.Error(t, err)
}

func TestPlaidTransactionUnmarshalRejectsInvalidJSON(t *testing.T) {
	var tx plaidTransaction

	err := tx.UnmarshalJSON([]byte(`{`))

	require.Error(t, err)
}

func TestPlaidRecordHelpersHandleEmptyOptionalValues(t *testing.T) {
	assert.Nil(t, emptyStringToNil(" "))
	value := emptyStringToNil(" category ")
	require.NotNil(t, value)
	assert.Equal(t, " category ", *value)

	record, err := plaidTransaction{
		AccountID:     "account-1",
		TransactionID: "tx-1",
		Date:          "2026-06-06",
		Name:          "Coffee",
		PersonalFinanceCategory: &plaidCategory{
			Primary:  " ",
			Detailed: "FOOD_AND_DRINK_COFFEE",
		},
	}.toRecord()
	require.NoError(t, err)
	assert.Nil(t, record.PrimaryCategory)
	require.NotNil(t, record.DetailedCategory)
	assert.Equal(t, "FOOD_AND_DRINK_COFFEE", *record.DetailedCategory)
	assert.NotEmpty(t, record.Raw)
}

func TestPlaidRecordHelpersRejectUnencodableNumbers(t *testing.T) {
	_, err := plaidTransaction{
		AccountID:     "account-1",
		TransactionID: "tx-1",
		Amount:        math.NaN(),
		Date:          "2026-06-06",
	}.toRecord()
	require.ErrorContains(t, err, "encode Plaid transaction")

	notANumber := math.NaN()
	_, err = (plaidRecurringStream{
		StreamID:   "stream-1",
		AccountID:  "account-1",
		LastAmount: &notANumber,
	}).toRecord("outflow")
	require.ErrorContains(t, err, "encode Plaid recurring stream")
}

func TestPlaidRemoveItemReturnsProviderErrorBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/item/remove", r.URL.Path)
		http.Error(w, `{"error_code":"INVALID_ACCESS_TOKEN"}`, http.StatusBadRequest)
	}))
	defer server.Close()

	client := NewPlaidClient("client-id", "secret", server.URL, server.Client())
	err := client.RemoveItem(context.Background(), "bad-token")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "plaid /item/remove failed with status 400")
	assert.Contains(t, err.Error(), "INVALID_ACCESS_TOKEN")
}

func TestPlaidRemoveItemSuccessAllowsNilOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/item/remove", r.URL.Path)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	client := NewPlaidClient("client-id", "secret", server.URL, server.Client())

	require.NoError(t, client.RemoveItem(context.Background(), "access-token"))
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

type readErrorCloser struct{}

func (readErrorCloser) Read([]byte) (int, error) {
	return 0, errors.New("read failed")
}

func (readErrorCloser) Close() error {
	return nil
}

var _ io.ReadCloser = readErrorCloser{}
