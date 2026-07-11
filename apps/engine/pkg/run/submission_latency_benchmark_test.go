package run

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

func BenchmarkTaskSubmissionLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	mockRedis := redis.NewMockClient()
	originalRedisGetter := RedisClientGetter
	RedisClientGetter = func() (redis.Cmdable, error) { return mockRedis, nil }
	b.Cleanup(func() { RedisClientGetter = originalRedisGetter })

	registry := &captureRegistry{tasks: make(map[string]*TaskState, b.N)}
	sender := &captureInngest{id: "evt-benchmark"}
	samples := make([]time.Duration, 0, b.N)

	deps := TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return fmt.Sprintf("%sbench-%d", prefix, len(samples))
		},
	}

	req := TaskSubmissionRequest{
		UserID:  44,
		Prompt:  "benchmark prompt submission latency",
		ModelID: "openai/gpt-5.6-sol",
		Source:  "benchmark",
	}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		startedAt := time.Now()
		result, err := SubmitTask(context.Background(), req, deps)
		samples = append(samples, time.Since(startedAt))
		if err != nil {
			b.Fatalf("SubmitTask failed: %v", err)
		}
		if result.Status != StatusProcessing {
			b.Fatalf("unexpected status: %s", result.Status)
		}
	}

	b.StopTimer()
	reportLatencyProfile(b, samples)
}

func reportLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}

	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })

	b.ReportMetric(float64(percentileDuration(ordered, 0.50).Microseconds()), "p50_us")
	b.ReportMetric(float64(percentileDuration(ordered, 0.95).Microseconds()), "p95_us")
	b.ReportMetric(float64(percentileDuration(ordered, 0.99).Microseconds()), "p99_us")
}

func percentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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
