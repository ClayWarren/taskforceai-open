package ratelimit

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCheckUserAndOrgDoesNotPartiallyConsume(t *testing.T) {
	limiter := NewRedisLimiter(infraredis.NewMockClient(), "combined")
	ctx := context.Background()

	first, err := limiter.CheckUserAndOrg(ctx, "user-a", 1, time.Hour, 1, 1, time.Hour)
	require.NoError(t, err)
	require.True(t, first.Allowed)

	rejected, err := limiter.CheckUserAndOrg(ctx, "user-a", 1, time.Hour, 2, 1, time.Hour)
	require.NoError(t, err)
	assert.False(t, rejected.Allowed)
	assert.False(t, rejected.User.Allowed)
	assert.True(t, rejected.Org.Allowed)

	orgStillAvailable, err := limiter.CheckUserAndOrg(ctx, "user-b", 1, time.Hour, 2, 1, time.Hour)
	require.NoError(t, err)
	assert.True(t, orgStillAvailable.Allowed)
}

type redisLimiterTestClient struct {
	mu       sync.Mutex
	windows  map[string][]int64
	evalFunc func(context.Context, string, []string, ...any) *goredis.Cmd
}

type redisLimiterScriptClient struct {
	redisLimiterTestClient
	ranScript bool
}

type redisLimiterNoEvalClient struct {
	redisLimiterTestClient
}

type redisLimiterNoEvalCheckerClient struct {
	redisLimiterTestClient
	checkFunc func(context.Context, string, int, time.Duration) (bool, int, time.Time, error)
}

func (c *redisLimiterTestClient) Get(context.Context, string) (string, error) {
	return "", nil
}

func (c *redisLimiterTestClient) Set(context.Context, string, []byte, time.Duration) error {
	return nil
}

func (c *redisLimiterTestClient) SetNX(context.Context, string, []byte, time.Duration) (bool, error) {
	return false, nil
}

func (c *redisLimiterTestClient) Expire(context.Context, string, time.Duration) (bool, error) {
	return true, nil
}

func (c *redisLimiterTestClient) TTL(context.Context, string) (time.Duration, error) {
	return time.Minute, nil
}

func (c *redisLimiterTestClient) Incr(context.Context, string) (int, error) {
	return 1, nil
}

func (c *redisLimiterTestClient) Del(context.Context, string) (bool, error) {
	return true, nil
}

func (c *redisLimiterTestClient) XAdd(context.Context, string, map[string]any) (string, error) {
	return "", nil
}

func (c *redisLimiterTestClient) XRead(context.Context, string, string, int64) ([]goredis.XMessage, error) {
	return nil, nil
}

func (c *redisLimiterTestClient) XTrimMaxLen(context.Context, string, int64) (int64, error) {
	return 0, nil
}

func (c *redisLimiterTestClient) Watch(context.Context, func(*goredis.Tx) error, ...string) error {
	return nil
}

func (c *redisLimiterTestClient) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	if c.evalFunc != nil {
		return c.evalFunc(ctx, script, keys, args...)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.windows == nil {
		c.windows = make(map[string][]int64)
	}

	key := keys[0]
	windowMillis := args[0].(int64)
	limit := args[1].(int)
	nowMillis := time.Now().UnixMilli()
	cutoff := nowMillis - windowMillis
	timestamps := c.windows[key]
	i := 0
	for i < len(timestamps) && timestamps[i] <= cutoff {
		i++
	}
	timestamps = timestamps[i:]

	allowed := 0
	if len(timestamps) < limit {
		allowed = 1
		timestamps = append(timestamps, nowMillis)
	}
	c.windows[key] = timestamps

	resetMillis := nowMillis + windowMillis
	if len(timestamps) > 0 {
		resetMillis = timestamps[0] + windowMillis
	}
	cmd := goredis.NewCmd(ctx)
	cmd.SetVal([]any{int64(allowed), int64(max(limit-len(timestamps), 0)), resetMillis})
	return cmd
}

func (c *redisLimiterScriptClient) RunScript(ctx context.Context, script *goredis.Script, keys []string, args ...any) *goredis.Cmd {
	c.ranScript = true
	return c.Eval(ctx, "", keys, args...)
}

func (c *redisLimiterNoEvalClient) SupportsEval() bool {
	return false
}

func (c *redisLimiterNoEvalCheckerClient) SupportsEval() bool {
	return false
}

func (c *redisLimiterNoEvalCheckerClient) CheckRateLimit(ctx context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
	return c.checkFunc(ctx, key, limit, window)
}

func TestNewRedisLimiter(t *testing.T) {
	// Test with custom prefix
	limiter := NewRedisLimiter(nil, "custom")
	if limiter.keyPrefix != "custom:" {
		t.Errorf("Expected key prefix 'custom:', got %s", limiter.keyPrefix)
	}

	// Test with empty prefix (should default to "rl")
	limiter = NewRedisLimiter(nil, "")
	if limiter.keyPrefix != "rl:" {
		t.Errorf("Expected default key prefix 'rl:', got %s", limiter.keyPrefix)
	}
}

func TestRateLimitResult_Struct(t *testing.T) {
	now := time.Now()
	result := RateLimitResult{
		Allowed:   true,
		Remaining: 5,
		ResetTime: now,
	}

	if !result.Allowed {
		t.Error("Expected Allowed to be true")
	}
	if result.Remaining != 5 {
		t.Errorf("Expected Remaining 5, got %d", result.Remaining)
	}
	if result.ResetTime != now {
		t.Error("ResetTime mismatch")
	}
}

func TestLimiterInterface(t *testing.T) {
	// Verify RedisLimiter implements Limiter interface
	var _ Limiter = (*RedisLimiter)(nil)
}

func TestRateLimitResult_AllowedFalse(t *testing.T) {
	result := RateLimitResult{
		Allowed:   false,
		Remaining: 0,
		ResetTime: time.Now(),
	}

	if result.Allowed {
		t.Error("Expected Allowed to be false")
	}
	if result.Remaining != 0 {
		t.Errorf("Expected Remaining 0, got %d", result.Remaining)
	}
}

func TestRateLimitResult_NegativeRemaining(t *testing.T) {
	result := RateLimitResult{
		Allowed:   false,
		Remaining: -5, // Should clamp to 0 in Check()
		ResetTime: time.Now(),
	}

	if result.Remaining < 0 {
		// This is what the Check method prevents, but we test the struct
		t.Log("Result struct allows negative remaining (clamping happens in Check)")
	}
}

// --- RedisLimiter.Check Tests ---

func TestRedisLimiter_Check_Allowed(t *testing.T) {
	mockClient := &redisLimiterTestClient{}
	limiter := NewRedisLimiter(mockClient, "test")
	ctx := context.Background()

	result, err := limiter.Check(ctx, "user:123", 10, time.Minute)

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if !result.Allowed {
		t.Error("Expected request to be allowed")
	}
	if result.Remaining != 9 {
		t.Errorf("Expected remaining 9, got %d", result.Remaining)
	}
}

func TestRedisLimiter_Check_MultipleRequests(t *testing.T) {
	mockClient := &redisLimiterTestClient{}
	limiter := NewRedisLimiter(mockClient, "test")
	ctx := context.Background()

	// Make 5 requests
	for i := range 5 {
		result, err := limiter.Check(ctx, "user:456", 10, time.Minute)
		if err != nil {
			t.Fatalf("Unexpected error on request %d: %v", i, err)
		}
		if !result.Allowed {
			t.Errorf("Expected request %d to be allowed", i)
		}
		expectedRemaining := 10 - (i + 1)
		if result.Remaining != expectedRemaining {
			t.Errorf("Request %d: expected remaining %d, got %d", i, expectedRemaining, result.Remaining)
		}
	}
}

func TestRedisLimiter_Check_ExceedsLimit(t *testing.T) {
	mockClient := &redisLimiterTestClient{}
	limiter := NewRedisLimiter(mockClient, "test")
	ctx := context.Background()

	// Make 3 requests with limit of 2
	for i := range 3 {
		result, err := limiter.Check(ctx, "user:789", 2, time.Minute)
		if err != nil {
			t.Fatalf("Unexpected error on request %d: %v", i, err)
		}

		if i < 2 {
			if !result.Allowed {
				t.Errorf("Expected request %d to be allowed", i)
			}
		} else {
			if result.Allowed {
				t.Errorf("Expected request %d to be denied (over limit)", i)
			}
			if result.Remaining != 0 {
				t.Errorf("Expected remaining 0 when over limit, got %d", result.Remaining)
			}
		}
	}
}

func TestRedisLimiter_Check_UsesSlidingWindow(t *testing.T) {
	mockClient := &redisLimiterTestClient{}
	limiter := NewRedisLimiter(mockClient, "test")
	ctx := context.Background()
	window := 80 * time.Millisecond

	for range 2 {
		result, err := limiter.Check(ctx, "user:sliding", 2, window)
		require.NoError(t, err)
		assert.True(t, result.Allowed)
	}

	time.Sleep(40 * time.Millisecond)
	result, err := limiter.Check(ctx, "user:sliding", 2, window)
	require.NoError(t, err)
	assert.False(t, result.Allowed)

	time.Sleep(50 * time.Millisecond)
	result, err = limiter.Check(ctx, "user:sliding", 2, window)
	require.NoError(t, err)
	assert.True(t, result.Allowed)
}

func TestRedisLimiter_Check_ZeroWindowSeconds(t *testing.T) {
	mockClient := &redisLimiterTestClient{}
	limiter := NewRedisLimiter(mockClient, "test")
	ctx := context.Background()

	// Window less than 1 second should be treated as 1 second
	result, err := limiter.Check(ctx, "user:zero", 10, 100*time.Millisecond)

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if !result.Allowed {
		t.Error("Expected request to be allowed")
	}
}

func TestRedisLimiter_Check_ResetTimeCalculation(t *testing.T) {
	mockClient := &redisLimiterTestClient{}
	limiter := NewRedisLimiter(mockClient, "test")
	ctx := context.Background()

	result, err := limiter.Check(ctx, "user:time", 10, time.Minute)

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Reset time should be in the future
	if !result.ResetTime.After(time.Now()) {
		t.Error("Expected ResetTime to be in the future")
	}

	// Reset time should be within ~1 minute
	if result.ResetTime.After(time.Now().Add(2 * time.Minute)) {
		t.Error("ResetTime too far in the future")
	}
}

func TestRedisLimiter_Check_DifferentKeys(t *testing.T) {
	mockClient := &redisLimiterTestClient{}
	limiter := NewRedisLimiter(mockClient, "test")
	ctx := context.Background()

	// Use up limit for user:a
	for i := range 3 {
		_, err := limiter.Check(ctx, "user:a", 2, time.Minute)
		if err != nil {
			t.Fatalf("Unexpected error on iteration %d: %v", i, err)
		}
	}

	// user:b should still have full limit
	result, err := limiter.Check(ctx, "user:b", 2, time.Minute)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if !result.Allowed {
		t.Error("Expected request for different key to be allowed")
	}
	if result.Remaining != 1 {
		t.Errorf("Expected remaining 1, got %d", result.Remaining)
	}
}

func TestRedisLimiter_CheckOrg(t *testing.T) {
	mockClient := &redisLimiterTestClient{}
	limiter := NewRedisLimiter(mockClient, "test")
	ctx := context.Background()

	result, err := limiter.CheckOrg(ctx, 456, 10, time.Minute)
	require.NoError(t, err)
	assert.True(t, result.Allowed)
	assert.Equal(t, 9, result.Remaining)
}

func TestRedisLimiter_Check_UsesUserKeyPrefix(t *testing.T) {
	var evalKey string
	limiter := NewRedisLimiter(&redisLimiterTestClient{
		evalFunc: func(ctx context.Context, _ string, keys []string, args ...any) *goredis.Cmd {
			evalKey = keys[0]
			cmd := goredis.NewCmd(ctx)
			cmd.SetVal([]any{int64(1), int64(9), time.Now().UnixMilli() + args[0].(int64)})
			return cmd
		},
	}, "test")

	result, err := limiter.Check(context.Background(), "user:contract", 10, time.Minute)

	require.NoError(t, err)
	assert.True(t, result.Allowed)
	assert.Equal(t, "test:u:user:contract", evalKey)
}

func TestRedisLimiter_CheckOrg_UsesOrgKeyPrefix(t *testing.T) {
	var evalKey string
	limiter := NewRedisLimiter(&redisLimiterTestClient{
		evalFunc: func(ctx context.Context, _ string, keys []string, args ...any) *goredis.Cmd {
			evalKey = keys[0]
			cmd := goredis.NewCmd(ctx)
			cmd.SetVal([]any{int64(1), int64(8), time.Now().UnixMilli() + args[0].(int64)})
			return cmd
		},
	}, "test")

	result, err := limiter.CheckOrg(context.Background(), 456, 10, time.Minute)

	require.NoError(t, err)
	assert.True(t, result.Allowed)
	assert.Equal(t, "test:o:456", evalKey)
}

func TestRedisLimiter_Check_RejectsNonPositiveLimit(t *testing.T) {
	limiter := NewRedisLimiter(&redisLimiterTestClient{}, "test")

	result, err := limiter.Check(context.Background(), "user:zero-limit", 0, time.Minute)

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "limit must be positive")
}

func TestRedisLimiter_Check_UsesClampedWindowTTLMillis(t *testing.T) {
	tests := []struct {
		name       string
		window     time.Duration
		expectedTT int64
	}{
		{
			name:       "sub-second window",
			window:     100 * time.Millisecond,
			expectedTT: 1100,
		},
		{
			name:       "negative window",
			window:     -5 * time.Second,
			expectedTT: 2000,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var ttlMillis int64
			limiter := NewRedisLimiter(&redisLimiterTestClient{
				evalFunc: func(ctx context.Context, _ string, _ []string, args ...any) *goredis.Cmd {
					ttlMillis = args[3].(int64)
					cmd := goredis.NewCmd(ctx)
					cmd.SetVal([]any{int64(1), int64(9), time.Now().UnixMilli() + args[0].(int64)})
					return cmd
				},
			}, "test")

			result, err := limiter.Check(context.Background(), "user:window", 10, tt.window)

			require.NoError(t, err)
			assert.True(t, result.Allowed)
			assert.Equal(t, tt.expectedTT, ttlMillis)
		})
	}
}

func TestRedisLimiter_Check_EvalError(t *testing.T) {
	expectedErr := errors.New("eval unavailable")
	limiter := NewRedisLimiter(&redisLimiterTestClient{
		evalFunc: func(ctx context.Context, _ string, _ []string, _ ...any) *goredis.Cmd {
			cmd := goredis.NewCmd(ctx)
			cmd.SetErr(expectedErr)
			return cmd
		},
	}, "test")

	result, err := limiter.Check(context.Background(), "user:error", 10, time.Minute)

	assert.Nil(t, result)
	require.ErrorIs(t, err, expectedErr)
	assert.Contains(t, err.Error(), "redis ratelimit failed")
}

func TestRedisLimiter_Check_NilClientReturnsError(t *testing.T) {
	limiter := NewRedisLimiter(nil, "test")

	result, err := limiter.Check(context.Background(), "user:nil", 10, time.Minute)

	assert.Nil(t, result)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "client is nil")
}

func TestRedisLimiter_Check_UsesScriptRunnerWhenAvailable(t *testing.T) {
	client := &redisLimiterScriptClient{}
	limiter := NewRedisLimiter(client, "test")

	result, err := limiter.Check(context.Background(), "user:script", 10, time.Minute)

	require.NoError(t, err)
	assert.True(t, result.Allowed)
	assert.True(t, client.ranScript)
}

func TestRedisLimiter_Check_UsesNoEvalRateLimitChecker(t *testing.T) {
	resetAt := time.Now().Add(time.Minute)
	client := &redisLimiterNoEvalCheckerClient{
		checkFunc: func(_ context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
			assert.Equal(t, "test:u:user:no-eval", key)
			assert.Equal(t, 10, limit)
			assert.Equal(t, time.Minute, window)
			return true, 7, resetAt, nil
		},
	}
	limiter := NewRedisLimiter(client, "test")

	result, err := limiter.Check(context.Background(), "user:no-eval", 10, time.Minute)

	require.NoError(t, err)
	assert.True(t, result.Allowed)
	assert.Equal(t, 7, result.Remaining)
	assert.Equal(t, resetAt, result.ResetTime)
}

func TestRedisLimiter_Check_PropagatesNoEvalRateLimitCheckerError(t *testing.T) {
	expectedErr := errors.New("fallback failed")
	client := &redisLimiterNoEvalCheckerClient{
		checkFunc: func(context.Context, string, int, time.Duration) (bool, int, time.Time, error) {
			return false, 0, time.Time{}, expectedErr
		},
	}
	limiter := NewRedisLimiter(client, "test")

	result, err := limiter.Check(context.Background(), "user:no-eval-error", 10, time.Minute)

	assert.Nil(t, result)
	require.ErrorIs(t, err, expectedErr)
	assert.Contains(t, err.Error(), "redis ratelimit failed")
}

func TestRedisLimiter_Check_FallsBackToEvalWhenNoEvalCheckerUnavailable(t *testing.T) {
	client := &redisLimiterNoEvalClient{}
	limiter := NewRedisLimiter(client, "test")

	result, err := limiter.Check(context.Background(), "user:no-checker", 10, time.Minute)

	require.NoError(t, err)
	assert.True(t, result.Allowed)
}

func TestSlidingWindowScript_UsesRedisTime(t *testing.T) {
	assert.Contains(t, slidingWindowScript, `redis.call("TIME")`)
	assert.NotContains(t, slidingWindowScript, `local now = tonumber(ARGV[1])`)
}

func TestParseSlidingWindowResult_RejectsMalformedResult(t *testing.T) {
	_, err := parseSlidingWindowResult([]any{int64(1)}, nil)

	assert.Error(t, err)
}

func TestParseSlidingWindowResult_ParsesRedisIntegerShapesAndClampsRemaining(t *testing.T) {
	resetMillis := time.Now().Add(time.Minute).UnixMilli()

	result, err := parseSlidingWindowResult([]any{1, "-5", float64(resetMillis)}, nil)

	require.NoError(t, err)
	assert.True(t, result.allowed)
	assert.Equal(t, 0, result.remaining)
	assert.Equal(t, resetMillis, result.resetMillis)
}

func TestParseSlidingWindowResult_ReturnsCommandError(t *testing.T) {
	expectedErr := errors.New("redis command failed")

	_, err := parseSlidingWindowResult(nil, expectedErr)

	require.ErrorIs(t, err, expectedErr)
}

func TestParseSlidingWindowResult_RejectsInvalidShapes(t *testing.T) {
	tests := []struct {
		name    string
		raw     any
		message string
	}{
		{
			name:    "non slice result",
			raw:     "not a redis array",
			message: "unexpected redis ratelimit result string",
		},
		{
			name:    "invalid allowed value",
			raw:     []any{true, int64(1), int64(2)},
			message: "parse allowed",
		},
		{
			name:    "invalid remaining value",
			raw:     []any{int64(1), struct{}{}, int64(2)},
			message: "parse remaining",
		},
		{
			name:    "invalid reset value",
			raw:     []any{int64(1), int64(1), []byte("2")},
			message: "parse reset",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parseSlidingWindowResult(tt.raw, nil)

			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.message)
		})
	}
}

func TestNewRateLimitMember_UsesRandomSuffix(t *testing.T) {
	now := time.Unix(123, 456)
	originalRandomRead := rateLimitRandomRead
	t.Cleanup(func() {
		rateLimitRandomRead = originalRandomRead
		resetRateLimitMemberState()
	})
	resetRateLimitMemberState()
	rateLimitRandomRead = func(b []byte) (int, error) {
		for i := range b {
			b[i] = byte(i + 1)
		}
		return len(b), nil
	}

	member := newRateLimitMember(now)

	assert.Equal(t, "123000000456:0102030405060708:1", member)
}

func TestNewRateLimitMember_FallsBackToSequenceWhenRandomFails(t *testing.T) {
	now := time.Unix(123, 456)
	originalRandomRead := rateLimitRandomRead
	t.Cleanup(func() {
		rateLimitRandomRead = originalRandomRead
		resetRateLimitMemberState()
	})
	resetRateLimitMemberState()
	rateLimitRandomRead = func([]byte) (int, error) {
		return 0, errors.New("entropy unavailable")
	}

	first := newRateLimitMember(now)
	second := newRateLimitMember(now)

	assert.NotEqual(t, first, second)
	assert.Equal(t, "123000000456:local:1", first)
	assert.Equal(t, "123000000456:local:2", second)
}

func TestRateLimitIdentityType(t *testing.T) {
	assert.Equal(t, "user", rateLimitIdentityType("user:123"))
	assert.Equal(t, "user", rateLimitIdentityType("id:123"))
	assert.Equal(t, "user", rateLimitIdentityType("person@example.com"))
	assert.Equal(t, "ip", rateLimitIdentityType("ip:203.0.113.10"))
	assert.Equal(t, "ip", rateLimitIdentityType("/api/login:203.0.113.10"))
	assert.Equal(t, "key", rateLimitIdentityType("custom:key"))
}

func resetRateLimitMemberState() {
	rateLimitMemberSequence.Store(0)
	rateLimitProcessTokenOnce = sync.Once{}
	rateLimitProcessToken = ""
}

func BenchmarkRedisLimiterCheck(b *testing.B) {
	limiter := NewRedisLimiter(&redisLimiterTestClient{}, "bench")
	ctx := context.Background()

	b.ReportAllocs()
	b.ResetTimer()

	for b.Loop() {
		result, err := limiter.Check(ctx, "user:bench", 1_000_000, time.Minute)
		if err != nil {
			b.Fatal(err)
		}
		if !result.Allowed {
			b.Fatal("expected request to be allowed")
		}
	}
}

func BenchmarkNewRateLimitMember(b *testing.B) {
	now := time.Unix(123, 456)

	b.ReportAllocs()
	b.ResetTimer()

	for b.Loop() {
		if newRateLimitMember(now) == "" {
			b.Fatal("expected member")
		}
	}
}

func BenchmarkParseSlidingWindowResult(b *testing.B) {
	raw := []any{int64(1), int64(5), time.Now().Add(time.Minute).UnixMilli()}

	b.ReportAllocs()
	b.ResetTimer()

	for b.Loop() {
		result, err := parseSlidingWindowResult(raw, nil)
		if err != nil {
			b.Fatal(err)
		}
		if !result.allowed {
			b.Fatal("expected allowed result")
		}
	}
}
