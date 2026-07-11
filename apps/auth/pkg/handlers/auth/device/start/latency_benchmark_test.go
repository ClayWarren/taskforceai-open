package start

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"testing"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
)

func BenchmarkDeviceStartLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	router := startRouter(Deps{Service: &testutils.MockDeviceService{
		StartPayload: &auth.DeviceLoginStartPayload{
			DeviceCode:      "device-code",
			UserCode:        "ABCD-1234",
			VerificationURI: "https://auth.example.com/device",
			ExpiresIn:       600,
			Interval:        5,
		},
	}})
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/start", nil)
		resp := httptest.NewRecorder()
		startedAt := time.Now()
		router.ServeHTTP(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusCreated {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
	}
	b.StopTimer()
	reportDeviceStartLatencyProfile(b, samples)
}

func reportDeviceStartLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(float64(deviceStartPercentileDuration(ordered, 0.50).Microseconds()), "p50_us")
	b.ReportMetric(float64(deviceStartPercentileDuration(ordered, 0.95).Microseconds()), "p95_us")
	b.ReportMetric(float64(deviceStartPercentileDuration(ordered, 0.99).Microseconds()), "p99_us")
}

func deviceStartPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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
