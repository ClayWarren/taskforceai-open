package run

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	coreconfig "github.com/TaskForceAI/core/pkg/config"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegistryErrorClassifiers(t *testing.T) {
	if isStreamUnavailableError(nil) {
		t.Fatal("nil stream error should not be unavailable")
	}
	if !isStreamUnavailableError(errors.New("stream operations require REDIS_URL")) {
		t.Fatal("expected stream unavailable marker to be recognized")
	}
	if isStreamUnavailableError(errors.New("connection refused")) {
		t.Fatal("generic connection errors are not stream-unavailable markers")
	}

	if isRetryableRegistryError(nil) {
		t.Fatal("nil registry error should not be retryable")
	}
	if !isRetryableRegistryError(errors.New("connection reset by peer")) {
		t.Fatal("expected connection reset to be retryable")
	}
	if isRetryableRegistryError(errors.New("validation failed")) {
		t.Fatal("validation error should not be retryable")
	}
}

func TestRegistryValidationHelpers(t *testing.T) {
	assert.True(t, isExpectedUpdateProgressNoopError("task not found"))
	assert.True(t, isUpdateProgressValidationError("invalid agentStatuses json"))
	assert.True(t, isUpdateProgressValidationError("invalid ttl"))
	assert.True(t, isExpectedMarkStartedNoopError("task already started"))
	assert.False(t, isExpectedMarkStartedNoopError("other"))
	assert.True(t, isMarkStartedValidationError("invalid updatedAt"))
	assert.False(t, isMarkStartedValidationError("other"))
	assert.False(t, isEvalUnavailableError(nil))
	assert.True(t, isEvalUnavailableError(errors.New("mock does not support eval")))
	assert.True(t, isWatchUnavailableError(errors.New("watch operations require REDIS_URL")))
	assert.False(t, isWatchUnavailableError(nil))
	assert.True(t, isRetryableRegistryError(goredis.TxFailedErr))
	assert.True(t, isRetryableRegistryError(errors.New("i/o timeout")))
	assert.True(t, isRetryableRegistryError(errors.New("temporarily unavailable")))
	assert.True(t, isWatchUnavailableError(errors.New("mock does not support watch")))
	assert.True(t, isStreamUnavailableError(errors.New("stream operations require REDIS_URL")))
}

func TestTaskStateProgressVersionParsingBranches(t *testing.T) {
	var state TaskState
	require.Error(t, json.Unmarshal([]byte(`{"options":"bad"}`), &state))
	require.NoError(t, json.Unmarshal([]byte(`{"taskId":"a","progressVersion":null}`), &state))
	assert.Zero(t, state.ProgressVersion)

	require.NoError(t, json.Unmarshal([]byte(`{"taskId":"a","progressVersion":" 42 "}`), &state))
	assert.Equal(t, int64(42), state.ProgressVersion)

	require.NoError(t, json.Unmarshal([]byte(`{"taskId":"a","progressVersion":"\"43\""}`), &state))
	assert.Equal(t, int64(43), state.ProgressVersion)

	require.Error(t, json.Unmarshal([]byte(`{"taskId":"a","progressVersion":""}`), &state))
	require.Error(t, json.Unmarshal([]byte(`{"taskId":"a","progressVersion":"1.2"}`), &state))
	require.Error(t, json.Unmarshal([]byte(`{"taskId":"a","progressVersion":"9223372036854775808"}`), &state))
	require.Error(t, json.Unmarshal([]byte(`{"taskId":"a","progressVersion":{}}`), &state))
	_, err := parseJSONInt64([]byte("   "))
	require.Error(t, err)
	_, err = parseJSONInt64([]byte(`"\x"`))
	require.Error(t, err)

	value, ok, err := parsePlainJSONInt64Bytes(nil)
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Zero(t, value)

	value, ok, err = parsePlainJSONInt64Bytes([]byte("-9223372036854775808"))
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int64(-9223372036854775808), value)

	value, ok, err = parsePlainJSONInt64Bytes([]byte("-42"))
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, int64(-42), value)

	_, ok, err = parsePlainJSONInt64Bytes([]byte("+"))
	require.NoError(t, err)
	assert.False(t, ok)

	assert.False(t, isPlainJSONInteger(""))
	assert.False(t, isPlainJSONInteger("+"))
	assert.False(t, isPlainJSONInteger("12a"))
	assert.True(t, isPlainJSONInteger("-42"))
}

func TestResetDeps(t *testing.T) {
	// Modify a dep
	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{}, errors.New("modified")
	}

	// Reset
	ResetDeps()

	// The reset function should set them back to defaults
	// We can't easily verify they're back to originals without calling them,
	// but we can verify the function doesn't panic
}

func TestTaskRegistryListByUserTracksActiveTasks(t *testing.T) {
	mockRedis := redis.NewMockClient()
	redis.SetClient(mockRedis)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	registry := &TaskRegistry{}
	requireNoError := func(err error) {
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	}

	requireNoError(registry.Register("desktop-task", 7, "desktop prompt", "model", OrchestrateTaskOptions{Source: "desktop"}))
	requireNoError(registry.Register("other-task", 8, "other prompt", "model", OrchestrateTaskOptions{Source: "desktop"}))

	tasks, err := registry.ListByUser(context.Background(), 7, TaskListOptions{Limit: 10})
	requireNoError(err)
	if len(tasks) != 1 {
		t.Fatalf("expected one active task, got %d", len(tasks))
	}
	if tasks[0].TaskID != "desktop-task" || tasks[0].Options.Source != "desktop" {
		t.Fatalf("unexpected task summary: %+v", tasks[0])
	}

	requireNoError(registry.Update(context.Background(), "desktop-task", StatusCompleted, "done", ""))
	tasks, err = registry.ListByUser(context.Background(), 7, TaskListOptions{Limit: 10})
	requireNoError(err)
	if len(tasks) != 0 {
		t.Fatalf("expected terminal task to be removed from active list, got %d", len(tasks))
	}
}

func TestTaskRegistryListByUserPrunesExpiredActiveTasks(t *testing.T) {
	mockRedis := redis.NewMockClient()
	redis.SetClient(mockRedis)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	registry := &TaskRegistry{}
	require.NoError(t, registry.Register("live-task", 7, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Register("expired-task", 7, "prompt", "model", OrchestrateTaskOptions{}))
	deleted, err := mockRedis.Del(context.Background(), taskStateKey("expired-task"))
	require.NoError(t, err)
	require.True(t, deleted)

	tasks, err := registry.ListByUser(context.Background(), 7, TaskListOptions{Limit: 10})
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	assert.Equal(t, "live-task", tasks[0].TaskID)

	rawIndex, err := mockRedis.Get(context.Background(), activeTaskIndexKey(7))
	require.NoError(t, err)
	assert.Contains(t, rawIndex, "live-task")
	assert.NotContains(t, rawIndex, "expired-task")
}

func TestTaskRegistryListByUserPrunesMultipleExpiredActiveTasks(t *testing.T) {
	mockRedis := redis.NewMockClient()
	redis.SetClient(mockRedis)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	registry := &TaskRegistry{}
	require.NoError(t, registry.Register("live-task", 7, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Register("expired-task-1", 7, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Register("expired-task-2", 7, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Register("expired-task-3", 7, "prompt", "model", OrchestrateTaskOptions{}))

	for _, taskID := range []string{"expired-task-1", "expired-task-2", "expired-task-3"} {
		deleted, err := mockRedis.Del(context.Background(), taskStateKey(taskID))
		require.NoError(t, err)
		require.True(t, deleted)
	}

	tasks, err := registry.ListByUser(context.Background(), 7, TaskListOptions{Limit: 10})
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	assert.Equal(t, "live-task", tasks[0].TaskID)

	rawIndex, err := mockRedis.Get(context.Background(), activeTaskIndexKey(7))
	require.NoError(t, err)
	assert.Contains(t, rawIndex, "live-task")
	assert.NotContains(t, rawIndex, "expired-task-1")
	assert.NotContains(t, rawIndex, "expired-task-2")
	assert.NotContains(t, rawIndex, "expired-task-3")
}

func TestTaskRegistryActiveIndexCapsStoredTaskIDs(t *testing.T) {
	mockRedis := redis.NewMockClient()
	redis.SetClient(mockRedis)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	registry := &TaskRegistry{}
	totalTasks := activeTaskIndexMaxIDs + 5
	for i := 0; i < totalTasks; i++ {
		require.NoError(t, registry.Register(fmt.Sprintf("task-%d", i), 7, "prompt", "model", OrchestrateTaskOptions{}))
	}

	rawIndex, err := mockRedis.Get(context.Background(), activeTaskIndexKey(7))
	require.NoError(t, err)
	var taskIDs []string
	require.NoError(t, json.Unmarshal([]byte(rawIndex), &taskIDs))
	require.Len(t, taskIDs, activeTaskIndexMaxIDs)
	assert.Equal(t, "task-5", taskIDs[0])
	assert.Equal(t, "task-204", taskIDs[len(taskIDs)-1])
}

func TestActiveTaskIndexFallbackBranches(t *testing.T) {
	ctx := context.Background()
	mockRedis := redis.NewMockClient()
	redis.SetClient(noEvalRedis{MockClient: mockRedis})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	activeTaskIndexLocks.Store(99, "not-a-mutex")
	lock := activeTaskIndexLock(99)
	require.NotNil(t, lock)
	require.True(t, lock.TryLock())
	lock.Unlock()

	require.NoError(t, updateActiveTaskIndex(ctx, 0, "task", true))
	require.NoError(t, updateActiveTaskIndex(ctx, 7, "", true))

	require.NoError(t, updateActiveTaskIndex(ctx, 7, "task-a", true))
	require.NoError(t, updateActiveTaskIndex(ctx, 7, "task-a", true))
	rawIndex, err := mockRedis.Get(ctx, activeTaskIndexKey(7))
	require.NoError(t, err)
	assert.JSONEq(t, `["task-a"]`, rawIndex)

	require.NoError(t, updateActiveTaskIndex(ctx, 7, "task-a", false))
	rawIndex, err = mockRedis.Get(ctx, activeTaskIndexKey(7))
	require.NoError(t, err)
	assert.JSONEq(t, `[]`, rawIndex)

	require.NoError(t, mockRedis.Set(ctx, activeTaskIndexKey(7), []byte(`{`), TaskTTL))
	err = updateActiveTaskIndex(ctx, 7, "task-b", true)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "decode active task index")

	redis.SetClient(&taskGetErrorRedis{MockClient: redis.NewMockClient()})
	err = updateActiveTaskIndex(ctx, 7, "task-c", true)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "get active task index")

	redis.SetClient(&failingTaskSaveRedis{MockClient: redis.NewMockClient()})
	err = updateActiveTaskIndex(ctx, 7, "task-d", true)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "save active task index")
}

func TestActiveTaskIndexRedisUnavailableBranches(t *testing.T) {
	ctx := context.Background()
	redis.SetClient(nil)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	err := updateActiveTaskIndex(ctx, 7, "task-a", true)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redis unavailable")

	err = removeActiveTaskIDs(ctx, 7, []string{"task-a"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redis unavailable")

	registry := &TaskRegistry{}
	_, err = registry.ListByUser(ctx, 7, TaskListOptions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "redis unavailable")
}

func TestRemoveActiveTaskIDsBranches(t *testing.T) {
	ctx := context.Background()
	mockRedis := redis.NewMockClient()
	redis.SetClient(noEvalRedis{MockClient: mockRedis})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	require.NoError(t, removeActiveTaskIDs(ctx, 0, []string{"task-a"}))
	require.NoError(t, removeActiveTaskIDs(ctx, 7, nil))
	require.NoError(t, removeActiveTaskIDs(ctx, 7, []string{""}))
	require.NoError(t, removeActiveTaskIDs(ctx, 7, []string{"missing"}))

	require.NoError(t, mockRedis.Set(ctx, activeTaskIndexKey(7), []byte(`{`), TaskTTL))
	err := removeActiveTaskIDs(ctx, 7, []string{"task-a"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "decode active task index")

	require.NoError(t, mockRedis.Set(ctx, activeTaskIndexKey(7), []byte(`["task-a","task-b"]`), TaskTTL))
	require.NoError(t, removeActiveTaskIDs(ctx, 7, []string{"task-a"}))
	rawIndex, err := mockRedis.Get(ctx, activeTaskIndexKey(7))
	require.NoError(t, err)
	assert.JSONEq(t, `["task-b"]`, rawIndex)

	require.NoError(t, mockRedis.Set(ctx, activeTaskIndexKey(7), []byte(`["task-b"]`), TaskTTL))
	require.NoError(t, removeActiveTaskIDs(ctx, 7, []string{"task-a"}))

	redis.SetClient(&taskGetErrorRedis{MockClient: redis.NewMockClient()})
	err = removeActiveTaskIDs(ctx, 7, []string{"task-a"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "get active task index")

	failingBase := redis.NewMockClient()
	require.NoError(t, failingBase.Set(ctx, activeTaskIndexKey(7), []byte(`["task-a"]`), TaskTTL))
	redis.SetClient(&failingTaskSaveRedis{MockClient: failingBase})
	err = removeActiveTaskIDs(ctx, 7, []string{"task-a"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "save active task index")
}

type taskStateLookupErrorRedis struct {
	*redis.MockClient
	taskID string
}

func (c *taskStateLookupErrorRedis) Get(ctx context.Context, key string) (string, error) {
	if key == taskStateKey(c.taskID) {
		return "", errors.New("task state get failed")
	}
	return c.MockClient.Get(ctx, key)
}

func TestTaskRegistryListByUserErrorBranches(t *testing.T) {
	ctx := context.Background()
	registry := &TaskRegistry{}
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	redis.SetClient(&taskGetErrorRedis{MockClient: redis.NewMockClient()})
	_, err := registry.ListByUser(ctx, 7, TaskListOptions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "get active task index")

	mockRedis := redis.NewMockClient()
	redis.SetClient(mockRedis)
	tasks, err := registry.ListByUser(ctx, 7, TaskListOptions{})
	require.NoError(t, err)
	assert.Empty(t, tasks)

	mockRedis = redis.NewMockClient()
	redis.SetClient(mockRedis)
	require.NoError(t, mockRedis.Set(ctx, activeTaskIndexKey(7), []byte(`{`), TaskTTL))
	_, err = registry.ListByUser(ctx, 7, TaskListOptions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "decode active task index")

	taskStateErrorBase := redis.NewMockClient()
	require.NoError(t, taskStateErrorBase.Set(ctx, activeTaskIndexKey(7), []byte(`["bad-get-task"]`), TaskTTL))
	redis.SetClient(&taskStateLookupErrorRedis{MockClient: taskStateErrorBase, taskID: "bad-get-task"})
	_, err = registry.ListByUser(ctx, 7, TaskListOptions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "get task state")

	redis.SetClient(mockRedis)
	require.NoError(t, mockRedis.Set(ctx, activeTaskIndexKey(7), []byte(`["bad-json-task","other-user-task","done-task","live-task"]`), TaskTTL))
	require.NoError(t, mockRedis.Set(ctx, taskStateKey("bad-json-task"), []byte(`{`), TaskTTL))
	otherUser, err := json.Marshal(TaskState{TaskID: "other-user-task", UserID: 8, Status: StatusProcessing})
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(ctx, taskStateKey("other-user-task"), otherUser, TaskTTL))
	done, err := json.Marshal(TaskState{TaskID: "done-task", UserID: 7, Status: StatusCompleted})
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(ctx, taskStateKey("done-task"), done, TaskTTL))
	live, err := json.Marshal(TaskState{TaskID: "live-task", UserID: 7, Status: StatusProcessing})
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(ctx, taskStateKey("live-task"), live, TaskTTL))

	tasks, err = registry.ListByUser(ctx, 7, TaskListOptions{Limit: 1000})
	require.NoError(t, err)
	require.Len(t, tasks, 1)
	assert.Equal(t, "live-task", tasks[0].TaskID)

	redis.SetClient(&failingTaskSaveRedis{MockClient: mockRedis})
	_, err = registry.ListByUser(ctx, 7, TaskListOptions{Limit: 1})
	require.NoError(t, err)

	pruneFailBase := redis.NewMockClient()
	require.NoError(t, pruneFailBase.Set(ctx, activeTaskIndexKey(7), []byte(`["missing-task"]`), TaskTTL))
	redis.SetClient(&failingTaskSaveRedis{MockClient: pruneFailBase})
	tasks, err = registry.ListByUser(ctx, 7, TaskListOptions{})
	require.NoError(t, err)
	assert.Empty(t, tasks)
}

func BenchmarkActiveTaskIndexKeyFormatting(b *testing.B) {
	b.Run("fmt", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_ = fmt.Sprintf("task:user:%d:active", i)
		}
	})
	b.Run("itoa", func(b *testing.B) {
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			_ = activeTaskIndexKey(i)
		}
	})
}

func BenchmarkRemoveActiveTaskIDsBatch(b *testing.B) {
	ctx := context.Background()
	taskIDs := make([]string, 0, 128)
	for i := range 128 {
		taskIDs = append(taskIDs, fmt.Sprintf("task-%d", i))
	}
	removeIDs := taskIDs[:64]

	b.ReportAllocs()
	for b.Loop() {
		mockRedis := redis.NewMockClient()
		redis.SetClient(mockRedis)
		data, err := json.Marshal(taskIDs)
		require.NoError(b, err)
		require.NoError(b, mockRedis.Set(ctx, activeTaskIndexKey(7), data, TaskTTL))
		if err := removeActiveTaskIDs(ctx, 7, removeIDs); err != nil {
			b.Fatal(err)
		}
	}
}

func TestTaskRegistry_ClearApprovalNotFound(t *testing.T) {
	registry := requireTaskRegistry(t)
	err := registry.ClearApproval(context.Background(), "missing-clear-task")
	require.Error(t, err)
}

func TestTaskRegistry_ClearApprovalSuccess(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "clear-approval-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.UpdateWithApproval(context.Background(), taskID, &PendingApproval{Permission: "write"}))
	awaitingState := registry.Get(taskID)
	require.NotNil(t, awaitingState)
	awaitingVersion := awaitingState.ProgressVersion
	require.Positive(t, awaitingVersion)

	require.NoError(t, registry.ClearApproval(context.Background(), taskID))
	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusProcessing, state.Status)
	assert.Nil(t, state.PendingApproval)
	assert.Positive(t, state.ProgressVersion)
	assert.NotEqual(t, awaitingVersion, state.ProgressVersion)
}

func TestTaskRegistry_ConcurrentAccess(t *testing.T) {
	registry := requireTaskRegistry(t)

	var wg sync.WaitGroup

	// Concurrent registers
	for i := range 100 {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			taskID := string(rune('a' + id%26))
			_ = registry.Register(taskID, 123, "p", "m", OrchestrateTaskOptions{})
		}(i)
	}

	// Concurrent updates
	for i := range 100 {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			taskID := string(rune('a' + id%26))
			_ = registry.Update(context.Background(), taskID, StatusCompleted, "result", "")
		}(i)
	}

	// Concurrent reads
	for i := range 100 {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			taskID := string(rune('a' + id%26))
			_ = registry.Get(taskID)
		}(i)
	}

	wg.Wait()
	// Test passes if no race condition or panic
}

func TestTaskRegistry_GetNonExistent(t *testing.T) {
	registry := requireTaskRegistry(t)

	state := registry.Get("nonexistent")
	if state != nil {
		t.Error("Expected nil for nonexistent task")
	}
}

func TestTaskRegistry_GetRedisClientError(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	t.Setenv("REDIS_KV_URL", "")
	redis.ResetClient()
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	assert.Nil(t, registry.Get("missing-redis-client"))
}

func TestTaskRegistry_GetReturnsNilForCorruptJSON(t *testing.T) {
	mock := redis.NewMockClient()
	redis.SetClient(mock)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	ctx := context.Background()
	require.NoError(t, mock.Set(ctx, "task:corrupt-json", []byte("{"), time.Minute))
	registry := requireTaskRegistry(t)
	assert.Nil(t, registry.Get("corrupt-json"))
}

func TestTaskRegistry_GetReturnsNilForMissingTask(t *testing.T) {
	registry := requireTaskRegistry(t)
	assert.Nil(t, registry.Get("definitely-missing-task-id"))
}

func TestTaskRegistry_GetReturnsNilOnRedisGetError(t *testing.T) {
	redis.SetClient(&taskGetErrorRedis{MockClient: redis.NewMockClient()})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	assert.Nil(t, registry.Get("missing-on-error"))
}

func TestTaskRegistry_GetReturnsNilWhenRedisUnavailable(t *testing.T) {
	redis.SetClient(nil)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	assert.Nil(t, registry.Get("missing-redis-task"))
}

func TestTaskRegistry_GetUnmarshalFailure(t *testing.T) {
	registry, client, cleanup := setupMiniredisRegistry(t)
	defer cleanup()

	taskID := "get-bad-json"
	require.NoError(t, client.Set(context.Background(), "task:"+taskID, []byte("not-json"), TaskTTL))
	assert.Nil(t, registry.Get(taskID))
}

func TestTaskRegistry_Get_ParseError(t *testing.T) {
	// Set up mock redis with invalid JSON
	mockClient := redis.NewMockClient()
	redis.SetClient(mockClient)
	defer redis.SetClient(redis.NewMockClient())

	// Store invalid JSON
	ctx := context.Background()
	err := mockClient.Set(ctx, "task:invalid-json", []byte("not valid json"), time.Hour)
	if err != nil {
		t.Fatalf("Failed to set mock data: %v", err)
	}
	registry := requireTaskRegistry(t)
	state := registry.Get("invalid-json")

	// Should return nil for invalid JSON
	if state != nil {
		t.Error("Expected nil for invalid JSON")
	}
}

func TestTaskRegistry_Heartbeat(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("heartbeat-task", 1, "prompt", "model", OrchestrateTaskOptions{})

	initialState := registry.Get("heartbeat-task")
	if initialState == nil {
		t.Fatal("Expected state after register")
		return
	}
	initialUpdatedAt := initialState.UpdatedAt

	// Small delay to ensure time moves
	_ = registry.Heartbeat(context.Background(), "heartbeat-task")

	state := registry.Get("heartbeat-task")
	if state == nil {
		t.Fatal("Expected state after heartbeat")
		return
	}

	// UpdatedAt should be >= initial (might be same if too fast)
	if state.UpdatedAt < initialUpdatedAt {
		t.Error("Expected UpdatedAt to increase or stay same")
	}
}

func TestTaskRegistry_HeartbeatAndTerminalUpdateNoops(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "heartbeat-noop-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Update(context.Background(), taskID, StatusCompleted, "done", ""))

	require.NoError(t, registry.Heartbeat(context.Background(), taskID))

	err := registry.Update(context.Background(), taskID, StatusProcessing, "retry", "")
	require.NoError(t, err)
	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCompleted, state.Status)
}

func TestTaskRegistry_HeartbeatPersists(t *testing.T) {
	registry, _, cleanup := setupMiniredisRegistry(t)
	defer cleanup()

	taskID := "heartbeat-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Heartbeat(context.Background(), taskID))

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Positive(t, state.UpdatedAt)
}

func TestTaskRegistry_Heartbeat_Completed(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("completed-heartbeat", 1, "prompt", "model", OrchestrateTaskOptions{})
	_ = registry.Update(context.Background(), "completed-heartbeat", StatusCompleted, "result", "")

	// Heartbeat on completed task should not update it
	_ = registry.Heartbeat(context.Background(), "completed-heartbeat")

	state := registry.Get("completed-heartbeat")
	if state == nil {
		t.Fatal("Expected state")
		return
	}
	if state.Status != StatusCompleted {
		t.Error("Expected status to remain completed")
	}
}

func TestTaskRegistry_Heartbeat_NonExistent(t *testing.T) {
	registry := requireTaskRegistry(t)

	// Should not panic
	_ = registry.Heartbeat(context.Background(), "nonexistent-heartbeat")
}

func TestTaskRegistry_MarkStarted(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("start-task-1", 1, "prompt", "model", OrchestrateTaskOptions{})

	// First mark should succeed
	started := registry.MarkStarted("start-task-1")
	if !started {
		t.Error("Expected MarkStarted to succeed")
	}

	state := registry.Get("start-task-1")
	if state == nil {
		t.Fatal("Expected state after mark started")
		return
	}
	if !state.Started {
		t.Error("Expected Started to be true")
	}
}

func TestTaskRegistry_MarkStartedAlreadyStartedRecently(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "already-started-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	started, err := registry.MarkStartedWithError(taskID)
	require.NoError(t, err)
	require.True(t, started)

	startedAgain, err := registry.MarkStartedWithError(taskID)
	require.NoError(t, err)
	require.False(t, startedAgain)
}

func TestTaskRegistry_MarkStartedAlreadyStartedRecentlyMiniredis(t *testing.T) {
	registry, _, cleanup := setupMiniredisRegistry(t)
	defer cleanup()

	taskID := "mark-recent-started"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.True(t, registry.MarkStarted(taskID))

	started, err := registry.MarkStartedWithError(taskID)
	require.NoError(t, err)
	assert.False(t, started)
}

func TestTaskRegistry_MarkStartedInvalidJSON(t *testing.T) {
	registry, client, cleanup := setupMiniredisRegistry(t)
	defer cleanup()

	taskID := "mark-invalid-json"
	require.NoError(t, client.Set(context.Background(), "task:"+taskID, []byte("{bad"), TaskTTL))

	started, err := registry.MarkStartedWithError(taskID)
	require.Error(t, err)
	assert.False(t, started)
}

func TestTaskRegistry_MarkStartedNilRedisClient(t *testing.T) {
	registry := requireTaskRegistry(t)

	redis.SetClient(nil)
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })

	started, err := registry.MarkStartedWithError("mark-nil-client")
	require.Error(t, err)
	assert.False(t, started)
}
