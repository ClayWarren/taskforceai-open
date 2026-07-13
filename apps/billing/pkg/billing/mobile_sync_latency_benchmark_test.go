package billing

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/claywarren/revenuecat"
)

func BenchmarkRevenueCatMobileSyncLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	b.Setenv("REVENUECAT_SECRET_KEY", "test_key")
	expiry := time.Now().Add(30 * 24 * time.Hour)
	purchase := time.Now().Add(-24 * time.Hour)
	user := mobileUser("free")
	source := SourceAppStore
	user.SubscriptionSource = &source
	subscriber := &revenuecat.Subscriber{
		Entitlements: map[string]revenuecat.Entitlement{
			"pro": {
				ProductIdentifier: "com.app.pro",
				ExpiresDate:       &expiry,
			},
		},
		Subscriptions: map[string]revenuecat.Subscription{
			"com.app.pro": {
				Store:              revenuecat.AppStore,
				PurchaseDate:       purchase,
				ExpiresDate:        &expiry,
				StoreTransactionID: "txn-benchmark",
			},
		},
	}
	repo := &latencyMobileSubscriptionRepository{user: user}
	service := newMobileSubscriptionServiceWithFetcher(repo, latencyRevenueCatFetcher{subscriber: subscriber})
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		startedAt := time.Now()
		result, err := service.SyncMobileSubscriptionByAppUserID(context.Background(), "app_user_benchmark")
		samples = append(samples, time.Since(startedAt))
		if err != "" {
			b.Fatalf("SyncMobileSubscriptionByAppUserID failed: %s", err)
		}
		if result == nil || result.Plan != string(PlanPro) {
			b.Fatalf("expected pro sync result, got %#v", result)
		}
	}
	b.StopTimer()
	reportBillingLatencyProfile(b, samples)
}

type latencyMobileSubscriptionRepository struct {
	user *MobileSyncUser
}

func (r *latencyMobileSubscriptionRepository) FindUserByID(context.Context, int) (*MobileSyncUser, error) {
	return r.user, nil
}

func (r *latencyMobileSubscriptionRepository) FindUserByAppUserID(context.Context, string) (*MobileSyncUser, error) {
	return r.user, nil
}

func (r *latencyMobileSubscriptionRepository) UpdateUser(_ context.Context, id int, update MobileSubscriptionUpdate) (*MobileSyncUser, error) {
	updated := *r.user
	updated.ID = id
	if update.Plan != nil {
		updated.Plan = *update.Plan
	}
	updated.SubscriptionStatus = update.SubscriptionStatus
	updated.SubscriptionSource = update.SubscriptionSource
	updated.CurrentPeriodEnd = update.CurrentPeriodEnd
	updated.CurrentPeriodStart = update.CurrentPeriodStart
	updated.SubscriptionID = update.SubscriptionID
	updated.RevenueCatAppUserID = update.RevenueCatAppUserID
	return &updated, nil
}

type latencyRevenueCatFetcher struct {
	subscriber *revenuecat.Subscriber
}

func (f latencyRevenueCatFetcher) FetchSubscriber(context.Context, string) (*revenuecat.Subscriber, RevenueCatError) {
	return f.subscriber, ""
}
