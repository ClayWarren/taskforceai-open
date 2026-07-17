package finance

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/core/pkg/memories"
	"github.com/TaskForceAI/go-core/internal/benchmarktest"
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
	benchmarktest.ProfileHTTP(b, router, func() *http.Request {
		return httptest.NewRequest(http.MethodGet, "/api/v1/finances", nil)
	})
}
