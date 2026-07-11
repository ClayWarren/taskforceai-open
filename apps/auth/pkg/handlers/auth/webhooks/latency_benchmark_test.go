package webhooks

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
)

func BenchmarkWorkOSWebhookEventLatencyProfile(b *testing.B) {
	handler := &WorkOSWebhookHandlerStruct{
		AddMembership: func(ctx context.Context, q *db.Queries, email, workosOrgID string) error {
			return nil
		},
	}
	payload := map[string]any{
		"email": "benchmark@example.com",
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		b.Fatalf("marshal payload: %v", err)
	}
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		resp := httptest.NewRecorder()
		startedAt := time.Now()
		outcome, err := handler.processEvent(
			context.Background(),
			resp,
			&db.Queries{},
			"evt_benchmark",
			"dsync.user.created",
			"org_benchmark",
			raw,
			func(context.Context, error, string) {},
		)
		samples = append(samples, time.Since(startedAt))
		if err != nil {
			b.Fatalf("processEvent failed: %v", err)
		}
		if outcome != "processed" || resp.Code != http.StatusOK {
			b.Fatalf("unexpected outcome/status: %s/%d", outcome, resp.Code)
		}
	}
	b.StopTimer()
	reportWorkOSWebhookLatencyProfile(b, samples)
}

func reportWorkOSWebhookLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(workOSWebhookDurationMicroseconds(workOSWebhookPercentileDuration(ordered, 0.50)), "p50_us")
	b.ReportMetric(workOSWebhookDurationMicroseconds(workOSWebhookPercentileDuration(ordered, 0.95)), "p95_us")
	b.ReportMetric(workOSWebhookDurationMicroseconds(workOSWebhookPercentileDuration(ordered, 0.99)), "p99_us")
}

func workOSWebhookPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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

func workOSWebhookDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}
