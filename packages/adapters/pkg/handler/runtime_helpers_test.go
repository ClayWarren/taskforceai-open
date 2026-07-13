package handler

import (
	"context"
	"errors"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func resetRedisHelperState(t *testing.T) {
	t.Helper()
	reset := func() {
		redisMu.Lock()
		redisClient = nil
		redisClientFactory = nil
		redisOnce = sync.Once{}
		redisMu.Unlock()
	}
	reset()
	t.Cleanup(reset)
}

func TestRedisClientHelpers(t *testing.T) {
	resetRedisHelperState(t)
	if got := GetRedisClient(); got != nil {
		t.Fatalf("redis client = %v, want nil without configured client or factory", got)
	}

	client := newRedisTestClient()
	SetRedisClient(client)
	if got := GetRedisClient(); got != client {
		t.Fatalf("redis client = %v, want injected client", got)
	}

	resetRedisHelperState(t)
	calls := 0
	SetRedisClientFactory(func() (RedisClient, error) {
		calls++
		return client, nil
	})
	if got := GetRedisClient(); got != client {
		t.Fatalf("redis client = %v, want factory client", got)
	}
	if got := GetRedisClient(); got != client {
		t.Fatalf("redis client = %v, want cached factory client", got)
	}
	if calls != 1 {
		t.Fatalf("factory calls = %d, want 1", calls)
	}

	resetRedisHelperState(t)
	SetRedisClientFactory(func() (RedisClient, error) {
		return nil, errors.New("redis unavailable")
	})
	if got := GetRedisClient(); got != nil {
		t.Fatalf("redis client = %v, want nil after factory error", got)
	}
}

func TestRuntimeGetClientIPDelegatesToRequestMeta(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	req.Header.Set("X-Real-IP", "198.51.100.7")

	got := GetClientIP(req)
	if got == nil || *got != "198.51.100.7" {
		t.Fatalf("client ip = %v, want delegated header value", got)
	}
}

func TestGetRedisClientLazyInit(t *testing.T) {
	resetRedisHelperState(t)
	client := newRedisTestClient()
	SetRedisClientFactory(func() (RedisClient, error) {
		return client, nil
	})

	if got := GetRedisClient(); got != client {
		t.Fatal("redis client = nil, want factory client")
	}
}

type redisTestClient struct {
	values map[string]string
	err    error
}

func newRedisTestClient() *redisTestClient {
	return &redisTestClient{values: make(map[string]string)}
}

func (c *redisTestClient) Get(_ context.Context, key string) (string, error) {
	if c.err != nil {
		return "", c.err
	}
	value, ok := c.values[key]
	if !ok {
		return "", errors.New("key not found")
	}
	return value, nil
}

func (c *redisTestClient) Set(_ context.Context, key string, value []byte, _ time.Duration) error {
	if c.err != nil {
		return c.err
	}
	c.values[key] = string(value)
	return nil
}

func (c *redisTestClient) SetNX(_ context.Context, key string, value []byte, _ time.Duration) (bool, error) {
	if c.err != nil {
		return false, c.err
	}
	if _, ok := c.values[key]; ok {
		return false, nil
	}
	c.values[key] = string(value)
	return true, nil
}

func (c *redisTestClient) Del(_ context.Context, key string) (bool, error) {
	if c.err != nil {
		return false, c.err
	}
	_, ok := c.values[key]
	delete(c.values, key)
	return ok, nil
}

func (c *redisTestClient) Incr(_ context.Context, key string) (int, error) {
	if c.err != nil {
		return 0, c.err
	}
	return 1, nil
}
