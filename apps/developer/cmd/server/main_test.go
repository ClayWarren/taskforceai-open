package main

import (
	"bytes"
	"context"
	"errors"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
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

func TestBuildServerConfig_UsesSecureRuntimeShell(t *testing.T) {
	config := buildServerConfig()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/developer/health", nil)
	rec := httptest.NewRecorder()

	config.Router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.NotEmpty(t, rec.Header().Get("X-Content-Type-Options"))
	assert.NotEmpty(t, rec.Header().Get("X-Correlation-ID"))
}

func TestDatabaseStartupCheck_NoDatabaseURL(t *testing.T) {
	postgres.Close()
	t.Cleanup(postgres.Close)

	t.Setenv("DATABASE_URL", "")
	err := databaseStartupCheck(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DATABASE_URL")
}

func TestRedisStartupCheck_ClientError(t *testing.T) {
	original := getRedisClient
	getRedisClient = func() (redis.Cmdable, error) {
		return nil, errors.New("redis unavailable")
	}
	t.Cleanup(func() { getRedisClient = original })

	err := redisStartupCheck(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redis unavailable")
}

func TestRedisStartupCheck_NilClient(t *testing.T) {
	original := getRedisClient
	getRedisClient = func() (redis.Cmdable, error) {
		return nil, nil
	}
	t.Cleanup(func() { getRedisClient = original })

	err := redisStartupCheck(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redis client unavailable")
}

func TestRedisStartupCheck_KeyNotFound(t *testing.T) {
	original := getRedisClient
	getRedisClient = func() (redis.Cmdable, error) {
		return &startupRedisClient{
			getFn: func(context.Context, string) (string, error) {
				return "", errors.New("key not found")
			},
		}, nil
	}
	t.Cleanup(func() { getRedisClient = original })

	err := redisStartupCheck(context.Background())
	assert.NoError(t, err)
}

func TestRedisStartupCheck_PingError(t *testing.T) {
	original := getRedisClient
	getRedisClient = func() (redis.Cmdable, error) {
		return &startupRedisClient{
			getFn: func(context.Context, string) (string, error) {
				return "", errors.New("connection refused")
			},
		}, nil
	}
	t.Cleanup(func() { getRedisClient = original })

	err := redisStartupCheck(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "connection refused")
}

type startupRedisClient struct {
	getFn func(ctx context.Context, key string) (string, error)
}

func (c *startupRedisClient) Get(ctx context.Context, key string) (string, error) {
	if c.getFn != nil {
		return c.getFn(ctx, key)
	}
	return "", nil
}

func (c *startupRedisClient) Set(context.Context, string, []byte, time.Duration) error {
	return nil
}

func (c *startupRedisClient) SetNX(context.Context, string, []byte, time.Duration) (bool, error) {
	return true, nil
}

func (c *startupRedisClient) Expire(context.Context, string, time.Duration) (bool, error) {
	return true, nil
}

func (c *startupRedisClient) TTL(context.Context, string) (time.Duration, error) {
	return time.Minute, nil
}

func (c *startupRedisClient) Incr(context.Context, string) (int, error) {
	return 1, nil
}

func (c *startupRedisClient) Del(context.Context, string) (bool, error) {
	return true, nil
}

func (c *startupRedisClient) XAdd(context.Context, string, map[string]any) (string, error) {
	return "", nil
}

func (c *startupRedisClient) XRead(context.Context, string, string, int64) ([]goredis.XMessage, error) {
	return nil, nil
}

func (c *startupRedisClient) XTrimMaxLen(context.Context, string, int64) (int64, error) {
	return 0, nil
}

func (c *startupRedisClient) Watch(context.Context, func(*goredis.Tx) error, ...string) error {
	return nil
}

func (c *startupRedisClient) Eval(context.Context, string, []string, ...any) *goredis.Cmd {
	return goredis.NewCmd(context.Background())
}

var _ redis.Cmdable = (*startupRedisClient)(nil)
