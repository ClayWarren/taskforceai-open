package ratelimit

import (
	"context"
	"fmt"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
)

const redisLimiterLatencyKeyCount = 1024

func BenchmarkRedisLimiterLatencyProfile(b *testing.B) {
	client, rawRedis, prefix := setupRedisLimiterLatencyBenchmark(b)
	limiter := NewRedisLimiter(client, prefix)

	samples := make(chan time.Duration, b.N)
	var sequence atomic.Uint64
	var errOnce sync.Once
	var firstErr error
	recordError := func(err error) {
		errOnce.Do(func() {
			firstErr = err
		})
	}

	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			i := sequence.Add(1) - 1
			key := fmt.Sprintf("bench-user-%d", i%redisLimiterLatencyKeyCount)
			startedAt := time.Now()
			result, err := limiter.Check(context.Background(), key, 1_000_000, time.Minute)
			samples <- time.Since(startedAt)
			if err != nil {
				recordError(fmt.Errorf("check redis limiter: %w", err))
				continue
			}
			if !result.Allowed {
				recordError(fmt.Errorf("redis limiter unexpectedly denied key %s", key))
			}
		}
	})
	b.StopTimer()
	close(samples)
	if firstErr != nil {
		b.Fatal(firstErr)
	}

	reportRedisLimiterLatencyProfile(b, samples)
	cleanupRedisLimiterLatencyKeys(b, rawRedis, prefix)
}

func setupRedisLimiterLatencyBenchmark(b *testing.B) (*redis.Client, *goredis.Client, string) {
	b.Helper()
	if os.Getenv("TASKFORCE_LATENCY_DEPS") != "1" {
		b.Skip("set TASKFORCE_LATENCY_DEPS=1 to run dependency-backed latency benchmarks")
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}
	options, err := goredis.ParseURL(redisURL)
	if err != nil {
		b.Fatalf("parse REDIS_URL: %v", err)
	}
	rawRedis := goredis.NewClient(options)
	b.Cleanup(func() { _ = rawRedis.Close() })
	if err := rawRedis.Ping(context.Background()).Err(); err != nil {
		b.Fatalf("ping redis: %v", err)
	}

	prefix := fmt.Sprintf("bench:infra_rl:%d", time.Now().UnixNano())
	b.Cleanup(func() {
		cleanupRedisLimiterLatencyKeys(b, rawRedis, prefix)
	})
	return redis.NewClient(rawRedis), rawRedis, prefix
}

func cleanupRedisLimiterLatencyKeys(b *testing.B, rawRedis *goredis.Client, prefix string) {
	b.Helper()
	ctx := context.Background()
	keys := make([]string, redisLimiterLatencyKeyCount)
	for i := range keys {
		keys[i] = fmt.Sprintf("%s:u:bench-user-%d", prefix, i)
	}
	_ = rawRedis.Del(ctx, keys...).Err()
}

func reportRedisLimiterLatencyProfile(b *testing.B, samples <-chan time.Duration) {
	b.Helper()
	ordered := make([]time.Duration, 0, len(samples))
	for sample := range samples {
		ordered = append(ordered, sample)
	}
	if len(ordered) == 0 {
		return
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(redisLimiterDurationMicroseconds(redisLimiterPercentileDuration(ordered, 0.50)), "p50_us")
	b.ReportMetric(redisLimiterDurationMicroseconds(redisLimiterPercentileDuration(ordered, 0.95)), "p95_us")
	b.ReportMetric(redisLimiterDurationMicroseconds(redisLimiterPercentileDuration(ordered, 0.99)), "p99_us")
}

func redisLimiterPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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

func redisLimiterDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}
