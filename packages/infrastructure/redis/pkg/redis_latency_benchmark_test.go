package redis

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

const redisClientLatencyKeyCount = 1024

func BenchmarkRedisClientLatencyProfile(b *testing.B) {
	client, rawRedis, prefix := setupRedisClientLatencyBenchmark(b)
	ctx := context.Background()
	for i := range redisClientLatencyKeyCount {
		requireRedisClientBenchmarkNoError(b, client.Set(ctx, fmt.Sprintf("%s:get:%d", prefix, i), []byte("cached-value"), time.Minute))
	}
	streamKey := prefix + ":stream"
	requireRedisClientBenchmarkNoError(b, rawRedis.XAdd(ctx, &goredis.XAddArgs{
		Stream: streamKey,
		Values: map[string]any{"seed": "true"},
	}).Err())

	getSamples := make(chan time.Duration, b.N)
	setSamples := make(chan time.Duration, b.N)
	incrSamples := make(chan time.Duration, b.N)
	xaddSamples := make(chan time.Duration, b.N)
	xreadSamples := make(chan time.Duration, b.N)
	xtrimSamples := make(chan time.Duration, b.N)
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
			slot := i % redisClientLatencyKeyCount
			getKey := fmt.Sprintf("%s:get:%d", prefix, slot)
			setKey := fmt.Sprintf("%s:set:%d", prefix, slot)
			incrKey := fmt.Sprintf("%s:incr:%d", prefix, slot)

			startedAt := time.Now()
			if _, err := client.Get(context.Background(), getKey); err != nil {
				recordError(fmt.Errorf("get %s: %w", getKey, err))
			}
			getSamples <- time.Since(startedAt)

			startedAt = time.Now()
			if err := client.Set(context.Background(), setKey, []byte("cached-value"), time.Minute); err != nil {
				recordError(fmt.Errorf("set %s: %w", setKey, err))
			}
			setSamples <- time.Since(startedAt)

			startedAt = time.Now()
			if _, err := client.IncrWithExpire(context.Background(), incrKey, time.Minute); err != nil {
				recordError(fmt.Errorf("incr with expire %s: %w", incrKey, err))
			}
			incrSamples <- time.Since(startedAt)

			startedAt = time.Now()
			if _, err := client.XAdd(context.Background(), streamKey, map[string]any{"slot": slot}); err != nil {
				recordError(fmt.Errorf("xadd %s: %w", streamKey, err))
			}
			xaddSamples <- time.Since(startedAt)

			startedAt = time.Now()
			if _, err := client.XRead(context.Background(), streamKey, "0", 1); err != nil {
				recordError(fmt.Errorf("xread %s: %w", streamKey, err))
			}
			xreadSamples <- time.Since(startedAt)

			startedAt = time.Now()
			if _, err := client.XTrimMaxLen(context.Background(), streamKey, 4096); err != nil {
				recordError(fmt.Errorf("xtrim %s: %w", streamKey, err))
			}
			xtrimSamples <- time.Since(startedAt)
		}
	})
	b.StopTimer()
	close(getSamples)
	close(setSamples)
	close(incrSamples)
	close(xaddSamples)
	close(xreadSamples)
	close(xtrimSamples)
	if firstErr != nil {
		b.Fatal(firstErr)
	}

	reportRedisClientLatencyProfile(b, "redis_get", getSamples)
	reportRedisClientLatencyProfile(b, "redis_set", setSamples)
	reportRedisClientLatencyProfile(b, "redis_incr_with_expire", incrSamples)
	reportRedisClientLatencyProfile(b, "redis_xadd", xaddSamples)
	reportRedisClientLatencyProfile(b, "redis_xread", xreadSamples)
	reportRedisClientLatencyProfile(b, "redis_xtrim", xtrimSamples)
	cleanupRedisClientLatencyKeys(b, rawRedis, prefix)
}

func setupRedisClientLatencyBenchmark(b *testing.B) (*Client, *goredis.Client, string) {
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

	prefix := fmt.Sprintf("bench:infra_redis:%d", time.Now().UnixNano())
	b.Cleanup(func() {
		cleanupRedisClientLatencyKeys(b, rawRedis, prefix)
	})
	return NewClient(rawRedis), rawRedis, prefix
}

func cleanupRedisClientLatencyKeys(b *testing.B, rawRedis *goredis.Client, prefix string) {
	b.Helper()
	ctx := context.Background()
	keys := make([]string, 0, redisClientLatencyKeyCount*3+1)
	for i := range redisClientLatencyKeyCount {
		keys = append(keys,
			fmt.Sprintf("%s:get:%d", prefix, i),
			fmt.Sprintf("%s:set:%d", prefix, i),
			fmt.Sprintf("%s:incr:%d", prefix, i),
		)
	}
	keys = append(keys, prefix+":stream")
	_ = rawRedis.Del(ctx, keys...).Err()
}

func reportRedisClientLatencyProfile(b *testing.B, name string, samples <-chan time.Duration) {
	b.Helper()
	ordered := make([]time.Duration, 0, len(samples))
	for sample := range samples {
		ordered = append(ordered, sample)
	}
	if len(ordered) == 0 {
		return
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(redisClientDurationMicroseconds(redisClientPercentileDuration(ordered, 0.50)), name+"_p50_us")
	b.ReportMetric(redisClientDurationMicroseconds(redisClientPercentileDuration(ordered, 0.95)), name+"_p95_us")
	b.ReportMetric(redisClientDurationMicroseconds(redisClientPercentileDuration(ordered, 0.99)), name+"_p99_us")
}

func redisClientPercentileDuration(ordered []time.Duration, percentile float64) time.Duration {
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

func redisClientDurationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}

func requireRedisClientBenchmarkNoError(b *testing.B, err error) {
	b.Helper()
	if err != nil {
		b.Fatal(err)
	}
}
