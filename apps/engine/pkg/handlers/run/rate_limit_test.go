package run

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	runp "github.com/TaskForceAI/go-engine/pkg/run"
	redispkg "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type evalRateLimitRedis struct {
	*redispkg.MockClient
	mu      sync.Mutex
	entries map[string][]int64
}

func newEvalRateLimitRedis() *evalRateLimitRedis {
	return &evalRateLimitRedis{
		MockClient: redispkg.NewMockClient(),
		entries:    make(map[string][]int64),
	}
}

func (c *evalRateLimitRedis) Eval(ctx context.Context, _ string, keys []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	if len(keys) != 1 || len(args) < 3 {
		cmd.SetErr(assert.AnError)
		return cmd
	}

	windowMillis := args[0].(int64)
	limit := args[1].(int)
	now := time.Now().UnixMilli()
	cutoff := now - windowMillis
	key := keys[0]

	c.mu.Lock()
	defer c.mu.Unlock()

	entries := c.entries[key]
	active := entries[:0]
	for _, entry := range entries {
		if entry > cutoff {
			active = append(active, entry)
		}
	}

	reset := now + windowMillis
	if len(active) > 0 {
		reset = active[0] + windowMillis
	}
	if len(active) >= limit {
		c.entries[key] = active
		cmd.SetVal([]any{int64(0), int64(0), reset})
		return cmd
	}

	active = append(active, now)
	c.entries[key] = active
	cmd.SetVal([]any{int64(1), int64(limit - len(active)), reset})
	return cmd
}

func (c *evalRateLimitRedis) CheckRateLimit(_ context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
	windowMillis := window.Milliseconds()
	if windowMillis <= 0 {
		windowMillis = 1
	}
	now := time.Now().UnixMilli()
	cutoff := now - windowMillis

	c.mu.Lock()
	defer c.mu.Unlock()

	entries := c.entries[key]
	active := entries[:0]
	for _, entry := range entries {
		if entry > cutoff {
			active = append(active, entry)
		}
	}

	reset := now + windowMillis
	if len(active) > 0 {
		reset = active[0] + windowMillis
	}
	if len(active) >= limit {
		c.entries[key] = active
		return false, 0, time.UnixMilli(reset), nil
	}

	active = append(active, now)
	c.entries[key] = active
	remaining := limit - len(active)
	if remaining < 0 {
		remaining = 0
	}
	return true, remaining, time.UnixMilli(reset), nil
}

func TestEnforceRunRateLimit_FallbackWhenRedisUnavailable(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})

	t.Setenv("NODE_ENV", "development")
	err := enforceRunRateLimit(context.Background(), "dev@example.com", 1, 0)
	assert.NoError(t, err)
}

func TestEnforceRunRateLimit_PublicWrapper(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})
	swap(t, &fallbackRunLimiter, newInMemoryWindowCounter())

	t.Setenv("NODE_ENV", "development")
	err := EnforceRunRateLimit(context.Background(), "wrapper@example.com", 1, 0)
	assert.NoError(t, err)
}

func TestEnforceRunRateLimit_OrgExceededViaRedis(t *testing.T) {
	client := newEvalRateLimitRedis()
	client.entries["rl:run:o:42"] = make([]int64, 50)
	for i := range client.entries["rl:run:o:42"] {
		client.entries["rl:run:o:42"][i] = time.Now().UnixMilli()
	}
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return client, nil
	})

	err := enforceRunRateLimit(context.Background(), "org-user@example.com", 1, 42)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Organization rate limit exceeded")
}

func TestEnforceRunRateLimit_OrgFallbackWhenRedisUnavailable(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})

	t.Setenv("NODE_ENV", "development")
	err := enforceRunRateLimit(context.Background(), "", 1, 99)
	assert.NoError(t, err)
}

func TestEnforceRunRateLimit_OrgRedisIncrFailureUsesFallback(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return &failingIncrRedisClient{MockClient: redispkg.NewMockClient(), incrErr: errors.New("incr failed")}, nil
	})

	t.Setenv("NODE_ENV", "development")
	swap(t, &fallbackRunLimiter, newInMemoryWindowCounter())

	err := enforceRunRateLimit(context.Background(), "org-fallback@example.com", 1, 7)
	assert.NoError(t, err)
}

func TestEnforceRunRateLimit_ProductionRedisUnavailable(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})

	t.Setenv("GO_ENV", "production")
	err := enforceRunRateLimit(context.Background(), "prod@example.com", 1, 0)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Rate limiter service unavailable")
}

func TestEnforceRunRateLimit_ProductionRedisCommandFailureFailsClosed(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return &failingIncrRedisClient{
			MockClient: redispkg.NewMockClient(),
			incrErr:    context.DeadlineExceeded,
		}, nil
	})

	t.Setenv("GO_ENV", "production")
	err := enforceRunRateLimit(context.Background(), "prod-timeout@example.com", 1, 0)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Rate limiter service unavailable")
}

func TestEnforceRunRateLimit_UserExceededViaRedis(t *testing.T) {
	client := newEvalRateLimitRedis()
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return client, nil
	})

	for range 10 {
		require.NoError(t, enforceRunRateLimit(context.Background(), "redis-user@example.com", 1, 0))
	}
	err := enforceRunRateLimit(context.Background(), "redis-user@example.com", 1, 0)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "User rate limit exceeded")
}

func TestEnforceRunRateLimit_UserLimitExceededInFallback(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})

	t.Setenv("NODE_ENV", "development")
	fallbackRunLimiter = newInMemoryWindowCounter()
	for range 10 {
		require.NoError(t, enforceRunRateLimit(context.Background(), "same@example.com", 1, 0))
	}
	err := enforceRunRateLimit(context.Background(), "same@example.com", 1, 0)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "User rate limit exceeded")
}

func TestInMemoryWindowCounter_EvictsExpiredEntries(t *testing.T) {
	counter := &inMemoryWindowCounter{
		windows:       make(map[string]inMemoryWindow),
		sweepInterval: time.Millisecond,
	}
	window := time.Millisecond

	const count = 200
	for i := range count {
		if !counter.allow(fmt.Sprintf("u:%d", i), 1, window) {
			t.Fatalf("unexpected reject for key %d", i)
		}
	}

	time.Sleep(3 * time.Millisecond)
	if !counter.allow("fresh", 1, time.Minute) {
		t.Fatal("expected fresh key to pass")
	}

	counter.mu.Lock()
	size := len(counter.windows)
	counter.mu.Unlock()
	if size != 1 {
		t.Fatalf("expected only fresh key after eviction, got %d", size)
	}
}

func TestInMemoryWindowCounter_DefaultSweepInterval(t *testing.T) {
	counter := &inMemoryWindowCounter{
		windows: map[string]inMemoryWindow{
			"expired": {count: 1, resetAt: time.Now().Add(-time.Minute)},
		},
		lastSweep: time.Now().Add(-time.Hour),
	}

	assert.True(t, counter.allow("fresh", 1, time.Minute))
	counter.mu.Lock()
	_, expiredFound := counter.windows["expired"]
	counter.mu.Unlock()
	assert.False(t, expiredFound)
}

func TestInMemoryWindowCounter_StillEnforcesLimitWithinWindow(t *testing.T) {
	counter := &inMemoryWindowCounter{
		windows:       make(map[string]inMemoryWindow),
		sweepInterval: time.Hour,
	}

	if !counter.allow("user:1", 1, time.Minute) {
		t.Fatal("expected first call to pass")
	}
	if counter.allow("user:1", 1, time.Minute) {
		t.Fatal("expected second call within window to be blocked")
	}
}

func BenchmarkRateLimitKeyFormatting(b *testing.B) {
	b.Run("fmt-user", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_ = fmt.Sprintf("id:%d", i)
		}
	})
	b.Run("itoa-user", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_ = rateLimitUserIDKey(i)
		}
	})
	b.Run("fmt-org", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_ = fmt.Sprintf("org:%d", i)
		}
	})
}

func BenchmarkEnforceRunRateLimitFallbackKeys(b *testing.B) {
	originalGetter := runp.RedisClientGetter
	originalLimiter := fallbackRunLimiter
	originalLogger := slog.Default()
	runp.RedisClientGetter = func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	}
	fallbackRunLimiter = newInMemoryWindowCounter()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() {
		runp.RedisClientGetter = originalGetter
		fallbackRunLimiter = originalLimiter
		slog.SetDefault(originalLogger)
	})
	b.Setenv("NODE_ENV", "development")

	ctx := context.Background()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if err := enforceRunRateLimit(ctx, "", i+1, i+100); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkEnforceAttachmentUploadRateLimitFallbackKey(b *testing.B) {
	originalGetter := runp.RedisClientGetter
	originalLimiter := fallbackRunLimiter
	originalLogger := slog.Default()
	runp.RedisClientGetter = func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	}
	fallbackRunLimiter = newInMemoryWindowCounter()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() {
		runp.RedisClientGetter = originalGetter
		fallbackRunLimiter = originalLimiter
		slog.SetDefault(originalLogger)
	})
	b.Setenv("NODE_ENV", "development")

	ctx := context.Background()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		if err := enforceAttachmentUploadRateLimit(ctx, "", i+1); err != nil {
			b.Fatal(err)
		}
	}
}

func TestEnforceAttachmentUploadRateLimit_FallbackAndExceeded(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})
	swap(t, &fallbackRunLimiter, newInMemoryWindowCounter())
	t.Setenv("NODE_ENV", "development")

	for range 30 {
		require.NoError(t, enforceAttachmentUploadRateLimit(context.Background(), "", 7))
	}
	err := enforceAttachmentUploadRateLimit(context.Background(), "", 7)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Attachment upload rate limit exceeded")
}

func TestEnforceAttachmentUploadRateLimit_RedisSuccessAndExceeded(t *testing.T) {
	client := newEvalRateLimitRedis()
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return client, nil
	})

	for range 30 {
		require.NoError(t, enforceAttachmentUploadRateLimit(context.Background(), "redis-attachment@example.com", 7))
	}
	err := enforceAttachmentUploadRateLimit(context.Background(), "redis-attachment@example.com", 7)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Attachment upload rate limit exceeded")
}

func TestEnforceAttachmentUploadRateLimit_RedisErrorFallbackAndProductionFailure(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return &failingIncrRedisClient{MockClient: redispkg.NewMockClient(), incrErr: context.DeadlineExceeded}, nil
	})
	swap(t, &fallbackRunLimiter, newInMemoryWindowCounter())
	t.Setenv("NODE_ENV", "development")
	require.NoError(t, enforceAttachmentUploadRateLimit(context.Background(), "dev-attachment@example.com", 7))

	t.Setenv("GO_ENV", "production")
	err := enforceAttachmentUploadRateLimit(context.Background(), "prod-attachment@example.com", 7)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Rate limiter service unavailable")
}

func TestEnforceAttachmentUploadRateLimit_ProductionRedisUnavailable(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})
	t.Setenv("GO_ENV", "production")

	err := enforceAttachmentUploadRateLimit(context.Background(), "prod@example.com", 7)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Rate limiter service unavailable")
}

func TestEnforceRunRateLimit_OrgFallbackExceededAndRedisAllowed(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	})
	swap(t, &fallbackRunLimiter, newInMemoryWindowCounter())
	t.Setenv("NODE_ENV", "development")

	for i := range 50 {
		require.NoError(t, enforceRunRateLimit(context.Background(), fmt.Sprintf("org-user-%d@example.com", i), i+1, 77))
	}
	err := enforceRunRateLimit(context.Background(), "org-user-over@example.com", 999, 77)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Organization rate limit exceeded")

	client := newEvalRateLimitRedis()
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return client, nil
	})
	require.NoError(t, enforceRunRateLimit(context.Background(), "redis-org@example.com", 1, 42))
}

func TestEnforceRunRateLimit_ProductionOrgRedisFailureFailsClosed(t *testing.T) {
	swap(t, &runp.RedisClientGetter, func() (redispkg.Cmdable, error) {
		return &failingIncrRedisClient{MockClient: redispkg.NewMockClient(), incrErr: context.DeadlineExceeded}, nil
	})
	t.Setenv("GO_ENV", "production")

	err := enforceRunRateLimit(context.Background(), "prod-org@example.com", 1, 42)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "Rate limiter service unavailable")
}
