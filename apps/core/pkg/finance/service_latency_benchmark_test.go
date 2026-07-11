package finance

import (
	"context"
	"sort"
	"strings"
	"testing"
	"time"

	infracrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
)

func BenchmarkFinanceProviderFlowLatencyProfile(b *testing.B) {
	b.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	b.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	b.Run("ExchangePublicToken", func(b *testing.B) {
		store := &mockStore{
			upsertConnectionFunc: func(ctx context.Context, input UpsertConnectionInput) (ConnectionRecord, error) {
				return ConnectionRecord{ID: 1, ProviderItemID: input.ProviderItemID}, nil
			},
		}
		provider := &mockProvider{
			exchangeFunc: func(ctx context.Context, publicToken string) (ExchangeResult, error) {
				return ExchangeResult{AccessToken: "access-token", ItemID: "item-1"}, nil
			},
		}
		service := NewService(store, provider)
		samples := make([]time.Duration, 0, b.N)

		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			startedAt := time.Now()
			record, err := service.ExchangePublicToken(context.Background(), ScopeInput{UserID: 12}, "public-sandbox")
			samples = append(samples, time.Since(startedAt))
			if err != nil {
				b.Fatalf("ExchangePublicToken failed: %v", err)
			}
			if record.ID != 1 {
				b.Fatalf("unexpected connection id: %d", record.ID)
			}
		}
		b.StopTimer()
		reportFinanceProviderFlowLatencyProfile(b, samples)
	})

	b.Run("Sync", func(b *testing.B) {
		accessToken := "access-token"
		encryptedAccessToken, err := infracrypto.EncryptOAuthTokenField(&accessToken)
		if err != nil {
			b.Fatalf("encrypt access token: %v", err)
		}
		store := &mockStore{
			listFunc: func(ctx context.Context, input ScopeInput) ([]ConnectionRecord, error) {
				return []ConnectionRecord{{
					ID:                   1,
					UserID:               input.UserID,
					Provider:             ProviderPlaid,
					ProviderItemID:       "item-1",
					EncryptedAccessToken: *encryptedAccessToken,
					Status:               StatusActive,
				}}, nil
			},
		}
		provider := &mockProvider{
			syncFunc: func(ctx context.Context, input SyncInput) (SyncResult, error) {
				return SyncResult{
					Accounts: []AccountRecord{{
						ProviderAccountID: "account-1",
						Name:              "Checking",
					}},
					Added: []TransactionRecord{{
						ProviderTransactionID: "transaction-1",
						ProviderAccountID:     "account-1",
						Amount:                12.34,
						Date:                  time.Unix(1_700_000_000, 0),
						Name:                  "Benchmark",
					}},
					NextCursor: "cursor-1",
				}, nil
			},
			recurringFunc: func(ctx context.Context, accessToken string) (RecurringResult, error) {
				return RecurringResult{Streams: []RecurringStreamRecord{{ProviderStreamID: "stream-1", ProviderAccountID: "account-1"}}}, nil
			},
		}
		service := NewService(store, provider)
		samples := make([]time.Duration, 0, b.N)

		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			startedAt := time.Now()
			err := service.Sync(context.Background(), ScopeInput{UserID: 12})
			samples = append(samples, time.Since(startedAt))
			if err != nil {
				b.Fatalf("Sync failed: %v", err)
			}
		}
		b.StopTimer()
		reportFinanceProviderFlowLatencyProfile(b, samples)
	})
}

func reportFinanceProviderFlowLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(float64(financeProviderPercentileDuration(ordered, 0.50).Microseconds()), "p50_us")
	b.ReportMetric(float64(financeProviderPercentileDuration(ordered, 0.95).Microseconds()), "p95_us")
	b.ReportMetric(float64(financeProviderPercentileDuration(ordered, 0.99).Microseconds()), "p99_us")
}

func financeProviderPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
	if len(ordered) == 0 {
		return 0
	}
	index := int(float64(len(ordered))*percentile + 0.999999)
	if index < 1 {
		index = 1
	}
	if index > len(ordered) {
		index = len(ordered)
	}
	return ordered[index-1]
}
