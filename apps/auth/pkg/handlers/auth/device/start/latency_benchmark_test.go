package start

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/benchtest"
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
	benchtest.ReportLatencyProfile(b, samples)
}
