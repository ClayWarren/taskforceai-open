package admin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/go-core/internal/benchmarktest"
	coreadmin "github.com/TaskForceAI/go-core/pkg/admin"
)

func BenchmarkAdminHandlerLatencyProfile(b *testing.B) {
	repo := &mockAdminRepo{
		fetchInsightsDataFunc: func(ctx context.Context, since24h, since5m time.Time) (*coreadmin.AdminInsightsData, error) {
			return &coreadmin.AdminInsightsData{
				ActiveUsers24h: 100,
				Messages24h:    500,
			}, nil
		},
		listAuditLogsFunc: func(ctx context.Context, filters coreadmin.AuditLogFilters, limit, offset int) (*coreadmin.AuditLogPage, error) {
			return &coreadmin.AuditLogPage{
				Logs: []coreadmin.AuditLogRecord{
					{ID: 1, Action: "LOGIN", Resource: "user"},
					{ID: 2, Action: "UPDATE", Resource: "settings"},
				},
				Total: 2,
			}, nil
		},
	}
	router := setupAdminTestRouter(repo, &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true})

	b.Run("Insights", func(b *testing.B) {
		benchmarktest.ProfileHTTP(b, router, func() *http.Request {
			return httptest.NewRequest(http.MethodGet, "/api/v1/admin/insights", nil)
		})
	})

	b.Run("AuditLogs", func(b *testing.B) {
		benchmarktest.ProfileHTTP(b, router, func() *http.Request {
			return httptest.NewRequest(http.MethodGet, "/api/v1/admin/audit-logs", nil)
		})
	})
}
