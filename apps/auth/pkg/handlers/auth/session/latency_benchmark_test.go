package session

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
	"github.com/TaskForceAI/auth-service/pkg/handler"
)

func BenchmarkSessionHandlerLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	name := "Benchmark User"
	user := &auth.AuthenticatedUser{
		ID:       123,
		Email:    "benchmark@example.com",
		FullName: &name,
	}
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
		req = req.WithContext(context.WithValue(req.Context(), handler.UserContextKey, user))
		resp := httptest.NewRecorder()
		startedAt := time.Now()
		Handler(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
	}
	b.StopTimer()
	reportSessionLatencyProfile(b, samples)
}

func reportSessionLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(float64(sessionPercentileDuration(ordered, 0.50).Microseconds()), "p50_us")
	b.ReportMetric(float64(sessionPercentileDuration(ordered, 0.95).Microseconds()), "p95_us")
	b.ReportMetric(float64(sessionPercentileDuration(ordered, 0.99).Microseconds()), "p99_us")
}

func sessionPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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
