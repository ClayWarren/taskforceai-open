package run

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
)

func BenchmarkTaskRegistryLatencyProfile(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	registry, _, cleanup := setupMiniredisRegistry(b)
	b.Cleanup(cleanup)

	markStartedSamples := make([]time.Duration, 0, b.N)
	updateProgressSamples := make([]time.Duration, 0, b.N)
	getSamples := make([]time.Duration, 0, b.N)
	agentStatuses := []map[string]any{{"agent": "benchmark", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "status": "completed"}}
	budgetUsage := &BudgetUsage{ConsumedUSD: 0.003}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		taskID := fmt.Sprintf("bench-registry-%d", i)
		b.StopTimer()
		if err := registry.Register(taskID, 42, "benchmark prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
			b.Fatalf("Register failed: %v", err)
		}
		b.StartTimer()

		startedAt := time.Now()
		started, err := registry.MarkStartedWithError(taskID)
		markStartedSamples = append(markStartedSamples, time.Since(startedAt))
		if err != nil {
			b.Fatalf("MarkStartedWithError failed: %v", err)
		}
		if !started {
			b.Fatalf("expected task to be marked started")
		}

		startedAt = time.Now()
		if err := registry.UpdateProgress(taskID, agentStatuses, toolEvents, budgetUsage); err != nil {
			b.Fatalf("UpdateProgress failed: %v", err)
		}
		updateProgressSamples = append(updateProgressSamples, time.Since(startedAt))

		startedAt = time.Now()
		state := registry.Get(taskID)
		getSamples = append(getSamples, time.Since(startedAt))
		if state == nil {
			b.Fatalf("expected task state")
		}
	}
	b.StopTimer()

	reportNamedLatencyProfile(b, "mark_started", markStartedSamples)
	reportNamedLatencyProfile(b, "update_progress", updateProgressSamples)
	reportNamedLatencyProfile(b, "get", getSamples)
}

func BenchmarkTaskRegistryRegisterOnlyMiniredis(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	registry, _, cleanup := setupMiniredisRegistry(b)
	b.Cleanup(cleanup)

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		taskID := fmt.Sprintf("bench-register-only-%d", i)
		if err := registry.Register(taskID, 100000+i, "benchmark prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
			b.Fatalf("Register failed: %v", err)
		}
	}
}

func BenchmarkTaskRegistryGetOnlyMiniredis(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	registry, _, cleanup := setupMiniredisRegistry(b)
	b.Cleanup(cleanup)

	const taskID = "bench-get-only"
	if err := registry.Register(taskID, 42, "benchmark prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
		b.Fatalf("Register failed: %v", err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		state := registry.Get(taskID)
		if state == nil {
			b.Fatalf("expected task state")
		}
	}
}

func BenchmarkTaskRegistryUpdateProgressOnlyMiniredis(b *testing.B) {
	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(originalLogger) })

	registry, _, cleanup := setupMiniredisRegistry(b)
	b.Cleanup(cleanup)

	const taskID = "bench-update-progress-only"
	if err := registry.Register(taskID, 42, "benchmark prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
		b.Fatalf("Register failed: %v", err)
	}

	agentStatuses := []map[string]any{{"agent": "benchmark", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "status": "completed"}}
	budgetUsage := &BudgetUsage{ConsumedUSD: 0.003}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := registry.UpdateProgress(taskID, agentStatuses, toolEvents, budgetUsage); err != nil {
			b.Fatalf("UpdateProgress failed: %v", err)
		}
	}
}

func BenchmarkRedisTaskRegistryLatencyProfile(b *testing.B) {
	registry, prefix, userID, cleanup := setupRedisDependencyRegistry(b)
	b.Cleanup(cleanup)

	markStartedSamples := make([]time.Duration, 0, b.N)
	updateProgressSamples := make([]time.Duration, 0, b.N)
	getSamples := make([]time.Duration, 0, b.N)
	agentStatuses := []map[string]any{{"agent": "benchmark", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "status": "completed"}}
	budgetUsage := &BudgetUsage{ConsumedUSD: 0.003}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		taskID := fmt.Sprintf("%s%d", prefix, i)
		b.StopTimer()
		if err := registry.Register(taskID, userID, "benchmark prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
			b.Fatalf("Register failed: %v", err)
		}
		b.StartTimer()

		startedAt := time.Now()
		started, err := registry.MarkStartedWithError(taskID)
		markStartedSamples = append(markStartedSamples, time.Since(startedAt))
		if err != nil {
			b.Fatalf("MarkStartedWithError failed: %v", err)
		}
		if !started {
			b.Fatalf("expected task to be marked started")
		}

		startedAt = time.Now()
		if err := registry.UpdateProgress(taskID, agentStatuses, toolEvents, budgetUsage); err != nil {
			b.Fatalf("UpdateProgress failed: %v", err)
		}
		updateProgressSamples = append(updateProgressSamples, time.Since(startedAt))

		startedAt = time.Now()
		state := registry.Get(taskID)
		getSamples = append(getSamples, time.Since(startedAt))
		if state == nil {
			b.Fatalf("expected task state")
		}
	}
	b.StopTimer()

	reportNamedLatencyProfile(b, "redis_mark_started", markStartedSamples)
	reportNamedLatencyProfile(b, "redis_update_progress", updateProgressSamples)
	reportNamedLatencyProfile(b, "redis_get", getSamples)
}

func BenchmarkRedisTaskRegistryRegisterOnly(b *testing.B) {
	registry, prefix, userID, cleanup := setupRedisDependencyRegistry(b)
	b.Cleanup(cleanup)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		taskID := fmt.Sprintf("%sregister-%d", prefix, i)
		if err := registry.Register(taskID, userID, "benchmark prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
			b.Fatalf("Register failed: %v", err)
		}
	}
}

func BenchmarkRedisTaskRegistryGetOnly(b *testing.B) {
	registry, prefix, userID, cleanup := setupRedisDependencyRegistry(b)
	b.Cleanup(cleanup)

	taskID := prefix + "get-only"
	if err := registry.Register(taskID, userID, "benchmark prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
		b.Fatalf("Register failed: %v", err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		state := registry.Get(taskID)
		if state == nil {
			b.Fatalf("expected task state")
		}
	}
}

func BenchmarkRedisTaskRegistryUpdateProgressOnly(b *testing.B) {
	registry, prefix, userID, cleanup := setupRedisDependencyRegistry(b)
	b.Cleanup(cleanup)

	taskID := prefix + "update-progress-only"
	if err := registry.Register(taskID, userID, "benchmark prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
		b.Fatalf("Register failed: %v", err)
	}
	started, err := registry.MarkStartedWithError(taskID)
	if err != nil {
		b.Fatalf("MarkStartedWithError failed: %v", err)
	}
	if !started {
		b.Fatalf("expected task to be marked started")
	}

	agentStatuses := []map[string]any{{"agent": "benchmark", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "status": "completed"}}
	budgetUsage := &BudgetUsage{ConsumedUSD: 0.003}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := registry.UpdateProgress(taskID, agentStatuses, toolEvents, budgetUsage); err != nil {
			b.Fatalf("UpdateProgress failed: %v", err)
		}
	}
}

func reportNamedLatencyProfile(b *testing.B, name string, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(float64(percentileDuration(ordered, 0.50).Microseconds()), name+"_p50_us")
	b.ReportMetric(float64(percentileDuration(ordered, 0.95).Microseconds()), name+"_p95_us")
	b.ReportMetric(float64(percentileDuration(ordered, 0.99).Microseconds()), name+"_p99_us")
}

func setupRedisDependencyRegistry(b *testing.B) (*TaskRegistry, string, int, func()) {
	b.Helper()
	if os.Getenv("TASKFORCE_LATENCY_DEPS") != "1" {
		b.Skip("set TASKFORCE_LATENCY_DEPS=1 to run dependency-backed latency benchmarks")
	}
	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" {
		b.Skip("REDIS_URL is required for dependency-backed registry benchmarks")
	}

	originalLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))

	opts, err := goredis.ParseURL(redisURL)
	if err != nil {
		b.Fatalf("parse REDIS_URL: %v", err)
	}
	rdb := goredis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		_ = rdb.Close()
		b.Fatalf("ping redis: %v", err)
	}

	client := redis.NewClient(rdb)
	redis.SetClient(client)
	registry := requireTaskRegistry(b)
	prefix := fmt.Sprintf("deps-registry-%d-", time.Now().UnixNano())
	userID := 424242

	cleanup := func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cleanupCancel()
		if keys, err := rdb.Keys(cleanupCtx, "task:"+prefix+"*").Result(); err == nil && len(keys) > 0 {
			_ = rdb.Del(cleanupCtx, keys...).Err()
		}
		_ = rdb.Del(cleanupCtx, activeTaskIndexKey(userID)).Err()
		_ = rdb.Close()
		redis.SetClient(redis.NewMockClient())
		slog.SetDefault(originalLogger)
	}
	return registry, prefix, userID, cleanup
}
