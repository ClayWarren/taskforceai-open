package finance

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/core/pkg/memories"
	corefinance "github.com/TaskForceAI/go-core/pkg/finance"
)

func BenchmarkFinanceDashboardLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	now := time.Unix(1_700_000_000, 0).UTC()
	service := &mockFinanceMemoryService{
		getFunc: func(ctx context.Context, userID int32, orgID *int32) ([]memories.MemoryRecord, error) {
			return []memories.MemoryRecord{{ID: 1, Content: "Budget planning", Type: "finance"}}, nil
		},
	}
	provider := &mockFinanceProviderService{
		configured: true,
		dashboardFunc: func(ctx context.Context, input corefinance.ScopeInput) (corefinance.DashboardData, error) {
			return corefinance.DashboardData{
				Connections: []corefinance.ConnectionRecord{{ID: 4, Provider: corefinance.ProviderPlaid, InstitutionName: new("Demo Bank"), LastSyncedAt: &now}},
				Accounts:    []corefinance.AccountRecord{{ProviderAccountID: "account-1", Name: "Checking", ISOCurrencyCode: new("USD")}},
				RecentTransactions: []corefinance.TransactionRecord{{
					ProviderTransactionID: "transaction-1",
					ProviderAccountID:     "account-1",
					Amount:                24.5,
					Date:                  now,
					Name:                  "Coffee",
				}},
				RecurringStreams: []corefinance.RecurringStreamRecord{{ProviderStreamID: "stream-1", ProviderAccountID: "account-1", StreamType: "outflow"}},
			}, nil
		},
	}
	router := setupFinanceRouter(service, &auth.AuthenticatedUser{ID: 12, Email: "finance-benchmark@example.com"}, 24, provider)
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/finances", nil)
		resp := httptest.NewRecorder()
		startedAt := time.Now()
		router.ServeHTTP(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
	}
	b.StopTimer()
	reportFinanceLatencyProfile(b, samples)
}

func reportFinanceLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(float64(financePercentileDuration(ordered, 0.50).Microseconds()), "p50_us")
	b.ReportMetric(float64(financePercentileDuration(ordered, 0.95).Microseconds()), "p95_us")
	b.ReportMetric(float64(financePercentileDuration(ordered, 0.99).Microseconds()), "p99_us")
}

func financePercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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
