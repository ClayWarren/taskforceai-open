package developer

import (
	"context"
	"sort"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/benchtest"
)

func BenchmarkDeveloperAPIKeyLookupLatencyProfile(b *testing.B) {
	now := time.Unix(1_700_000_000, 0)
	keys := []DeveloperApiKeyRecord{
		{ID: 10, DisplayKey: "tfai_...abcd", Tier: TierStarter, RateLimit: 1000, MonthlyQuota: 1_000_000, CreatedAt: now},
		{ID: 11, DisplayKey: "tfai_...efgh", Tier: TierPro, RateLimit: 5000, MonthlyQuota: 10_000_000, CreatedAt: now},
	}
	repo := &latencyDeveloperRepository{keys: keys}
	service := NewDeveloperKeysService(repo)

	b.Run("ListKeys", func(b *testing.B) {
		samples := make([]time.Duration, 0, b.N)
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			startedAt := time.Now()
			result, err := service.ListKeys(context.Background(), 42)
			samples = append(samples, time.Since(startedAt))
			if err != nil {
				b.Fatalf("ListKeys failed: %v", err)
			}
			if len(result) != len(keys) {
				b.Fatalf("expected %d keys, got %d", len(keys), len(result))
			}
		}
		b.StopTimer()
		reportDeveloperAPIKeyLookupLatencyProfile(b, samples)
	})

	b.Run("FindKeyForRevoke", func(b *testing.B) {
		samples := make([]time.Duration, 0, b.N)
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			startedAt := time.Now()
			result, err := service.RevokeKey(context.Background(), 42, 10)
			samples = append(samples, time.Since(startedAt))
			if err != nil {
				b.Fatalf("RevokeKey failed: %v", err)
			}
			if result.DisplayKey != "tfai_...abcd" {
				b.Fatalf("unexpected display key: %s", result.DisplayKey)
			}
		}
		b.StopTimer()
		reportDeveloperAPIKeyLookupLatencyProfile(b, samples)
	})
}

func BenchmarkDeveloperUsageLatencyProfile(b *testing.B) {
	now := time.Unix(1_700_000_000, 0)
	keys := []DeveloperApiKeyRecord{
		{ID: 10, DisplayKey: "tfai_...abcd", Tier: TierStarter, RateLimit: 1000, MonthlyQuota: 1_000_000, CreatedAt: now},
		{ID: 11, DisplayKey: "tfai_...efgh", Tier: TierPro, RateLimit: 5000, MonthlyQuota: 10_000_000, CreatedAt: now},
		{ID: 12, DisplayKey: "tfai_...ijkl", Tier: TierEnterprise, RateLimit: 10000, MonthlyQuota: 100_000_000, CreatedAt: now},
	}
	usageLimit := 1_000_000
	usageUsed := 42_000
	periodStart := now.AddDate(0, 0, -14)
	periodEnd := now.AddDate(0, 0, 14)
	repo := &latencyDeveloperRepository{keys: keys}
	service := NewDeveloperUsageService(repo)
	user := UsageUser{
		ID:                    42,
		APIRequestsUsed:       &usageUsed,
		APIRequestsLimit:      &usageLimit,
		APICurrentPeriodStart: &periodStart,
		APICurrentPeriodEnd:   &periodEnd,
	}

	samples := make([]time.Duration, 0, b.N)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		startedAt := time.Now()
		stats, err := service.GetUsageStats(context.Background(), user)
		samples = append(samples, time.Since(startedAt))
		if err != nil {
			b.Fatalf("GetUsageStats failed: %v", err)
		}
		if len(stats.APIKeys) != len(keys) {
			b.Fatalf("expected %d key usage rows, got %d", len(keys), len(stats.APIKeys))
		}
	}
	b.StopTimer()
	reportDeveloperAPIKeyLookupLatencyProfile(b, samples)
}

type latencyDeveloperRepository struct {
	keys []DeveloperApiKeyRecord
}

func (r *latencyDeveloperRepository) ListKeysForUser(context.Context, int) ([]DeveloperApiKeyRecord, error) {
	return append([]DeveloperApiKeyRecord(nil), r.keys...), nil
}

func (r *latencyDeveloperRepository) CountActiveKeysForUser(context.Context, int) (int, error) {
	return len(r.keys), nil
}

func (r *latencyDeveloperRepository) FindKeyForUser(_ context.Context, keyID, _ int) (*DeveloperApiKeyRecord, error) {
	for i := range r.keys {
		if r.keys[i].ID == keyID {
			key := r.keys[i]
			return &key, nil
		}
	}
	return nil, ErrKeyNotFound
}

func (r *latencyDeveloperRepository) RevokeKey(context.Context, int) error {
	return nil
}

func (r *latencyDeveloperRepository) CreateApiKey(context.Context, int, string, string, DeveloperApiTier, int, int) error {
	return nil
}

func (r *latencyDeveloperRepository) GetUsageTotalsForKeys(_ context.Context, keyIDs []int, _, _, _, _ time.Time) (map[int]UsageTotals, error) {
	totals := make(map[int]UsageTotals, len(keyIDs))
	for _, keyID := range keyIDs {
		totals[keyID] = UsageTotals{
			Hourly:  keyID,
			Daily:   keyID * 10,
			Weekly:  keyID * 100,
			Monthly: keyID * 1000,
		}
	}
	return totals, nil
}

func (r *latencyDeveloperRepository) ListUsageHistory(context.Context, []int, time.Time) ([]UsageHistoryRecord, error) {
	return []UsageHistoryRecord{
		{WindowStart: time.Unix(1_700_000_000, 0), Count: 120},
		{WindowStart: time.Unix(1_700_086_400, 0), Count: 180},
	}, nil
}

func reportDeveloperAPIKeyLookupLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(developerDurationMicroseconds(benchtest.PercentileDuration(ordered, 0.50)), "p50_us")
	b.ReportMetric(developerDurationMicroseconds(benchtest.PercentileDuration(ordered, 0.95)), "p95_us")
	b.ReportMetric(developerDurationMicroseconds(benchtest.PercentileDuration(ordered, 0.99)), "p99_us")
}

func developerDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}
