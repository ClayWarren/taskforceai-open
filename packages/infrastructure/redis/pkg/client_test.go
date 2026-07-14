package redis

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/extra/redisotel/v9"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestClient(t *testing.T) (*Client, *miniredis.Miniredis) {
	t.Helper()

	server := miniredis.RunT(t)
	redisClient := goredis.NewClient(&goredis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		assert.NoError(t, redisClient.Close())
	})

	return NewClient(redisClient), server
}

func TestClient_SetGetAndDelete(t *testing.T) {
	client, server := newTestClient(t)
	ctx := context.Background()

	assert.True(t, client.SupportsEval())

	require.NoError(t, client.Set(ctx, "key", []byte("value"), 0))
	value, err := server.Get("key")
	require.NoError(t, err)
	assert.Equal(t, "value", value)

	got, err := client.Get(ctx, "key")
	require.NoError(t, err)
	assert.Equal(t, "value", got)

	deleted, err := client.Del(ctx, "key")
	require.NoError(t, err)
	assert.True(t, deleted)

	_, err = client.Get(ctx, "key")
	assert.ErrorIs(t, err, ErrKeyNotFound)
}

func TestClient_SetWithTTL(t *testing.T) {
	client, server := newTestClient(t)

	err := client.Set(context.Background(), "key", []byte("value"), 250*time.Millisecond)
	require.NoError(t, err)
	value, err := server.Get("key")
	require.NoError(t, err)
	assert.Equal(t, "value", value)
	assert.Positive(t, server.TTL("key"))
}

func TestClient_SetNX(t *testing.T) {
	client, server := newTestClient(t)
	ctx := context.Background()

	ok, err := client.SetNX(ctx, "key", []byte("first"), time.Minute)
	require.NoError(t, err)
	assert.True(t, ok)

	ok, err = client.SetNX(ctx, "key", []byte("second"), time.Minute)
	require.NoError(t, err)
	assert.False(t, ok)
	value, err := server.Get("key")
	require.NoError(t, err)
	assert.Equal(t, "first", value)
}

func TestClient_Expire(t *testing.T) {
	client, server := newTestClient(t)
	ctx := context.Background()

	require.NoError(t, client.Set(ctx, "key", []byte("value"), 0))
	ok, err := client.Expire(ctx, "key", time.Minute)
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Positive(t, server.TTL("key"))

	ok, err = client.Expire(ctx, "missing", time.Minute)
	require.NoError(t, err)
	assert.False(t, ok)

	ok, err = client.Expire(ctx, "key", 0)
	require.Error(t, err)
	assert.False(t, ok)
}

func TestClient_TTLAndIncrWithExpire(t *testing.T) {
	client, server := newTestClient(t)
	ctx := context.Background()

	ttl, err := client.TTL(ctx, "missing")
	require.NoError(t, err)
	assert.Equal(t, -2*time.Nanosecond, ttl)

	require.NoError(t, client.Set(ctx, "permanent", []byte("value"), 0))
	ttl, err = client.TTL(ctx, "permanent")
	require.NoError(t, err)
	assert.Equal(t, -1*time.Nanosecond, ttl)

	value, err := client.IncrWithExpire(ctx, "counter", time.Minute)
	require.NoError(t, err)
	assert.Equal(t, 1, value)
	assert.Positive(t, server.TTL("counter"))

	value, err = client.IncrWithExpire(ctx, "counter", time.Minute)
	require.NoError(t, err)
	assert.Equal(t, 2, value)
	assert.Positive(t, server.TTL("counter"))

	value, err = client.IncrWithExpire(ctx, "counter", 0)
	require.Error(t, err)
	assert.Zero(t, value)
	got, err := client.Get(ctx, "counter")
	require.NoError(t, err)
	assert.Equal(t, "2", got)
}

func TestClient_Incr(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	value, err := client.Incr(ctx, "counter")
	require.NoError(t, err)
	assert.Equal(t, 1, value)

	value, err = client.Incr(ctx, "counter")
	require.NoError(t, err)
	assert.Equal(t, 2, value)
}

func TestClient_CheckRateLimit(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	allowed, remaining, resetAt, err := client.CheckRateLimit(ctx, "rl:user", 2, time.Minute)
	require.NoError(t, err)
	assert.True(t, allowed)
	assert.Equal(t, 1, remaining)
	assert.True(t, resetAt.After(time.Now()))

	allowed, remaining, _, err = client.CheckRateLimit(ctx, "rl:user", 2, time.Minute)
	require.NoError(t, err)
	assert.True(t, allowed)
	assert.Equal(t, 0, remaining)

	allowed, remaining, resetAt, err = client.CheckRateLimit(ctx, "rl:user", 2, time.Minute)
	require.NoError(t, err)
	assert.False(t, allowed)
	assert.Equal(t, 0, remaining)
	assert.True(t, resetAt.After(time.Now()))
}

func TestClient_CheckRateLimitClampsNonPositiveWindow(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	allowed, remaining, resetAt, err := client.CheckRateLimit(ctx, "rl:zero-window", 1, 0)
	require.NoError(t, err)
	assert.True(t, allowed)
	assert.Equal(t, 0, remaining)
	assert.False(t, resetAt.IsZero())
}

func TestClient_CheckRateLimitRejectsMalformedScriptResult(t *testing.T) {
	client, _ := newTestClient(t)
	originalScript := rateLimitScript
	t.Cleanup(func() {
		rateLimitScript = originalScript
	})
	rateLimitScript = goredis.NewScript(`return {"not-an-int", 0, 0}`)

	allowed, remaining, resetAt, err := client.CheckRateLimit(context.Background(), "rl:malformed", 1, time.Minute)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid allowed")
	assert.False(t, allowed)
	assert.Zero(t, remaining)
	assert.True(t, resetAt.IsZero())
}

func TestRedisScriptInt64(t *testing.T) {
	tests := []struct {
		name  string
		value any
		want  int64
		ok    bool
	}{
		{name: "int64", value: int64(42), want: 42, ok: true},
		{name: "int", value: 7, want: 7, ok: true},
		{name: "numeric string", value: "9", want: 9, ok: true},
		{name: "bad string", value: "nope", ok: false},
		{name: "unsupported", value: float64(1), ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := redisScriptInt64(tt.value)
			assert.Equal(t, tt.ok, ok)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestRedisKeyLogValueIsStableAndDoesNotExposeTheKey(t *testing.T) {
	const sensitiveKey = "rate-limit:203.0.113.42:user-123:idempotency-secret"

	first := redisKeyLogValue(sensitiveKey)
	second := redisKeyLogValue(sensitiveKey)

	assert.Equal(t, first, second)
	assert.NotContains(t, first, sensitiveKey)
	assert.NotContains(t, first, "203.0.113.42")
	assert.NotEqual(t, first, redisKeyLogValue(sensitiveKey+"-different"))
	assert.Regexp(t, `^sha256:[0-9a-f]{16}$`, first)
}

func TestParseRateLimitScriptResult(t *testing.T) {
	resetMillis := time.Now().Add(time.Minute).UnixMilli()

	allowed, remaining, resetAt, err := parseRateLimitScriptResult([]any{int64(1), int64(-2), resetMillis})
	require.NoError(t, err)
	assert.True(t, allowed)
	assert.Equal(t, 0, remaining)
	assert.Equal(t, time.UnixMilli(resetMillis), resetAt)

	tests := []struct {
		name    string
		raw     any
		message string
	}{
		{name: "unexpected shape", raw: "bad", message: "unexpected result"},
		{name: "unexpected length", raw: []any{int64(1)}, message: "unexpected result"},
		{name: "bad allowed", raw: []any{true, int64(0), resetMillis}, message: "invalid allowed"},
		{name: "bad remaining", raw: []any{int64(1), true, resetMillis}, message: "invalid remaining"},
		{name: "bad reset", raw: []any{int64(1), int64(0), true}, message: "invalid reset"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, _, err := parseRateLimitScriptResult(tt.raw)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.message)
		})
	}
}

func TestFirstXReadMessages(t *testing.T) {
	assert.Nil(t, firstXReadMessages(nil))
	assert.Nil(t, firstXReadMessages([]goredis.XStream{}))

	messages := []goredis.XMessage{{ID: "1-0", Values: map[string]any{"type": "test"}}}
	assert.Equal(t, messages, firstXReadMessages([]goredis.XStream{{Stream: "events", Messages: messages}}))
}

func TestClient_WatchDelegatesToRedisTransaction(t *testing.T) {
	client, server := newTestClient(t)
	ctx := context.Background()
	require.NoError(t, client.Set(ctx, "watched", []byte("initial"), 0))

	called := false
	err := client.Watch(ctx, func(tx *goredis.Tx) error {
		called = true
		return tx.Set(ctx, "watched", "updated", 0).Err()
	}, "watched")

	require.NoError(t, err)
	assert.True(t, called)
	value, err := server.Get("watched")
	require.NoError(t, err)
	assert.Equal(t, "updated", value)
}

func TestClient_ClosedRedisClientErrorBranches(t *testing.T) {
	redisClient := goredis.NewClient(&goredis.Options{Addr: "127.0.0.1:0"})
	require.NoError(t, redisClient.Close())
	client := NewClient(redisClient)
	ctx := context.Background()

	assert.True(t, client.SupportsEval())

	require.Error(t, client.Set(ctx, "key", []byte("value"), 0))
	ok, err := client.SetNX(ctx, "key", []byte("value"), time.Second)
	require.Error(t, err)
	assert.False(t, ok)

	ok, err = client.Expire(ctx, "key", time.Second)
	require.Error(t, err)
	assert.False(t, ok)

	ttl, err := client.TTL(ctx, "key")
	require.Error(t, err)
	assert.Zero(t, ttl)

	got, err := client.Get(ctx, "key")
	require.Error(t, err)
	assert.Empty(t, got)

	deleted, err := client.Del(ctx, "key")
	require.Error(t, err)
	assert.False(t, deleted)

	count, err := client.Incr(ctx, "key")
	require.Error(t, err)
	assert.Zero(t, count)

	count, err = client.IncrWithExpire(ctx, "key", time.Second)
	require.Error(t, err)
	assert.Zero(t, count)

	allowed, remaining, resetAt, err := client.CheckRateLimit(ctx, "key", 1, time.Second)
	require.Error(t, err)
	assert.False(t, allowed)
	assert.Zero(t, remaining)
	assert.True(t, resetAt.IsZero())

	id, err := client.XAdd(ctx, "stream", map[string]any{"type": "test"})
	require.Error(t, err)
	assert.Empty(t, id)

	messages, err := client.XRead(ctx, "stream", "0", 1)
	require.Error(t, err)
	assert.Nil(t, messages)

	messages, err = client.XReadBlock(ctx, "stream", "0", 1, time.Millisecond)
	require.Error(t, err)
	assert.Nil(t, messages)

	trimmed, err := client.XTrimMaxLen(ctx, "stream", 1)
	require.Error(t, err)
	assert.Zero(t, trimmed)

	err = client.Watch(ctx, func(*goredis.Tx) error {
		t.Fatal("watch callback should not run for a closed client")
		return nil
	}, "key")
	require.Error(t, err)
}

func TestClient_EvalAndStreams(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	result := client.Eval(ctx, "return ARGV[1]", []string{"key"}, "ok")
	require.NoError(t, result.Err())
	assert.Equal(t, "ok", result.Val())

	scriptResult := client.RunScript(ctx, goredis.NewScript("return ARGV[1]"), []string{"key"}, "scripted")
	require.NoError(t, scriptResult.Err())
	assert.Equal(t, "scripted", scriptResult.Val())

	id, err := client.XAdd(ctx, "events", map[string]any{"type": "test"})
	require.NoError(t, err)
	assert.NotEmpty(t, id)

	messages, err := client.XRead(ctx, "events", "0", 10)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	assert.Equal(t, "test", messages[0].Values["type"])

	messages, err = client.XReadBlock(ctx, "events", "0", 10, time.Millisecond)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	assert.Equal(t, "test", messages[0].Values["type"])

	messages, err = client.XReadBlock(ctx, "events", "0", 10, 0)
	require.Error(t, err)
	assert.Nil(t, messages)

	trimmed, err := client.XTrimMaxLen(ctx, "events", 1)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, trimmed, int64(0))
}

func TestClient_XReadEmptyStreamReturnsImmediately(t *testing.T) {
	client, _ := newTestClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	start := time.Now()
	messages, err := client.XRead(ctx, "empty-events", "$", 10)

	require.NoError(t, err)
	assert.Empty(t, messages)
	assert.Less(t, time.Since(start), 50*time.Millisecond)
}

func TestGetClientFromRedisURL(t *testing.T) {
	ResetClient()
	t.Cleanup(ResetClient)
	server := miniredis.RunT(t)
	t.Setenv("REDIS_URL", "redis://"+server.Addr())
	t.Setenv("REDIS_KV_URL", "")

	client, err := GetClient()
	require.NoError(t, err)
	require.NotNil(t, client)

	require.NoError(t, client.Set(context.Background(), "key", []byte("value"), 0))
	value, err := server.Get("key")
	require.NoError(t, err)
	assert.Equal(t, "value", value)
}

func TestGetPubSubClientFallsBackToRedisKVURL(t *testing.T) {
	ResetClient()
	t.Cleanup(ResetClient)
	server := miniredis.RunT(t)
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "redis://"+server.Addr())

	client, err := GetPubSubClient()
	require.NoError(t, err)
	require.NotNil(t, client)
	t.Cleanup(func() {
		assert.NoError(t, client.Close())
	})

	require.NoError(t, client.Set(context.Background(), "key", "value", 0).Err())
	value, err := server.Get("key")
	require.NoError(t, err)
	assert.Equal(t, "value", value)
}

func TestGetPubSubClientContinuesWhenInstrumentationFails(t *testing.T) {
	ResetClient()
	t.Cleanup(ResetClient)
	originalInstrumentRedisTracing := instrumentRedisTracing
	t.Cleanup(func() {
		instrumentRedisTracing = originalInstrumentRedisTracing
	})
	instrumentRedisTracing = func(goredis.UniversalClient, ...redisotel.TracingOption) error {
		return errors.New("otel unavailable")
	}

	server := miniredis.RunT(t)
	t.Setenv("REDIS_URL", "redis://"+server.Addr())
	t.Setenv("REDIS_KV_URL", "")

	client, err := GetPubSubClient()
	require.NoError(t, err)
	require.NotNil(t, client)
	t.Cleanup(func() {
		assert.NoError(t, client.Close())
	})
}

func TestGetPubSubClientCachesParseErrorUntilReset(t *testing.T) {
	ResetClient()
	t.Cleanup(ResetClient)
	t.Setenv("REDIS_URL", "://bad-url")
	t.Setenv("REDIS_KV_URL", "")

	client, err := GetPubSubClient()
	assert.Nil(t, client)
	require.Error(t, err)
	require.ErrorContains(t, err, "failed to parse redis url")

	server := miniredis.RunT(t)
	t.Setenv("REDIS_URL", "redis://"+server.Addr())
	client, err = GetPubSubClient()
	assert.Nil(t, client)
	require.ErrorContains(t, err, "failed to parse redis url")

	ResetClient()
	client, err = GetPubSubClient()
	require.NoError(t, err)
	require.NotNil(t, client)
	t.Cleanup(func() {
		assert.NoError(t, client.Close())
	})
}

func TestGetClientWithoutRedisURL(t *testing.T) {
	ResetClient()
	t.Cleanup(ResetClient)
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "")

	client, err := GetClient()
	assert.Nil(t, client)
	assert.ErrorContains(t, err, "REDIS_URL or REDIS_KV_URL must be set")
}

func TestGetClientReturnsCachedClient(t *testing.T) {
	ResetClient()
	t.Cleanup(ResetClient)
	mockClient := NewMockClient()
	SetClient(mockClient)

	got, err := GetClient()
	require.NoError(t, err)
	assert.Same(t, mockClient, got)
}

func TestGetClientConcurrentFirstUseRaceFree(t *testing.T) {
	ResetClient()
	t.Cleanup(ResetClient)
	server := miniredis.RunT(t)
	t.Setenv("REDIS_URL", "redis://"+server.Addr())
	t.Setenv("REDIS_KV_URL", "")

	const goroutines = 16
	ready := make(chan struct{})
	results := make(chan Cmdable, goroutines)
	errs := make(chan error, goroutines)
	var wg sync.WaitGroup
	for range goroutines {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-ready
			client, err := GetClient()
			results <- client
			errs <- err
		}()
	}

	close(ready)
	wg.Wait()
	close(results)
	close(errs)

	for err := range errs {
		require.NoError(t, err)
	}
	var first Cmdable
	for got := range results {
		require.NotNil(t, got)
		if first == nil {
			first = got
			continue
		}
		assert.Same(t, first, got)
	}
}

func TestMockClient(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	assert.False(t, client.SupportsEval())

	require.NoError(t, client.Set(ctx, "numeric", []byte("10"), time.Hour))
	value, err := client.Incr(ctx, "numeric")
	require.NoError(t, err)
	assert.Equal(t, 11, value)

	require.NoError(t, client.Set(ctx, "non-numeric", []byte("nope"), time.Hour))
	value, err = client.Incr(ctx, "non-numeric")
	require.ErrorIs(t, err, ErrValueNotInteger)
	assert.Zero(t, value)

	created, err := client.SetNX(ctx, "nx", []byte("first"), time.Hour)
	require.NoError(t, err)
	assert.True(t, created)
	created, err = client.SetNX(ctx, "nx", []byte("second"), time.Hour)
	require.NoError(t, err)
	assert.False(t, created)

	found, err := client.Del(ctx, "nx")
	require.NoError(t, err)
	assert.True(t, found)

	_, err = client.Get(ctx, "missing")
	assert.ErrorIs(t, err, ErrKeyNotFound)
}

func TestMockClient_ExpireMatchesClientValidation(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	ok, err := client.Expire(ctx, "missing", time.Minute)
	require.NoError(t, err)
	assert.False(t, ok)

	require.NoError(t, client.Set(ctx, "key", []byte("value"), 0))
	ok, err = client.Expire(ctx, "key", time.Minute)
	require.NoError(t, err)
	assert.True(t, ok)
	ttl, err := client.TTL(ctx, "key")
	require.NoError(t, err)
	assert.Positive(t, ttl)

	ok, err = client.Expire(ctx, "key", 0)
	require.Error(t, err)
	assert.False(t, ok)
	got, err := client.Get(ctx, "key")
	require.NoError(t, err)
	assert.Equal(t, "value", got)
}

func TestMockClient_EvalUnsupported(t *testing.T) {
	cmd := NewMockClient().Eval(context.Background(), "return 1", []string{"key"})

	require.Error(t, cmd.Err())
	assert.Contains(t, cmd.Err().Error(), "mock does not support eval")

	cmd = NewMockClient().RunScript(context.Background(), goredis.NewScript("return 1"), []string{"key"})

	require.Error(t, cmd.Err())
	assert.Contains(t, cmd.Err().Error(), "mock does not support eval")
}

func TestMockClient_WatchUnsupported(t *testing.T) {
	err := NewMockClient().Watch(context.Background(), func(*goredis.Tx) error {
		return nil
	}, "key")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "mock does not support watch")
}

func TestMockClient_StreamStubs(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	id, err := client.XAdd(ctx, "events", map[string]any{"type": "test"})
	require.NoError(t, err)
	assert.Equal(t, "mock-id", id)

	messages, err := client.XRead(ctx, "events", "0", 10)
	require.NoError(t, err)
	assert.Empty(t, messages)

	messages, err = client.XReadBlock(ctx, "events", "0", 10, time.Second)
	require.NoError(t, err)
	assert.Empty(t, messages)

	trimmed, err := client.XTrimMaxLen(ctx, "events", 1)
	require.NoError(t, err)
	assert.Zero(t, trimmed)
}

func TestMockClient_TTLExpiryAndRateLimit(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	ttl, err := client.TTL(ctx, "missing")
	require.NoError(t, err)
	assert.Equal(t, -2*time.Nanosecond, ttl)

	require.NoError(t, client.Set(ctx, "permanent", []byte("value"), 0))
	ttl, err = client.TTL(ctx, "permanent")
	require.NoError(t, err)
	assert.Equal(t, -1*time.Nanosecond, ttl)

	value, err := client.IncrWithExpire(ctx, "counter", 20*time.Millisecond)
	require.NoError(t, err)
	assert.Equal(t, 1, value)
	ttl, err = client.TTL(ctx, "counter")
	require.NoError(t, err)
	assert.Positive(t, ttl)

	time.Sleep(30 * time.Millisecond)
	_, err = client.Get(ctx, "counter")
	require.ErrorIs(t, err, ErrKeyNotFound)

	allowed, remaining, resetAt, err := client.CheckRateLimit(ctx, "rl:user", 1, time.Minute)
	require.NoError(t, err)
	assert.True(t, allowed)
	assert.Equal(t, 0, remaining)
	assert.True(t, resetAt.After(time.Now()))

	allowed, remaining, resetAt, err = client.CheckRateLimit(ctx, "rl:user", 1, time.Minute)
	require.NoError(t, err)
	assert.False(t, allowed)
	assert.Equal(t, 0, remaining)
	assert.True(t, resetAt.After(time.Now()))

	deleted, err := client.Del(ctx, "rl:user")
	require.NoError(t, err)
	assert.False(t, deleted)

	allowed, _, _, err = client.CheckRateLimit(ctx, "rl:user", 1, time.Minute)
	require.NoError(t, err)
	assert.True(t, allowed)
}

func TestMockClient_IncrWithExpireRejectsNonIntegerValue(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()
	require.NoError(t, client.Set(ctx, "counter", []byte("not-a-number"), 0))

	value, err := client.IncrWithExpire(ctx, "counter", time.Minute)

	require.ErrorIs(t, err, ErrValueNotInteger)
	assert.Zero(t, value)
}

func TestMockClient_IncrWithExpireRejectsNonPositiveTTL(t *testing.T) {
	client := NewMockClient()
	ctx := context.Background()

	value, err := client.IncrWithExpire(ctx, "counter", 0)

	require.Error(t, err)
	assert.Zero(t, value)
	_, err = client.Get(ctx, "counter")
	assert.ErrorIs(t, err, ErrKeyNotFound)
}

func TestMockClient_CheckRateLimitInitializesAndPrunesWindows(t *testing.T) {
	ctx := context.Background()
	client := &MockClient{
		data:    make(map[string]string),
		expires: make(map[string]time.Time),
	}

	allowed, remaining, _, err := client.CheckRateLimit(ctx, "rl:nil-map", 2, time.Minute)
	require.NoError(t, err)
	assert.True(t, allowed)
	assert.Equal(t, 1, remaining)
	assert.NotNil(t, client.rateLimits)

	pruningClient := NewMockClient()
	allowed, remaining, _, err = pruningClient.CheckRateLimit(ctx, "rl:prune", 1, time.Millisecond)
	require.NoError(t, err)
	assert.True(t, allowed)
	assert.Equal(t, 0, remaining)

	time.Sleep(2 * time.Millisecond)
	allowed, remaining, _, err = pruningClient.CheckRateLimit(ctx, "rl:prune", 1, time.Millisecond)
	require.NoError(t, err)
	assert.True(t, allowed)
	assert.Equal(t, 0, remaining)
}

func TestMockClient_CheckRateLimitPartiallyPrunesWindow(t *testing.T) {
	ctx := context.Background()
	client := NewMockClient()

	// Seed one expired timestamp (outside the window) and one live timestamp
	// (inside the window). CheckRateLimit must drop the expired entry while
	// retaining the live one.
	now := time.Now()
	window := time.Minute
	client.rateLimits["rl:partial"] = []time.Time{
		now.Add(-2 * window), // expired
		now.Add(-window / 2), // still within window
	}

	allowed, remaining, _, err := client.CheckRateLimit(ctx, "rl:partial", 3, window)
	require.NoError(t, err)
	assert.True(t, allowed)
	// One retained live entry plus the newly appended one leaves 1 slot of 3.
	assert.Equal(t, 1, remaining)
	assert.Len(t, client.rateLimits["rl:partial"], 2)
}

func TestErrorSentinels(t *testing.T) {
	assert.Equal(t, "key not found", ErrKeyNotFound.Error())
	assert.Equal(t, "value is not an integer or out of range", ErrValueNotInteger.Error())
}
