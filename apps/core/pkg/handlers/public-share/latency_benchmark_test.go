package publicshare

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"
)

func BenchmarkPublicShareLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	messages := []PublicMessageRow{
		{MessageID: "msg-1", Role: "user", Content: "hello", CreatedAt: time.Unix(1_700_000_000, 0).UTC(), HasCreatedAt: true},
		{MessageID: "msg-2", Role: "assistant", Content: "world", CreatedAt: time.Unix(1_700_000_001, 0).UTC(), HasCreatedAt: true},
	}
	q := &mockPublicShareQueries{
		convFunc: func(ctx context.Context, shareID *string) (SharedConversation, error) {
			return testPublicConversation("Shared prompt"), nil
		},
		messagesFunc: func(ctx context.Context, input PublicMessagesInput) ([]PublicMessageRow, error) {
			return messages, nil
		},
	}
	router := setupPublicShareRouter(q)
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/public-share/share-benchmark", nil)
		resp := httptest.NewRecorder()
		startedAt := time.Now()
		router.ServeHTTP(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
	}
	b.StopTimer()
	reportPublicShareLatencyProfile(b, samples)
}

func reportPublicShareLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(float64(publicSharePercentileDuration(ordered, 0.50).Microseconds()), "p50_us")
	b.ReportMetric(float64(publicSharePercentileDuration(ordered, 0.95).Microseconds()), "p95_us")
	b.ReportMetric(float64(publicSharePercentileDuration(ordered, 0.99).Microseconds()), "p99_us")
}

func publicSharePercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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
