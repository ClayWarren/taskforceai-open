package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
)

func TestMain_OpenAPI(t *testing.T) {
	originalArgs := os.Args
	os.Args = []string{"cmd", "--openapi"}
	t.Cleanup(func() { os.Args = originalArgs })

	var buf bytes.Buffer
	originalStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	os.Stdout = w
	t.Cleanup(func() { os.Stdout = originalStdout })

	main()

	_ = w.Close()
	_, _ = buf.ReadFrom(r)

	if buf.Len() == 0 {
		t.Fatalf("expected openapi output")
	}
}

type redisStartupStub struct {
	getErr error
}

func (s redisStartupStub) Get(ctx context.Context, key string) (string, error) {
	return "", s.getErr
}

func (s redisStartupStub) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return nil
}

func (s redisStartupStub) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	return false, nil
}

func (s redisStartupStub) Expire(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	return false, nil
}

func (s redisStartupStub) TTL(ctx context.Context, key string) (time.Duration, error) {
	return time.Minute, nil
}

func (s redisStartupStub) Incr(ctx context.Context, key string) (int, error) {
	return 0, nil
}

func (s redisStartupStub) Del(ctx context.Context, key string) (bool, error) {
	return false, nil
}

func (s redisStartupStub) XAdd(ctx context.Context, stream string, values map[string]any) (string, error) {
	return "", nil
}

func (s redisStartupStub) XRead(ctx context.Context, stream string, lastID string, count int64) ([]goredis.XMessage, error) {
	return nil, nil
}

func (s redisStartupStub) XTrimMaxLen(ctx context.Context, stream string, maxLen int64) (int64, error) {
	return 0, nil
}

func (s redisStartupStub) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	return nil
}

func (s redisStartupStub) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	return goredis.NewCmd(ctx)
}

func TestRedisStartupCheck(t *testing.T) {
	ctx := context.Background()
	originalGetRedisClient := getRedisClient
	t.Cleanup(func() { getRedisClient = originalGetRedisClient })

	t.Run("client lookup error", func(t *testing.T) {
		getRedisClient = func() (redis.Cmdable, error) {
			return nil, errors.New("redis unavailable")
		}
		err := redisStartupCheck(ctx)
		if err == nil || err.Error() != "redis unavailable" {
			t.Fatalf("expected redis unavailable error, got %v", err)
		}
	})

	t.Run("nil client", func(t *testing.T) {
		getRedisClient = func() (redis.Cmdable, error) {
			return nil, nil
		}
		err := redisStartupCheck(ctx)
		if err == nil || err.Error() != "redis client unavailable" {
			t.Fatalf("expected redis client unavailable error, got %v", err)
		}
	})

	t.Run("ping error", func(t *testing.T) {
		getRedisClient = func() (redis.Cmdable, error) {
			return redisStartupStub{getErr: errors.New("connection refused")}, nil
		}
		err := redisStartupCheck(ctx)
		if err == nil || err.Error() != "connection refused" {
			t.Fatalf("expected connection refused error, got %v", err)
		}
	})

	t.Run("missing key is healthy", func(t *testing.T) {
		getRedisClient = func() (redis.Cmdable, error) {
			return redisStartupStub{getErr: errors.New("key not found")}, nil
		}
		if err := redisStartupCheck(ctx); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}
	})

	t.Run("healthy ping", func(t *testing.T) {
		getRedisClient = func() (redis.Cmdable, error) {
			return redisStartupStub{}, nil
		}
		if err := redisStartupCheck(ctx); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}
	})
}
