package handler

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/benchtest"
	infraratelimit "github.com/TaskForceAI/infrastructure/ratelimit/pkg"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
)

const redisOrgRateLimitKeyCount = 1024

func BenchmarkOrgRateLimitLatencyProfile(b *testing.B) {
	limiter := &mockLimiter{
		result: &RateLimitResult{
			Allowed:   true,
			Remaining: 99,
			ResetTime: time.Now().Add(time.Minute),
		},
	}
	deps := &RateLimitDeps{
		GetRedis: func() any { return &mockRedis{} },
		GetOrgID: func(r *http.Request) int {
			return 123
		},
		GetClientIP: func(r *http.Request) *string {
			ip := "192.168.1.1"
			return &ip
		},
		GetLogger: func() Logger { return &mockLogger{} },
		JSONError: func(w http.ResponseWriter, code int, message string) {
			w.WriteHeader(code)
		},
		NewLimiter: func(redis any, _ string) RateLimitChecker {
			return limiter
		},
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := WithOrgRateLimitDeps(100, time.Minute, deps)(next)
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/run", nil)
		resp := httptest.NewRecorder()
		startedAt := time.Now()
		handler.ServeHTTP(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
	}
	b.StopTimer()
	reportOrgRateLimitLatencyProfile(b, samples)
}

func BenchmarkRedisOrgRateLimitLatencyProfile(b *testing.B) {
	if os.Getenv("TASKFORCE_LATENCY_DEPS") != "1" {
		b.Skip("set TASKFORCE_LATENCY_DEPS=1 to run dependency-backed latency benchmarks")
	}

	ctx := context.Background()
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
	if err := rawRedis.Ping(ctx).Err(); err != nil {
		b.Fatalf("ping redis: %v", err)
	}

	client := infraredis.NewClient(rawRedis)
	keyPrefix := fmt.Sprintf("bench:dev_org_rl:%d", time.Now().UnixNano())
	b.Cleanup(func() {
		keys := make([]string, redisOrgRateLimitKeyCount)
		for i := range keys {
			keys[i] = fmt.Sprintf("%s:o:%d", keyPrefix, 1000+i)
		}
		_ = rawRedis.Del(context.Background(), keys...).Err()
	})

	currentOrgID := 1000
	deps := newRedisOrgRateLimitBenchmarkDeps(client, keyPrefix, func() int {
		return currentOrgID
	})
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := WithOrgRateLimitDeps(1_000_000, time.Minute, deps)(next)
	samples := make([]time.Duration, 0, b.N)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		currentOrgID = 1000 + (i % redisOrgRateLimitKeyCount)
		req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/run", nil)
		resp := httptest.NewRecorder()
		startedAt := time.Now()
		handler.ServeHTTP(resp, req)
		samples = append(samples, time.Since(startedAt))
		if resp.Code != http.StatusOK {
			b.Fatalf("unexpected status code: %d", resp.Code)
		}
	}
	b.StopTimer()
	reportOrgRateLimitLatencyProfile(b, samples)
}

func TestRedisOrgRateLimitBenchmarkDepsUseCleanupPrefix(t *testing.T) {
	redis := &recordingRedisCmdable{}
	const keyPrefix = "bench:dev_org_rl:test"
	deps := newRedisOrgRateLimitBenchmarkDeps(redis, keyPrefix, func() int {
		return 1007
	})
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := WithOrgRateLimitDeps(100, time.Minute, deps)(next)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/developer/run", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("unexpected status code: got %d want %d", resp.Code, http.StatusOK)
	}
	if got, want := redis.evalKeys, []string{keyPrefix + ":o:1007"}; len(got) != len(want) || got[0] != want[0] {
		t.Fatalf("redis keys = %v, want %v", got, want)
	}
}

func newRedisOrgRateLimitBenchmarkDeps(client infraredis.Cmdable, keyPrefix string, currentOrgID func() int) *RateLimitDeps {
	return &RateLimitDeps{
		GetRedis: func() any { return client },
		GetOrgID: func(r *http.Request) int {
			return currentOrgID()
		},
		GetClientIP: func(r *http.Request) *string {
			ip := "192.168.1.1"
			return &ip
		},
		GetLogger: func() Logger { return &mockLogger{} },
		JSONError: func(w http.ResponseWriter, code int, message string) {
			w.WriteHeader(code)
		},
		NewLimiter: func(redis any, _ string) RateLimitChecker {
			cmdable, ok := redis.(infraredis.Cmdable)
			if !ok {
				return nil
			}
			return redisRateLimitAdapter{limiter: infraratelimit.NewRedisLimiter(cmdable, keyPrefix)}
		},
	}
}

type redisRateLimitAdapter struct {
	limiter *infraratelimit.RedisLimiter
}

func (a redisRateLimitAdapter) Check(ctx any, key string, limit int, window time.Duration) (*RateLimitResult, error) {
	c, ok := ctx.(context.Context)
	if !ok {
		return nil, context.Canceled
	}
	result, err := a.limiter.Check(c, key, limit, window)
	if err != nil {
		return nil, err
	}
	return &RateLimitResult{
		Allowed:   result.Allowed,
		Remaining: result.Remaining,
		ResetTime: result.ResetTime,
	}, nil
}

func (a redisRateLimitAdapter) CheckOrg(ctx any, orgID int32, limit int, window time.Duration) (*RateLimitResult, error) {
	c, ok := ctx.(context.Context)
	if !ok {
		return nil, context.Canceled
	}
	result, err := a.limiter.CheckOrg(c, orgID, limit, window)
	if err != nil {
		return nil, err
	}
	return &RateLimitResult{
		Allowed:   result.Allowed,
		Remaining: result.Remaining,
		ResetTime: result.ResetTime,
	}, nil
}

func reportOrgRateLimitLatencyProfile(b *testing.B, samples []time.Duration) {
	b.Helper()
	if len(samples) == 0 {
		return
	}
	ordered := append([]time.Duration(nil), samples...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	b.ReportMetric(durationMicroseconds(benchtest.PercentileDuration(ordered, 0.50)), "p50_us")
	b.ReportMetric(durationMicroseconds(benchtest.PercentileDuration(ordered, 0.95)), "p95_us")
	b.ReportMetric(durationMicroseconds(benchtest.PercentileDuration(ordered, 0.99)), "p99_us")
}

func durationMicroseconds(duration time.Duration) float64 {
	return float64(duration.Nanoseconds()) / 1000
}

type recordingRedisCmdable struct {
	evalKeys []string
}

var _ infraredis.Cmdable = (*recordingRedisCmdable)(nil)

func (r *recordingRedisCmdable) Get(ctx context.Context, key string) (string, error) {
	return "", fmt.Errorf("unexpected Get for key %q", key)
}

func (r *recordingRedisCmdable) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return fmt.Errorf("unexpected Set for key %q", key)
}

func (r *recordingRedisCmdable) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	return false, fmt.Errorf("unexpected SetNX for key %q", key)
}

func (r *recordingRedisCmdable) Expire(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	return false, fmt.Errorf("unexpected Expire for key %q", key)
}

func (r *recordingRedisCmdable) TTL(ctx context.Context, key string) (time.Duration, error) {
	return 0, fmt.Errorf("unexpected TTL for key %q", key)
}

func (r *recordingRedisCmdable) Incr(ctx context.Context, key string) (int, error) {
	return 0, fmt.Errorf("unexpected Incr for key %q", key)
}

func (r *recordingRedisCmdable) Del(ctx context.Context, key string) (bool, error) {
	return false, fmt.Errorf("unexpected Del for key %q", key)
}

func (r *recordingRedisCmdable) XAdd(ctx context.Context, stream string, values map[string]any) (string, error) {
	return "", fmt.Errorf("unexpected XAdd for stream %q", stream)
}

func (r *recordingRedisCmdable) XRead(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
	return nil, fmt.Errorf("unexpected XRead for stream %q", stream)
}

func (r *recordingRedisCmdable) XTrimMaxLen(ctx context.Context, stream string, maxLen int64) (int64, error) {
	return 0, fmt.Errorf("unexpected XTrimMaxLen for stream %q", stream)
}

func (r *recordingRedisCmdable) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	return fmt.Errorf("unexpected Watch for keys %v", keys)
}

func (r *recordingRedisCmdable) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	r.evalKeys = append(r.evalKeys, keys...)
	cmd := goredis.NewCmd(ctx)
	cmd.SetVal([]any{int64(1), int64(99), time.Now().Add(time.Minute).UnixMilli()})
	return cmd
}
