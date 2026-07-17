package cache

import (
	"context"
	"fmt"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

func BenchmarkRedisCacheLatencyProfile(b *testing.B) {
	cache, rawRedis, prefix := setupRedisCacheLatencyBenchmark(b)
	hotKey := prefix + ":hot"
	requireNoBenchmarkError(b, cache.Set(context.Background(), hotKey, "cached-value", time.Minute))

	getSamples := make(chan time.Duration, b.N)
	setSamples := make(chan time.Duration, b.N)
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

			startedAt := time.Now()
			if _, err := cache.Get(context.Background(), hotKey); err != nil {
				recordError(fmt.Errorf("get %s: %w", hotKey, err))
			}
			getSamples <- time.Since(startedAt)

			startedAt = time.Now()
			if err := cache.Set(context.Background(), hotKey, fmt.Sprintf("cached-value-%d", i), time.Minute); err != nil {
				recordError(fmt.Errorf("set %s: %w", hotKey, err))
			}
			setSamples <- time.Since(startedAt)
		}
	})
	b.StopTimer()
	close(getSamples)
	close(setSamples)
	if firstErr != nil {
		b.Fatal(firstErr)
	}

	reportRedisCacheLatencyProfile(b, "redis_get_hit", getSamples)
	reportRedisCacheLatencyProfile(b, "redis_set_update", setSamples)
	cleanupRedisCacheLatencyKeys(b, rawRedis, prefix)
}

func setupRedisCacheLatencyBenchmark(b *testing.B) (*RedisCache, *goredis.Client, string) {
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

	prefix := fmt.Sprintf("bench:infra_cache:%d", time.Now().UnixNano())
	b.Cleanup(func() {
		cleanupRedisCacheLatencyKeys(b, rawRedis, prefix)
	})
	return NewRedisCacheWithClient(redisClientWrapper{client: rawRedis}), rawRedis, prefix
}

func cleanupRedisCacheLatencyKeys(b *testing.B, rawRedis *goredis.Client, prefix string) {
	b.Helper()
	_ = rawRedis.Del(context.Background(), prefix+":hot").Err()
}

func reportRedisCacheLatencyProfile(b *testing.B, name string, samples <-chan time.Duration) {
	b.Helper()
	ordered := make([]time.Duration, 0, len(samples))
	for sample := range samples {
		ordered = append(ordered, sample)
	}
	if len(ordered) == 0 {
		return
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(redisCacheDurationMicroseconds(redisCachePercentileDuration(ordered, 0.50)), name+"_p50_us")
	b.ReportMetric(redisCacheDurationMicroseconds(redisCachePercentileDuration(ordered, 0.95)), name+"_p95_us")
	b.ReportMetric(redisCacheDurationMicroseconds(redisCachePercentileDuration(ordered, 0.99)), name+"_p99_us")
}

func redisCachePercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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

func redisCacheDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}
