package run

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/benchtest"
	runp "github.com/TaskForceAI/go-engine/pkg/run"
	redispkg "github.com/TaskForceAI/infrastructure/redis/pkg"
)

func BenchmarkRunRouteLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	originalRedisGetter := runp.RedisClientGetter
	runp.RedisClientGetter = func() (redispkg.Cmdable, error) { return nil, errors.New("redis unavailable in benchmark") }
	originalFallbackLimiter := fallbackRunLimiter
	fallbackRunLimiter = newInMemoryWindowCounter()
	b.Cleanup(func() {
		runp.RedisClientGetter = originalRedisGetter
		fallbackRunLimiter = originalFallbackLimiter
	})

	plan := "pro"
	user := &auth.AuthenticatedUser{ID: 44, Email: "run-benchmark@example.com", Plan: &plan}
	router := setupRunRouter(new(runQueriesMock), latencyInngestSender{}, user, 0)
	registry := &latencyRunRegistry{}
	originalRegistryGetter := registryGetter
	registryGetter = func() TaskRegistry { return registry }
	b.Cleanup(func() { registryGetter = originalRegistryGetter })

	body := `{"prompt":"benchmark full run route latency","modelId":"openai/gpt-5.6-sol"}`
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		user.ID = 1_000_000 + i
		user.Email = fmt.Sprintf("run-benchmark-%d@example.com", i)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/run", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp := httptest.NewRecorder()
		startedAt := time.Now()
		router.ServeHTTP(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected run route status: %d body=%s", resp.Code, resp.Body.String())
		}
	}
	b.StopTimer()
	reportRunRouteLatencyProfile(b, samples)
}

type latencyInngestSender struct{}

func (latencyInngestSender) Send(context.Context, any) (string, error) {
	return "evt-benchmark", nil
}

type latencyRunRegistry struct{}

func (latencyRunRegistry) Register(string, int, string, string, runp.OrchestrateTaskOptions) error {
	return nil
}

func (latencyRunRegistry) Get(string) *runp.TaskState {
	return nil
}

func reportRunRouteLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(runRouteDurationMicroseconds(benchtest.PercentileDuration(ordered, 0.50)), "p50_us")
	b.ReportMetric(runRouteDurationMicroseconds(benchtest.PercentileDuration(ordered, 0.95)), "p95_us")
	b.ReportMetric(runRouteDurationMicroseconds(benchtest.PercentileDuration(ordered, 0.99)), "p99_us")
}

func runRouteDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}
