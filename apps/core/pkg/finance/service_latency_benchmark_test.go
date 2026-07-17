package finance

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/go-core/internal/benchmarktest"
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
		benchmarktest.Profile(b, func() error {
			record, err := service.ExchangePublicToken(context.Background(), ScopeInput{UserID: 12}, "public-sandbox")
			if err != nil {
				return err
			}
			if record.ID != 1 {
				return fmt.Errorf("unexpected connection id: %d", record.ID)
			}
			return nil
		})
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
		benchmarktest.Profile(b, func() error {
			return service.Sync(context.Background(), ScopeInput{UserID: 12})
		})
	})
}
