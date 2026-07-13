package devicetoken

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

func BenchmarkDeviceTokenLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })
	b.Setenv("AUTH_SECRET", "secret")

	router := tokenRouter(Deps{Service: &testutils.MockDeviceService{
		TokenOutcome: &auth.DeviceLoginTokenOutcome{
			Kind:        "APPROVED",
			AccessToken: "access-token",
			ExpiresIn:   3600,
		},
	}})
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := tokenPOST(`{"device_code":"device-code"}`)
		resp := httptest.NewRecorder()
		startedAt := time.Now()
		router.ServeHTTP(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
	}
	b.StopTimer()
	benchtest.ReportLatencyProfile(b, samples)
}
