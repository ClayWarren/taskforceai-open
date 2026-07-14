package taskregistry

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	miniredis "github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) {
	redis.SetClient(redis.NewMockClient())
	code := m.Run()
	redis.SetClient(redis.NewMockClient())
	os.Exit(code)
}

func requireTaskRegistry(t testing.TB) *TaskRegistry {
	t.Helper()
	return &TaskRegistry{}
}

type evalResultRedis struct {
	*redis.MockClient
	result any
	err    error
}

func (c *evalResultRedis) SupportsEval() bool { return true }

func (c *evalResultRedis) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	if c.err != nil {
		cmd.SetErr(c.err)
		return cmd
	}
	cmd.SetVal(c.result)
	return cmd
}

type updateLockBusyRedis struct{ *redis.MockClient }

func (c *updateLockBusyRedis) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if strings.HasPrefix(key, "task:update_lock:") {
		return false, nil
	}
	return c.MockClient.SetNX(ctx, key, value, ttl)
}

type startLockBusyRedis struct{ *redis.MockClient }

func (c *startLockBusyRedis) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if strings.HasPrefix(key, "task:start_lock:") {
		return false, nil
	}
	return c.MockClient.SetNX(ctx, key, value, ttl)
}

type taskGetErrorRedis struct{ *redis.MockClient }

func (c *taskGetErrorRedis) Get(ctx context.Context, key string) (string, error) {
	if strings.HasPrefix(key, "task:") && !strings.Contains(key, "lock") {
		return "", errors.New("connection reset by peer")
	}
	return c.MockClient.Get(ctx, key)
}

type failingTaskSaveRedis struct{ *redis.MockClient }

func (c *failingTaskSaveRedis) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if strings.HasPrefix(key, "task:") {
		return errors.New("save failed")
	}
	return c.MockClient.Set(ctx, key, value, ttl)
}

func setupLuaMiniredis(t *testing.T) *goredis.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	redis.SetClient(redis.NewClient(rdb))
	t.Cleanup(func() {
		require.NoError(t, rdb.Close())
		mr.Close()
		redis.SetClient(redis.NewMockClient())
	})
	return rdb
}

func seedLuaTaskRedis(t *testing.T, rdb *goredis.Client, taskID string, payload any) {
	t.Helper()
	ctx := context.Background()
	switch typed := payload.(type) {
	case string:
		require.NoError(t, rdb.Set(ctx, "task:"+taskID, typed, time.Hour).Err())
	case []byte:
		require.NoError(t, rdb.Set(ctx, "task:"+taskID, typed, time.Hour).Err())
	default:
		data, err := json.Marshal(typed)
		require.NoError(t, err)
		require.NoError(t, rdb.Set(ctx, "task:"+taskID, data, time.Hour).Err())
	}
}

func seedLuaProcessingTask(t *testing.T, rdb *goredis.Client, taskID string) {
	t.Helper()
	seedLuaTaskRedis(t, rdb, taskID, &TaskState{
		TaskID: taskID, Status: StatusProcessing, UpdatedAt: time.Now().Unix(),
	})
}

type luaUpdateProgressEvalInput struct {
	agentStatuses   string
	toolEvents      string
	budgetUsage     string
	updatedAt       any
	ttlSeconds      *int
	progressVersion any
	shortArgs       bool
}

func runLuaUpdateProgressEval(t *testing.T, rdb *goredis.Client, taskID string, input luaUpdateProgressEvalInput) error {
	t.Helper()
	ctx := context.Background()
	key := "task:" + taskID
	updatedAt := input.updatedAt
	if updatedAt == nil {
		updatedAt = time.Now().Unix()
	}
	if input.shortArgs {
		_, err := rdb.Eval(ctx, updateProgressScript, []string{key}, input.agentStatuses, input.toolEvents, input.budgetUsage, updatedAt).Result()
		return err
	}
	ttl := int(TaskTTL.Seconds())
	if input.ttlSeconds != nil {
		ttl = *input.ttlSeconds
	}
	progressVersion := input.progressVersion
	if progressVersion == nil {
		progressVersion = testProgressVersion()
	}
	_, err := rdb.Eval(ctx, updateProgressScript, []string{key}, input.agentStatuses, input.toolEvents, input.budgetUsage, updatedAt, ttl, progressVersion).Result()
	return err
}

func setupMiniredisRegistry(t testing.TB) (*TaskRegistry, *redis.Client, func()) {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	client := redis.NewClient(rdb)
	redis.SetClient(client)
	cleanup := func() {
		_ = rdb.Close()
		mr.Close()
		redis.SetClient(redis.NewMockClient())
	}
	return &TaskRegistry{}, client, cleanup
}

type watchUnavailableClient struct{ *redis.MockClient }

func (c *watchUnavailableClient) Watch(context.Context, func(*goredis.Tx) error, ...string) error {
	return errors.New("redis watch operations require REDIS_URL")
}

type watchErrorClient struct {
	*redis.MockClient
	watchErr error
}

func (c *watchErrorClient) Watch(context.Context, func(*goredis.Tx) error, ...string) error {
	return c.watchErr
}

type fallbackSetNXClient struct {
	*redis.MockClient
	setNXResult bool
	setNXErr    error
}

func (c *fallbackSetNXClient) Watch(context.Context, func(*goredis.Tx) error, ...string) error {
	return errors.New("redis watch operations require REDIS_URL")
}

func (c *fallbackSetNXClient) SetNX(context.Context, string, []byte, time.Duration) (bool, error) {
	if c.setNXErr != nil {
		return false, c.setNXErr
	}
	return c.setNXResult, nil
}
