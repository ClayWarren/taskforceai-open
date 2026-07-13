package run

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/benchtest"
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
	benchtest.ReportLatencyProfile(b, samples)
}
