package run

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	miniredis "github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type noEvalCmdable struct {
	redis.Cmdable
}

func (c noEvalCmdable) SupportsEval() bool {
	return false
}

func (c noEvalCmdable) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	cmd.SetErr(errors.New("eval should not be called"))
	return cmd
}

type fallbackSaveFailClient struct {
	*redis.MockClient
	failSet bool
}

func (c *fallbackSaveFailClient) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	return errors.New("redis watch operations require REDIS_URL")
}

func (c *fallbackSaveFailClient) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if strings.HasPrefix(key, "task:start_lock:") {
		return true, nil
	}
	return c.MockClient.SetNX(ctx, key, value, ttl)
}

func (c *fallbackSaveFailClient) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if c.failSet && strings.HasPrefix(key, "task:") {
		return errors.New("save failed")
	}
	return c.MockClient.Set(ctx, key, value, ttl)
}

type startLockDelFailRedis struct {
	*redis.MockClient
}

func (c *startLockDelFailRedis) Watch(ctx context.Context, fn func(*goredis.Tx) error, keys ...string) error {
	return errors.New("redis watch operations require REDIS_URL")
}

func (c *startLockDelFailRedis) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if strings.HasPrefix(key, "task:start_lock:") {
		return true, nil
	}
	return c.MockClient.SetNX(ctx, key, value, ttl)
}

func (c *startLockDelFailRedis) Del(ctx context.Context, key string) (bool, error) {
	if strings.HasPrefix(key, "task:start_lock:") {
		return false, errors.New("del failed")
	}
	return c.MockClient.Del(ctx, key)
}

func TestTaskRegistry_MarkStartedNonProcessingStatus(t *testing.T) {
	registry, _, cleanup := setupMiniredisRegistry(t)
	defer cleanup()

	taskID := "mark-non-processing"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Update(context.Background(), taskID, StatusCompleted, "done", ""))

	started, err := registry.MarkStartedWithError(taskID)
	require.NoError(t, err)
	assert.False(t, started)
}

func TestTaskRegistry_MarkStartedNotProcessingReturnsFalse(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "not-processing-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Update(context.Background(), taskID, StatusCompleted, "done", ""))

	started, err := registry.MarkStartedWithError(taskID)
	require.NoError(t, err)
	require.False(t, started)
}

func TestTaskRegistry_MarkStartedSetNXLockNotAcquired(t *testing.T) {
	redis.SetClient(&startLockBusyRedis{MockClient: redis.NewMockClient()})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "start-lock-busy"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	started, err := registry.MarkStartedWithError(taskID)
	require.NoError(t, err)
	require.False(t, started)
}

func TestTaskRegistry_MarkStartedSetNXLockSaveFailure(t *testing.T) {
	mockClient := &fallbackSaveFailClient{MockClient: redis.NewMockClient()}
	redis.SetClient(mockClient)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "start-lock-save-fails"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	mockClient.failSet = true
	started, err := registry.MarkStartedWithError(taskID)
	require.ErrorContains(t, err, "save failed")
	require.False(t, started)
}

func TestTaskRegistry_MarkStartedSetNXLockReleaseFailureStillStarts(t *testing.T) {
	mockClient := &startLockDelFailRedis{MockClient: redis.NewMockClient()}
	redis.SetClient(mockClient)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "start-lock-release-fails"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	started, err := registry.MarkStartedWithError(taskID)
	require.NoError(t, err)
	require.True(t, started)
}

func TestTaskRegistry_MarkStartedUsesSetNXWhenWatchUnavailable(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "watch-unavailable-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	started, err := registry.MarkStartedWithError(taskID)
	require.NoError(t, err)
	require.True(t, started)

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.True(t, state.Started)
}

func TestTaskRegistry_MarkStartedWithCorruptStateReturnsFalse(t *testing.T) {
	mock := redis.NewMockClient()
	redis.SetClient(mock)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	ctx := context.Background()
	require.NoError(t, mock.Set(ctx, "task:corrupt-mark", []byte("{"), time.Minute))
	registry := requireTaskRegistry(t)
	started, err := registry.MarkStartedWithError("corrupt-mark")
	require.NoError(t, err)
	require.False(t, started)
}

func TestTaskRegistry_MarkStartedWithScriptBranches(t *testing.T) {
	registry := requireTaskRegistry(t)
	ctx := context.Background()
	key := taskStateKey("script-branch-task")

	started, err := registry.markStartedWithScript(ctx, &evalResultRedis{MockClient: redis.NewMockClient(), result: int64(1)}, key)
	require.NoError(t, err)
	require.True(t, started)

	started, err = registry.markStartedWithScript(ctx, &evalResultRedis{MockClient: redis.NewMockClient(), err: errors.New("task already started")}, key)
	require.NoError(t, err)
	require.False(t, started)

	started, err = registry.markStartedWithScript(ctx, &evalResultRedis{MockClient: redis.NewMockClient(), err: errors.New("invalid args")}, key)
	require.ErrorContains(t, err, "mark_started validation failed")
	require.False(t, started)

	started, err = registry.markStartedWithScript(ctx, &evalResultRedis{MockClient: redis.NewMockClient(), err: errors.New("fatal eval")}, key)
	require.EqualError(t, err, "fatal eval")
	require.False(t, started)
}

func TestTaskRegistry_MarkStartedWithEvalFallbackAndHardError(t *testing.T) {
	registry := requireTaskRegistry(t)

	redis.SetClient(&evalResultRedis{
		MockClient: redis.NewMockClient(),
		err:        errors.New("mock does not support eval"),
	})
	taskID := "eval-fallback-start"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	started, err := registry.MarkStartedWithError(taskID)
	require.NoError(t, err)
	require.True(t, started)

	redis.SetClient(&evalResultRedis{
		MockClient: redis.NewMockClient(),
		err:        errors.New("fatal eval"),
	})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	started, err = registry.MarkStartedWithError("eval-hard-error")
	require.EqualError(t, err, "fatal eval")
	require.False(t, started)
}

func TestTaskRegistry_MarkStartedWithNoEvalWatchBranches(t *testing.T) {
	registry, client, cleanup := setupMiniredisRegistry(t)
	defer cleanup()
	redis.SetClient(noEvalCmdable{Cmdable: client})

	successID := "no-eval-watch-success"
	require.NoError(t, registry.Register(successID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	started, err := registry.MarkStartedWithError(successID)
	require.NoError(t, err)
	require.True(t, started)

	completedID := "no-eval-watch-completed"
	require.NoError(t, registry.Register(completedID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Update(context.Background(), completedID, StatusCompleted, "done", ""))
	started, err = registry.MarkStartedWithError(completedID)
	require.NoError(t, err)
	require.False(t, started)

	recentID := "no-eval-watch-recent"
	require.NoError(t, registry.Register(recentID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	started, err = registry.MarkStartedWithError(recentID)
	require.NoError(t, err)
	require.True(t, started)
	started, err = registry.MarkStartedWithError(recentID)
	require.NoError(t, err)
	require.False(t, started)

	invalidID := "no-eval-watch-invalid"
	require.NoError(t, client.Set(context.Background(), taskStateKey(invalidID), []byte("{invalid"), TaskTTL))
	started, err = registry.MarkStartedWithError(invalidID)
	require.Error(t, err)
	require.False(t, started)
}

func TestTaskRegistry_MarkStartedWithWatchMissingTaskErrors(t *testing.T) {
	registry, client, cleanup := setupMiniredisRegistry(t)
	defer cleanup()

	started, err := registry.markStartedWithWatch(context.Background(), client, "missing-watch-task", taskStateKey("missing-watch-task"))
	require.Error(t, err)
	require.False(t, started)
}

func TestTaskRegistryWatchUpdateRedisClientErrors(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "")
	redis.ResetClient()
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)

	err := registry.watchUpdate(context.Background(), "watch-client-error", func(task *TaskState) error {
		return nil
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redis unavailable")

	redis.SetClient(nil)
	err = registry.watchUpdate(context.Background(), "watch-client-nil", func(task *TaskState) error {
		return nil
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "client is nil")
}

func TestTaskRegistry_MarkStartedWatchRetryableError(t *testing.T) {
	mockClient := &watchErrorClient{
		MockClient: redis.NewMockClient(),
		watchErr:   errors.New("connection reset by peer"),
	}
	redis.SetClient(mockClient)
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	started, err := registry.MarkStartedWithError("watch-retryable-error-start")
	require.EqualError(t, err, "connection reset by peer")
	require.False(t, started)
}

func TestTaskRegistry_MarkStarted_AlreadyCompleted(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("completed-start", 1, "prompt", "model", OrchestrateTaskOptions{})
	_ = registry.Update(context.Background(), "completed-start", StatusCompleted, "result", "")

	started := registry.MarkStarted("completed-start")
	if started {
		t.Error("Expected MarkStarted to fail for completed task")
	}
}

func TestTaskRegistry_MarkStarted_FallbackAllowsStaleRetake(t *testing.T) {
	mockClient := &fallbackSetNXClient{
		MockClient:  redis.NewMockClient(),
		setNXResult: true,
	}
	redis.SetClient(mockClient)
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	taskID := "fallback-stale-retake"
	_ = registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{})

	task := registry.Get(taskID)
	if task == nil {
		t.Fatal("expected task state")
	}
	task.Started = true
	task.UpdatedAt = time.Now().Add(-31 * time.Second).Unix()
	_ = registry.save(task)

	started := registry.MarkStarted(taskID)
	if !started {
		t.Fatal("Expected MarkStarted to succeed for stale task in fallback path")
	}
}

func TestTaskRegistry_MarkStarted_FallbackLockAlreadyHeld(t *testing.T) {
	mockClient := &fallbackSetNXClient{
		MockClient:  redis.NewMockClient(),
		setNXResult: false,
	}
	redis.SetClient(mockClient)
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	_ = registry.Register("fallback-lock-held", 1, "prompt", "model", OrchestrateTaskOptions{})

	started := registry.MarkStarted("fallback-lock-held")
	if started {
		t.Fatal("Expected MarkStarted to fail when fallback lock cannot be acquired")
	}
}

func TestTaskRegistry_MarkStarted_FallbackSetNXError(t *testing.T) {
	mockClient := &fallbackSetNXClient{
		MockClient: redis.NewMockClient(),
		setNXErr:   errors.New("setnx failed"),
	}
	redis.SetClient(mockClient)
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	_ = registry.Register("fallback-setnx-error", 1, "prompt", "model", OrchestrateTaskOptions{})

	started := registry.MarkStarted("fallback-setnx-error")
	if started {
		t.Fatal("Expected MarkStarted to fail when fallback SetNX errors")
	}
}

func TestTaskRegistry_MarkStarted_NoRedisConfigured(t *testing.T) {
	redis.ResetClient()
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "")
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	started := registry.MarkStarted("any-task")
	if started {
		t.Fatal("Expected MarkStarted to fail when redis client is unavailable")
	}
}

func TestTaskRegistry_MarkStarted_NonExistent(t *testing.T) {
	registry := requireTaskRegistry(t)

	started := registry.MarkStarted("nonexistent-start")
	if started {
		t.Error("Expected MarkStarted to fail for nonexistent task")
	}
}

func TestTaskRegistry_MarkStarted_RecentlyStarted(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("recent-start", 1, "prompt", "model", OrchestrateTaskOptions{})

	// Mark started first time
	started := registry.MarkStarted("recent-start")
	if !started {
		t.Fatal("Expected first MarkStarted to succeed")
	}

	// Try to mark started again immediately (should fail, not stale)
	started = registry.MarkStarted("recent-start")
	if started {
		t.Error("Expected second MarkStarted to fail (task not stale)")
	}
}

func TestTaskRegistry_MarkStarted_WatchConflict(t *testing.T) {
	mockClient := &watchErrorClient{
		MockClient: redis.NewMockClient(),
		watchErr:   goredis.TxFailedErr,
	}
	redis.SetClient(mockClient)
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	_ = registry.Register("watch-conflict-start", 1, "prompt", "model", OrchestrateTaskOptions{})

	started := registry.MarkStarted("watch-conflict-start")
	if started {
		t.Fatal("Expected MarkStarted to fail when watch reports transaction conflict")
	}
}

func TestTaskRegistry_MarkStarted_WatchPathAllowsStaleRetake(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	defer mr.Close()

	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer func() { _ = rdb.Close() }()

	client := redis.NewClient(rdb)
	redis.SetClient(client)
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	taskID := "watch-stale-retake-task"
	_ = registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{})

	task := registry.Get(taskID)
	if task == nil {
		t.Fatalf("expected task state")
	}
	task.Started = true
	task.UpdatedAt = time.Now().Add(-31 * time.Second).Unix()
	data, marshalErr := json.Marshal(task)
	if marshalErr != nil {
		t.Fatalf("failed to marshal stale task: %v", marshalErr)
	}
	if err := client.Set(context.Background(), "task:"+taskID, data, TaskTTL); err != nil {
		t.Fatalf("failed to seed stale task: %v", err)
	}

	if !registry.MarkStarted(taskID) {
		t.Fatalf("expected MarkStarted to succeed for stale started task")
	}
}

func TestTaskRegistry_MarkStarted_WatchPathRejectsNonProcessingAndInvalidState(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	defer mr.Close()

	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer func() { _ = rdb.Close() }()

	client := redis.NewClient(rdb)
	redis.SetClient(client)
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	taskIDCompleted := "watch-completed-task"
	_ = registry.Register(taskIDCompleted, 1, "prompt", "model", OrchestrateTaskOptions{})
	_ = registry.Update(context.Background(), taskIDCompleted, StatusCompleted, "done", "")

	if registry.MarkStarted(taskIDCompleted) {
		t.Fatalf("expected MarkStarted to fail when task is not processing")
	}

	taskIDInvalid := "watch-invalid-json-task"
	if err := client.Set(context.Background(), "task:"+taskIDInvalid, []byte("{invalid"), TaskTTL); err != nil {
		t.Fatalf("failed to seed invalid state: %v", err)
	}
	if registry.MarkStarted(taskIDInvalid) {
		t.Fatalf("expected MarkStarted to fail when task state is invalid JSON")
	}
}

func TestTaskRegistry_MarkStarted_WatchPathSuccessAndRecentBlock(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	defer mr.Close()

	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer func() { _ = rdb.Close() }()

	client := redis.NewClient(rdb)
	redis.SetClient(client)
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	taskID := "watch-success-task"
	_ = registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{})

	if !registry.MarkStarted(taskID) {
		t.Fatalf("expected first MarkStarted to succeed through watch path")
	}

	task := registry.Get(taskID)
	if task == nil || !task.Started {
		t.Fatalf("expected task to be marked started")
	}

	if registry.MarkStarted(taskID) {
		t.Fatalf("expected second MarkStarted to fail for recently started task")
	}
}

func TestTaskRegistry_MarkStarted_WatchUnavailableFallback(t *testing.T) {
	mockClient := &watchUnavailableClient{MockClient: redis.NewMockClient()}
	redis.SetClient(mockClient)
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	_ = registry.Register("watch-unavailable-start", 1, "prompt", "model", OrchestrateTaskOptions{})

	started := registry.MarkStarted("watch-unavailable-start")
	if !started {
		t.Fatal("Expected MarkStarted to succeed via fallback lock when WATCH is unavailable")
	}

	state := registry.Get("watch-unavailable-start")
	if state == nil {
		t.Fatal("Expected state after fallback MarkStarted")
	}
	if !state.Started {
		t.Error("Expected Started to be true after fallback lock path")
	}
}

func TestTaskRegistry_MarkStarted_WatchUnexpectedError(t *testing.T) {
	mockClient := &watchErrorClient{
		MockClient: redis.NewMockClient(),
		watchErr:   errors.New("watch failed"),
	}
	redis.SetClient(mockClient)
	t.Cleanup(func() {
		redis.SetClient(redis.NewMockClient())
	})
	registry := requireTaskRegistry(t)
	_ = registry.Register("watch-error-start", 1, "prompt", "model", OrchestrateTaskOptions{})

	started := registry.MarkStarted("watch-error-start")
	if started {
		t.Fatal("Expected MarkStarted to fail when watch returns unexpected error")
	}
}

func BenchmarkTaskRegistryMarkStartedMiniredis(b *testing.B) {
	mr, err := miniredis.Run()
	require.NoError(b, err)
	defer mr.Close()

	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer func() { require.NoError(b, rdb.Close()) }()

	client := redis.NewClient(rdb)
	redis.SetClient(client)
	b.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	registry := requireTaskRegistry(b)
	taskID := "bench-mark-started"
	task := TaskState{
		TaskID:    taskID,
		Status:    StatusProcessing,
		UserID:    1,
		UpdatedAt: time.Now().Unix(),
	}
	data, err := json.Marshal(task)
	require.NoError(b, err)

	ctx := context.Background()
	key := taskStateKey(taskID)

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		require.NoError(b, rdb.Set(ctx, key, data, TaskTTL).Err())
		started, err := registry.MarkStartedWithError(taskID)
		if err != nil {
			b.Fatal(err)
		}
		if !started {
			b.Fatal("expected task to be marked started")
		}
	}
}

func TestTaskRegistry_MultipleTasks(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("task-1", 1, "p1", "m1", OrchestrateTaskOptions{})
	_ = registry.Register("task-2", 2, "p2", "m2", OrchestrateTaskOptions{})
	_ = registry.Register("task-3", 1, "p3", "m3", OrchestrateTaskOptions{})

	state1 := registry.Get("task-1")
	state2 := registry.Get("task-2")
	state3 := registry.Get("task-3")

	if state1 == nil || state1.UserID != 1 {
		t.Error("task-1 not found or wrong user")
	}
	if state2 == nil || state2.UserID != 2 {
		t.Error("task-2 not found or wrong user")
	}
	if state3 == nil || state3.UserID != 1 {
		t.Error("task-3 not found or wrong user")
	}
}

func TestTaskRegistry_OverwriteTask(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("task-1", 1, "p1", "m1", OrchestrateTaskOptions{})
	_ = registry.Update(context.Background(), "task-1", StatusCompleted, "first result", "")

	// Re-register same task (overwrites)
	_ = registry.Register("task-1", 2, "p2", "m2", OrchestrateTaskOptions{})

	state := registry.Get("task-1")
	if state == nil {
		t.Fatal("Expected state after re-register")
		return
	}

	if state.UserID != 2 {
		t.Errorf("Expected new UserID 2, got %d", state.UserID)
	}
	if state.Status != StatusProcessing {
		t.Errorf("Expected status reset to 'processing', got %s", state.Status)
	}
	if state.Result != "" {
		t.Errorf("Expected empty result after re-register, got %s", state.Result)
	}
}

func TestTaskRegistry_Register(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("task-1", 1, "test prompt", "test model", OrchestrateTaskOptions{})

	state := registry.Get("task-1")
	if state == nil {
		t.Fatal("Expected state after register")
		return
	}

	if state.TaskID != "task-1" {
		t.Errorf("Expected TaskID 'task-1', got %s", state.TaskID)
	}
	if state.UserID != 1 {
		t.Errorf("Expected UserID 1, got %d", state.UserID)
	}
	if state.Status != StatusProcessing {
		t.Errorf("Expected status 'processing', got %s", state.Status)
	}
	if state.Prompt != "test prompt" {
		t.Errorf("Expected prompt 'test prompt', got %s", state.Prompt)
	}
}

func TestTaskRegistry_SaveInvalidTaskStateStillFails(t *testing.T) {
	registry := requireTaskRegistry(t)
	err := registry.save(&TaskState{AgentStatuses: make(chan int)})
	require.Error(t, err)
}

func TestTaskRegistry_SaveMarshalsTaskState(t *testing.T) {
	registry := requireTaskRegistry(t)
	task := &TaskState{
		TaskID:    "marshal-task",
		Status:    StatusProcessing,
		UserID:    1,
		UpdatedAt: time.Now().Unix(),
	}
	require.NoError(t, registry.save(task))

	client, err := redis.GetClient()
	require.NoError(t, err)
	raw, getErr := client.Get(context.Background(), "task:marshal-task")
	require.NoError(t, getErr)

	var decoded TaskState
	require.NoError(t, json.Unmarshal([]byte(raw), &decoded))
	assert.Equal(t, "marshal-task", decoded.TaskID)
}

func TestTaskRegistry_SaveNilRedisClient(t *testing.T) {
	registry := requireTaskRegistry(t)

	original := taskRegistryRedisClientGetter
	taskRegistryRedisClientGetter = func() (redis.Cmdable, error) {
		return nil, nil
	}
	t.Cleanup(func() {
		taskRegistryRedisClientGetter = original
	})

	err := registry.save(&TaskState{TaskID: "save-nil-client", Status: StatusProcessing, UserID: 1})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redis client is nil")
}

func TestGetRedisClientWithRetryNilClientAfterSuccess(t *testing.T) {
	original := registryRedisClientGetterWithRetry
	registryRedisClientGetterWithRetry = func() (redis.Cmdable, error) {
		return nil, nil
	}
	t.Cleanup(func() { registryRedisClientGetterWithRetry = original })

	client, err := getRedisClientWithRetry(context.Background())
	require.Error(t, err)
	assert.Nil(t, client)
	assert.Contains(t, err.Error(), "redis client is nil")
}

func TestGetRedisClientWithRetryRetriesTransientGetterError(t *testing.T) {
	original := registryRedisClientGetterWithRetry
	attempts := 0
	mockRedis := redis.NewMockClient()
	registryRedisClientGetterWithRetry = func() (redis.Cmdable, error) {
		attempts++
		if attempts == 1 {
			return nil, errors.New("connection reset by peer")
		}
		return mockRedis, nil
	}
	t.Cleanup(func() { registryRedisClientGetterWithRetry = original })

	client, err := getRedisClientWithRetry(context.Background())
	require.NoError(t, err)
	assert.Same(t, mockRedis, client)
	assert.Equal(t, 2, attempts)
}

func TestTaskRegistry_GetNilRedisClient(t *testing.T) {
	registry := requireTaskRegistry(t)

	original := taskRegistryRedisClientGetter
	taskRegistryRedisClientGetter = func() (redis.Cmdable, error) {
		return nil, nil
	}
	t.Cleanup(func() {
		taskRegistryRedisClientGetter = original
	})

	assert.Nil(t, registry.Get("get-nil-client"))
}

func TestTaskRegistry_SaveWithContextReturnsWrappedError(t *testing.T) {
	redis.SetClient(&failingTaskSaveRedis{MockClient: redis.NewMockClient()})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)

	err := registry.Register("save-error-task", 1, "prompt", "model", OrchestrateTaskOptions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "register task save-error-task")
}

func TestTaskRegistry_Save_NoRedisClient(t *testing.T) {
	// Test the save function when redis client is nil
	// We need to temporarily set redis to return nil
	redis.ResetClient()
	defer redis.SetClient(redis.NewMockClient())

	registry := &TaskRegistry{}
	task := &TaskState{
		TaskID: "save-test",
		Status: StatusProcessing,
	}

	// Should not panic even with nil redis (will log error)
	_ = registry.save(task)
}
