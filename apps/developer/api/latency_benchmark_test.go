package handler

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/benchtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
)

func BenchmarkDeveloperRunProxyLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	withTokenValidation(b, func(string) (jwt.MapClaims, error) {
		return jwt.MapClaims{"id": float64(44), "email": "developer-benchmark@example.com"}, nil
	})

	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"taskId":"task_latency","status":"processing"}`))
	}))
	b.Cleanup(engine.Close)
	b.Setenv("ENGINE_SERVICE_URL", engine.URL)

	router, _ := NewRouter()

	body := []byte(`{"prompt":"benchmark developer proxy latency","modelId":"openai/gpt-5.6-sol"}`)
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/developer/run", bytes.NewReader(body))
		user := &auth.AuthenticatedUser{ID: 44, Email: "developer-benchmark@example.com"}
		req = req.WithContext(context.WithValue(req.Context(), adapterhandler.UserContextKey, user))
		req.Header.Set("Authorization", "Bearer valid-token")
		req.Header.Set("Content-Type", "application/json")
		resp := httptest.NewRecorder()

		startedAt := time.Now()
		router.ServeHTTP(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusAccepted {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
	}
	b.StopTimer()
	benchtest.ReportLatencyProfile(b, samples)
}
