package stream

import (
	"context"
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
	"github.com/TaskForceAI/go-engine/pkg/run"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

func BenchmarkStreamHandlerCompletedTaskLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	redis.SetClient(redis.NewMockClient())
	withStreamUser(b, &auth.AuthenticatedUser{ID: 44, Email: "latency-benchmark@example.com"})

	registry := run.GetRegistry()
	samples := make([]time.Duration, 0, b.N)
	taskIDs := make([]string, b.N)

	for i := 0; i < b.N; i++ {
		taskID := fmt.Sprintf("task_stream_latency_%d", i)
		taskIDs[i] = taskID
		if err := registry.Register(taskID, 44, "prompt", "openai/gpt-5.6-sol", run.OrchestrateTaskOptions{}); err != nil {
			b.Fatalf("register task: %v", err)
		}
		if err := registry.UpdateProgress(taskID, []any{map[string]any{"status": "RUNNING"}}, nil, nil); err != nil {
			b.Fatalf("update progress: %v", err)
		}
		if err := registry.UpdateWithConversation(context.Background(), taskID, run.StatusCompleted, "done", "", 42, "trace-"+taskID); err != nil {
			b.Fatalf("complete task: %v", err)
		}
	}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		taskID := taskIDs[i]
		req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
		resp := httptest.NewRecorder()

		startedAt := time.Now()
		Handler(resp, req)
		samples = append(samples, time.Since(startedAt))

		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
		if !strings.Contains(resp.Body.String(), `"type":"complete"`) {
			b.Fatalf("expected complete event, got %q", resp.Body.String())
		}
	}

	b.StopTimer()
	reportStreamLatencyProfile(b, samples)
}

func reportStreamLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}

	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })

	b.ReportMetric(float64(streamPercentileDuration(ordered, 0.50).Microseconds()), "p50_us")
	b.ReportMetric(float64(streamPercentileDuration(ordered, 0.95).Microseconds()), "p95_us")
	b.ReportMetric(float64(streamPercentileDuration(ordered, 0.99).Microseconds()), "p99_us")
}

func streamPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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
