package session

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/benchtest"
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
	benchtest.ReportLatencyProfile(b, samples)
}
