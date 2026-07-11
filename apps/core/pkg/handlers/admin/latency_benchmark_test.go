package admin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
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
		samples := make([]time.Duration, 0, b.N)
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			resp := serveAdminBenchmarkGet(router, "/api/v1/admin/insights")
			samples = append(samples, resp.duration)
			if resp.code != http.StatusOK {
				b.Fatalf("unexpected insights status: %d", resp.code)
			}
		}
		b.StopTimer()
		reportAdminHandlerLatencyProfile(b, samples)
	})

	b.Run("AuditLogs", func(b *testing.B) {
		samples := make([]time.Duration, 0, b.N)
		b.ReportAllocs()
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			resp := serveAdminBenchmarkGet(router, "/api/v1/admin/audit-logs")
			samples = append(samples, resp.duration)
			if resp.code != http.StatusOK {
				b.Fatalf("unexpected audit logs status: %d", resp.code)
			}
		}
		b.StopTimer()
		reportAdminHandlerLatencyProfile(b, samples)
	})
}

type adminBenchmarkResponse struct {
	code     int
	duration time.Duration
}

func serveAdminBenchmarkGet(router http.Handler, path string) adminBenchmarkResponse {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	resp := httptest.NewRecorder()
	startedAt := time.Now()
	router.ServeHTTP(resp, req)
	return adminBenchmarkResponse{
		code:     resp.Code,
		duration: time.Since(startedAt),
	}
}

func reportAdminHandlerLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(adminDurationMicroseconds(adminPercentileDuration(ordered, 0.50)), "p50_us")
	b.ReportMetric(adminDurationMicroseconds(adminPercentileDuration(ordered, 0.95)), "p95_us")
	b.ReportMetric(adminDurationMicroseconds(adminPercentileDuration(ordered, 0.99)), "p99_us")
}

func adminPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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

func adminDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}
