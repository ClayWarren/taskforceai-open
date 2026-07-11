package run

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	configpkg "github.com/TaskForceAI/config/pkg"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	modelselection "github.com/TaskForceAI/core/pkg/orchestrator"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type noEvalRedis struct {
	*redis.MockClient
}

func (c noEvalRedis) SupportsEval() bool {
	return false
}

func (c noEvalRedis) Eval(ctx context.Context, script string, keys []string, args ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	cmd.SetErr(errors.New("Eval should not be called when SupportsEval is false"))
	return cmd
}

type updateLockSetNXErrorRedis struct {
	*redis.MockClient
}

func (c *updateLockSetNXErrorRedis) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if len(key) >= len("task:update_lock:") && key[:len("task:update_lock:")] == "task:update_lock:" {
		return false, errors.New("setnx failed")
	}
	return c.MockClient.SetNX(ctx, key, value, ttl)
}

type updateLockDelErrorRedis struct {
	*redis.MockClient
}

func (c *updateLockDelErrorRedis) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if len(key) >= len("task:update_lock:") && key[:len("task:update_lock:")] == "task:update_lock:" {
		return true, nil
	}
	return c.MockClient.SetNX(ctx, key, value, ttl)
}

func (c *updateLockDelErrorRedis) Del(ctx context.Context, key string) (bool, error) {
	if len(key) >= len("task:update_lock:") && key[:len("task:update_lock:")] == "task:update_lock:" {
		return false, errors.New("del failed")
	}
	return c.MockClient.Del(ctx, key)
}

func TestTaskRegistry_Update(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("task-1", 1, "p", "m", OrchestrateTaskOptions{})
	_ = registry.Update(context.Background(), "task-1", StatusCompleted, "success result", "")

	state := registry.Get("task-1")
	if state == nil {
		t.Fatal("Expected state after update")
		return
	}

	if state.Status != StatusCompleted {
		t.Errorf("Expected status 'completed', got %s", state.Status)
	}
	if state.Result != "success result" {
		t.Errorf("Expected result 'success result', got %s", state.Result)
	}
	if state.Error != "" {
		t.Errorf("Expected empty error, got %s", state.Error)
	}
}

func TestTaskRegistry_UpdateFailed(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("task-1", 1, "p", "m", OrchestrateTaskOptions{})
	_ = registry.Update(context.Background(), "task-1", StatusFailed, "", "something went wrong")

	state := registry.Get("task-1")
	if state == nil {
		t.Fatal("Expected state after update")
		return
	}

	if state.Status != StatusFailed {
		t.Errorf("Expected status 'failed', got %s", state.Status)
	}
	if state.Result != "" {
		t.Errorf("Expected empty result, got %s", state.Result)
	}
	if state.Error != "something went wrong" {
		t.Errorf("Expected error 'something went wrong', got %s", state.Error)
	}
}

func TestTaskRegistry_UpdateTerminalTraceAndClearApprovalNoop(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "terminal-trace-task"
	require.NoError(t, registry.Register(taskID, 1, "p", "m", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Update(context.Background(), taskID, StatusCompleted, "done", ""))
	require.NoError(t, registry.UpdateWithConversation(context.Background(), taskID, StatusCompleted, "done", "", 0, "trace-1"))

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, "trace-1", state.TraceID)

	require.NoError(t, registry.ClearApproval(context.Background(), taskID))
}

func TestTaskRegistry_UpdateNonExistent(t *testing.T) {
	registry := requireTaskRegistry(t)

	// Should not panic
	_ = registry.Update(context.Background(), "nonexistent", StatusCompleted, "result", "")

	state := registry.Get("nonexistent")
	if state != nil {
		t.Error("Expected nil for nonexistent task")
	}
}

func TestTaskRegistry_UpdateProgress(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("progress-task", 1, "prompt", "model", OrchestrateTaskOptions{})

	agentStatuses := []map[string]any{{"agent": "test", "status": "running"}}
	toolEvents := []map[string]any{{"tool": "search", "event": "start"}}

	_ = registry.UpdateProgress("progress-task", agentStatuses, toolEvents, nil)

	state := registry.Get("progress-task")
	if state == nil {
		t.Fatal("Expected state after progress update")
		return
	}

	if state.AgentStatuses == nil {
		t.Error("Expected AgentStatuses to be set")
	}
	if state.ToolEvents == nil {
		t.Error("Expected ToolEvents to be set")
	}
}

func TestTaskRegistry_UpdateProgressErrorBranches(t *testing.T) {
	registry := requireTaskRegistry(t)

	redis.SetClient(nil)
	err := registry.UpdateProgress("missing", nil, nil, nil)
	require.Error(t, err)

	redis.SetClient(redis.NewMockClient())
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	err = registry.UpdateProgress("missing", func() {}, nil, nil)
	require.ErrorContains(t, err, "marshal agentStatuses")

	err = registry.UpdateProgress("missing", nil, func() {}, nil)
	require.ErrorContains(t, err, "marshal toolEvents")

	redis.SetClient(&evalResultRedis{MockClient: redis.NewMockClient(), err: errors.New("redis eval operations require REDIS_URL")})
	err = registry.UpdateProgress("missing", nil, nil, nil)
	require.NoError(t, err)
}

func TestTaskRegistry_UpdateProgressEvalSuccess(t *testing.T) {
	redis.SetClient(&evalResultRedis{MockClient: redis.NewMockClient(), result: int64(1)})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "eval-success-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	require.NoError(t, registry.UpdateProgress(taskID, []any{map[string]any{"status": "RUNNING"}}, nil, nil))
}

func TestTaskRegistry_UpdateProgressLegacyPersists(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "legacy-progress-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	require.NoError(t, registry.updateProgressLegacy(taskID, []any{map[string]any{"status": "RUNNING"}}, nil, &BudgetUsage{ConsumedUSD: 1.5}))

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, float64(1.5), state.BudgetUsage.ConsumedUSD)
}

func TestTaskRegistry_UpdateProgressLegacyPreservesAgentStatusesOnToolOnlyUpdate(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "legacy-progress-preserve-status-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	agentStatuses := []any{map[string]any{"status": "RUNNING"}}
	toolEvents := []any{map[string]any{"tool": "search"}}
	require.NoError(t, registry.updateProgressLegacy(taskID, agentStatuses, nil, nil))
	require.NoError(t, registry.updateProgressLegacy(taskID, nil, toolEvents, nil))

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, agentStatuses, state.AgentStatuses)
	assert.Equal(t, toolEvents, state.ToolEvents)
}

func TestTaskRegistry_UpdateProgressUsesLegacyWhenEvalUnsupported(t *testing.T) {
	redis.SetClient(noEvalRedis{MockClient: redis.NewMockClient()})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "no-eval-progress-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	require.NoError(t, registry.UpdateProgress(taskID, []any{map[string]any{"status": "RUNNING"}}, nil, &BudgetUsage{ConsumedUSD: 2.5}))

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, float64(2.5), state.BudgetUsage.ConsumedUSD)
}

func TestTaskRegistry_UpdateProgressMarshalBudgetUsageError(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "marshal-budget-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	err := registry.UpdateProgress(taskID, []any{}, nil, &BudgetUsage{
		InitialUSD: func() *float64 { v := math.NaN(); return &v }(),
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "marshal budgetUsage")
}

func TestTaskRegistry_UpdateProgressNoopAndLegacyPaths(t *testing.T) {
	redis.SetClient(&evalResultRedis{
		MockClient: redis.NewMockClient(),
		err:        errors.New("task not processing"),
	})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "progress-noop-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Update(context.Background(), taskID, StatusCompleted, "done", ""))

	require.NoError(t, registry.UpdateProgress(taskID, []any{map[string]any{"status": "RUNNING"}}, nil, nil))
}

func TestTaskRegistry_UpdateProgressValidationError(t *testing.T) {
	redis.SetClient(&evalResultRedis{
		MockClient: redis.NewMockClient(),
		err:        errors.New("invalid agentStatuses json"),
	})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "progress-validation-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	err := registry.UpdateProgress(taskID, "not-json-array", nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "validation failed")
}

func TestTaskRegistry_UpdateProgressFallsBackOnUnexpectedLuaError(t *testing.T) {
	redis.SetClient(&evalResultRedis{
		MockClient: redis.NewMockClient(),
		err:        errors.New("lua unavailable"),
	})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "progress-unexpected-lua-error-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	agentStatuses := []any{map[string]any{"status": "RUNNING"}}
	require.NoError(t, registry.UpdateProgress(taskID, agentStatuses, nil, nil))

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, agentStatuses, state.AgentStatuses)
}

func TestTaskRegistry_UpdateProgress_Completed(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("completed-progress", 1, "prompt", "model", OrchestrateTaskOptions{})
	_ = registry.Update(context.Background(), "completed-progress", StatusCompleted, "result", "")

	// Progress update on completed task should be skipped
	_ = registry.UpdateProgress("completed-progress", []string{"new"}, []string{"new"}, nil)

	state := registry.Get("completed-progress")
	if state == nil {
		t.Fatal("Expected state")
		return
	}
	// AgentStatuses should not have been set
	if state.AgentStatuses != nil {
		t.Error("Expected AgentStatuses to be nil for completed task")
	}
}

func TestTaskRegistry_UpdateProgress_EvalSuccessPath(t *testing.T) {
	registry, _, cleanup := setupMiniredisRegistry(t)
	defer cleanup()

	taskID := "eval-success-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	err := registry.UpdateProgress(taskID, []any{map[string]any{"status": "RUNNING"}}, []any{map[string]any{"tool": "search"}}, &BudgetUsage{ConsumedUSD: 0.5})
	require.NoError(t, err)

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.NotNil(t, state.AgentStatuses)
}

func BenchmarkTaskRegistryUpdateProgressToolEvents(b *testing.B) {
	agentStatuses := make([]map[string]any, 0, 16)
	for i := range 16 {
		agentStatuses = append(agentStatuses, map[string]any{
			"agentId": i,
			"status":  "processing",
			"message": "working",
		})
	}
	toolEvents := make([]map[string]any, 0, 120)
	for i := range 120 {
		toolEvents = append(toolEvents, map[string]any{
			"invocationId": "call",
			"agentLabel":   "agent",
			"toolName":     "search_web",
			"status":       "completed",
			"success":      true,
			"durationMs":   i * 3,
			"arguments": map[string]any{
				"query": "latest taskforce progress",
			},
			"resultPreview": "large search preview payload",
		})
	}

	b.Run("full_statuses_and_tool_events", func(b *testing.B) {
		registry, _, cleanup := setupMiniredisRegistry(b)
		defer cleanup()
		taskID := "bench-progress-full"
		require.NoError(b, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

		b.ReportAllocs()
		b.ResetTimer()
		for b.Loop() {
			if err := registry.UpdateProgress(taskID, agentStatuses, toolEvents, nil); err != nil {
				b.Fatal(err)
			}
		}
	})

	b.Run("tool_events_only", func(b *testing.B) {
		registry, _, cleanup := setupMiniredisRegistry(b)
		defer cleanup()
		taskID := "bench-progress-tool-only"
		require.NoError(b, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
		require.NoError(b, registry.UpdateProgress(taskID, agentStatuses, nil, nil))

		b.ReportAllocs()
		b.ResetTimer()
		for b.Loop() {
			if err := registry.UpdateProgress(taskID, nil, toolEvents, nil); err != nil {
				b.Fatal(err)
			}
		}
	})

	b.Run("statuses_only_after_tool_events", func(b *testing.B) {
		registry, _, cleanup := setupMiniredisRegistry(b)
		defer cleanup()
		taskID := "bench-progress-status-after-tools"
		require.NoError(b, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
		require.NoError(b, registry.UpdateProgress(taskID, nil, toolEvents, nil))

		b.ReportAllocs()
		b.ResetTimer()
		for b.Loop() {
			if err := registry.UpdateProgress(taskID, agentStatuses, nil, nil); err != nil {
				b.Fatal(err)
			}
		}
	})
}

func BenchmarkTaskRegistryNoopUpdatesMiniredis(b *testing.B) {
	b.Run("completed_heartbeat_skip", func(b *testing.B) {
		registry, _, cleanup := setupMiniredisRegistry(b)
		defer cleanup()
		taskID := "bench-heartbeat-skip"
		require.NoError(b, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
		require.NoError(b, registry.Update(context.Background(), taskID, StatusCompleted, "done", ""))

		ctx := context.Background()
		b.ReportAllocs()
		for b.Loop() {
			if err := registry.Heartbeat(ctx, taskID); err != nil {
				b.Fatal(err)
			}
		}
	})

	b.Run("completed_heartbeat_legacy_write", func(b *testing.B) {
		registry, _, cleanup := setupMiniredisRegistry(b)
		defer cleanup()
		taskID := "bench-heartbeat-write"
		require.NoError(b, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
		require.NoError(b, registry.Update(context.Background(), taskID, StatusCompleted, "done", ""))

		ctx := context.Background()
		b.ReportAllocs()
		for b.Loop() {
			if err := registry.watchUpdate(ctx, taskID, func(task *TaskState) error {
				return nil
			}); err != nil {
				b.Fatal(err)
			}
		}
	})
}

func TestTaskRegistry_UpdateProgress_NonExistent(t *testing.T) {
	registry := requireTaskRegistry(t)

	// Should not panic
	_ = registry.UpdateProgress("nonexistent-progress", nil, nil, nil)
}

func TestTaskRegistry_UpdateWithApprovalNotProcessing(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "approval-not-processing"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.Update(context.Background(), taskID, StatusCompleted, "done", ""))

	err := registry.UpdateWithApproval(context.Background(), taskID, &PendingApproval{Permission: "write"})
	require.Error(t, err)
}

func TestTaskRegistry_UpdateWithConversation(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("conv-task", 1, "prompt", "model", OrchestrateTaskOptions{})

	_ = registry.UpdateWithConversation(context.Background(), "conv-task", StatusCompleted, "result", "", 12345, "")

	state := registry.Get("conv-task")
	if state == nil {
		t.Fatal("Expected state after update with conversation")
		return
	}

	if state.ConversationID != 12345 {
		t.Errorf("Expected ConversationID 12345, got %d", state.ConversationID)
	}
	if state.Status != StatusCompleted {
		t.Errorf("Expected status completed, got %s", state.Status)
	}
}

func TestTaskRegistry_UpdateWithConversationSetsIDs(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "conv-trace-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	require.NoError(t, registry.UpdateWithConversation(
		context.Background(),
		taskID,
		StatusCompleted,
		"done",
		"",
		42,
		"trace-abc",
	))

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, int32(42), state.ConversationID)
	assert.Equal(t, "trace-abc", state.TraceID)
}

func TestTaskRegistry_UpdateWithConversationFillsTerminalMetadata(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "conv-terminal-metadata-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.UpdateWithConversation(
		context.Background(),
		taskID,
		StatusCompleted,
		"done",
		"",
		0,
		"trace-early",
	))

	require.NoError(t, registry.UpdateWithConversation(
		context.Background(),
		taskID,
		StatusCompleted,
		"ignored replacement",
		"memory extraction failed",
		123,
		"trace-late",
	))

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCompleted, state.Status)
	assert.Equal(t, "done", state.Result)
	assert.Equal(t, int32(123), state.ConversationID)
	assert.Equal(t, "trace-early", state.TraceID)
	assert.Equal(t, "memory extraction failed", state.Error)
}

func TestTaskRegistry_UpdateWithConversationViaWatch(t *testing.T) {
	registry, _, cleanup := setupMiniredisRegistry(t)
	defer cleanup()

	taskID := "conv-watch-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.UpdateWithConversation(context.Background(), taskID, StatusCompleted, "done", "", 42, "trace-1"))

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCompleted, state.Status)
	assert.Equal(t, int32(42), state.ConversationID)
}

func TestTaskRegistry_UpdateWithConversation_ZeroID(t *testing.T) {
	registry := requireTaskRegistry(t)

	_ = registry.Register("conv-zero", 1, "prompt", "model", OrchestrateTaskOptions{})

	// Set a conversation ID first
	_ = registry.UpdateWithConversation(context.Background(), "conv-zero", StatusCompleted, "result", "", 999, "")

	// Update with 0 should NOT overwrite
	_ = registry.UpdateWithConversation(context.Background(), "conv-zero", StatusFailed, "", "error", 0, "")

	state := registry.Get("conv-zero")
	if state == nil {
		t.Fatal("Expected state")
		return
	}

	// ConversationID should still be 999 (not overwritten by 0)
	if state.ConversationID != 999 {
		t.Errorf("Expected ConversationID to remain 999, got %d", state.ConversationID)
	}
}

func TestTaskRegistry_WatchUpdateDirect(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "watch-update-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	err := registry.watchUpdate(context.Background(), taskID, func(state *TaskState) error {
		state.Result = "updated"
		return nil
	})
	require.NoError(t, err)

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, "updated", state.Result)
}

func TestTaskRegistry_WatchUpdateFallbackPath(t *testing.T) {
	registry := requireTaskRegistry(t)
	taskID := "watch-fallback-task"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	err := registry.UpdateWithApproval(context.Background(), taskID, &PendingApproval{
		Permission: "write",
		AgentName:  "agent",
	})
	require.NoError(t, err)

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusAwaiting, state.Status)
	require.NotNil(t, state.PendingApproval)
	assert.Positive(t, state.ProgressVersion)
}

func TestTaskRegistry_WatchUpdateLockNotAcquired(t *testing.T) {
	redis.SetClient(&updateLockBusyRedis{MockClient: redis.NewMockClient()})
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "update-lock-busy"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))

	err := registry.watchUpdate(context.Background(), taskID, func(state *TaskState) error {
		state.Result = "should-not-apply"
		return nil
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to acquire update lock")
}

func TestTaskRegistry_WatchUpdateFallbackLockBranches(t *testing.T) {
	registry := requireTaskRegistry(t)

	setNXErr := &updateLockSetNXErrorRedis{MockClient: redis.NewMockClient()}
	err := registry.updateWithFallbackLock(context.Background(), setNXErr, "update-lock-setnx-error", func(state *TaskState) error {
		return nil
	})
	require.EqualError(t, err, "setnx failed")

	delErr := &updateLockDelErrorRedis{MockClient: redis.NewMockClient()}
	redis.SetClient(delErr)
	taskID := "update-lock-del-error"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	err = registry.updateWithFallbackLock(context.Background(), delErr, taskID, func(state *TaskState) error {
		return errTaskUnchanged
	})
	require.NoError(t, err)

	err = registry.updateWithFallbackLock(context.Background(), delErr, "missing-update-lock-task", func(state *TaskState) error {
		return nil
	})
	require.ErrorContains(t, err, "task not found")

	err = registry.updateWithFallbackLock(context.Background(), delErr, taskID, func(state *TaskState) error {
		return errors.New("update failed")
	})
	require.EqualError(t, err, "update failed")

	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
}

func TestTaskRegistry_WatchUpdateWatchBranches(t *testing.T) {
	registry, client, cleanup := setupMiniredisRegistry(t)
	defer cleanup()
	ctx := context.Background()

	taskID := "watch-update-branches"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}))
	require.NoError(t, registry.watchUpdate(ctx, taskID, func(state *TaskState) error {
		return errTaskUnchanged
	}))

	require.EqualError(t, registry.watchUpdate(ctx, taskID, func(state *TaskState) error {
		return errors.New("watch update failed")
	}), "watch update failed")

	require.Error(t, registry.watchUpdate(ctx, "missing-watch-update-branches", func(state *TaskState) error {
		return nil
	}))

	invalidID := "watch-update-invalid"
	require.NoError(t, client.Set(ctx, taskStateKey(invalidID), []byte("{invalid"), TaskTTL))
	require.Error(t, registry.watchUpdate(ctx, invalidID, func(state *TaskState) error {
		return nil
	}))
}

func TestTaskRegistry_WatchUpdateMissingTask(t *testing.T) {
	registry := requireTaskRegistry(t)
	err := registry.watchUpdate(context.Background(), "missing-watch-task", func(state *TaskState) error {
		return nil
	})
	require.Error(t, err)
}

func TestTaskState_Struct(t *testing.T) {
	state := TaskState{
		TaskID: "task-123",
		Status: StatusProcessing,
		UserID: 456,
		Result: "some result",
		Error:  "some error",
	}

	if state.TaskID != "task-123" {
		t.Errorf("Expected TaskID 'task-123', got %s", state.TaskID)
	}
	if state.Status != StatusProcessing {
		t.Errorf("Expected Status processing, got %s", state.Status)
	}
	if state.UserID != 456 {
		t.Errorf("Expected UserID 456, got %d", state.UserID)
	}
	if state.Result != "some result" {
		t.Errorf("Expected Result 'some result', got %s", state.Result)
	}
	if state.Error != "some error" {
		t.Errorf("Expected Error 'some error', got %s", state.Error)
	}
}

func TestTaskStatus_Constants(t *testing.T) {
	if StatusProcessing != "processing" {
		t.Errorf("Expected 'processing', got %s", StatusProcessing)
	}
	if StatusCompleted != "completed" {
		t.Errorf("Expected 'completed', got %s", StatusCompleted)
	}
	if StatusFailed != "failed" {
		t.Errorf("Expected 'failed', got %s", StatusFailed)
	}
	if StatusCanceled != "canceled" {
		t.Errorf("Expected 'canceled', got %s", StatusCanceled)
	}
}

func TestTaskTTL(t *testing.T) {
	if TaskTTL.Hours() != 1 {
		t.Errorf("Expected TaskTTL to be 1 hour, got %v", TaskTTL)
	}
}

// --- Service Function Tests ---

func TestUpdateProgress_CompletesWithinTimeout(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)

	// Register a live task so UpdateProgress has something to act on.
	taskID := "timeout-regression-up"
	if err := registry.Register(taskID, 1, "prompt", "model", OrchestrateTaskOptions{}); err != nil {
		t.Fatalf("Register: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		done <- registry.UpdateProgress(taskID, []map[string]any{{"status": "running"}}, nil, nil)
	}()

	// Use 3× persistenceTimeout as an extremely generous
	// test budget that still catches an infinite block.
	select {
	case err := <-done:
		if err != nil {
			t.Logf("UpdateProgress returned non-nil error (acceptable in test env): %v", err)
		}
	case <-time.After(3 * persistenceTimeout):
		t.Fatal("UpdateProgress did not return within 3×persistenceTimeout — context is not being applied")
	}
}

// TestMarkStartedWithError_CompletesWithinTimeout verifies that
// MarkStartedWithError returns within a bounded time even when using the
// mock Redis client, confirming the timeout context is actually used.

func TestWebEnvLoader_Applied(t *testing.T) {
	originalLoader := ConfigLoader
	originalResolver := ModelSelectionResolver
	originalWebEnvLoader := WebEnvLoader
	defer func() {
		ConfigLoader = originalLoader
		ModelSelectionResolver = originalResolver
		WebEnvLoader = originalWebEnvLoader
	}()

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{
				BaseURL: "https://original.example.com/v1",
				APIKey:  "original-key",
			},
		}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (modelselection.ModelSelectionResult, error) {
		return modelselection.ModelSelectionResult{Config: cfg}, nil
	}
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{
			AIGatewayAPIKey:    "web-env-key",
			VercelAIGatewayURL: "https://web-env.example.com/gateway/v1",
		}, nil
	}

	cfg, err := prepareConfig("task-1", "gpt-4", OrchestrateTaskOptions{})

	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if cfg.Gateway.APIKey != "web-env-key" {
		t.Errorf("Expected web env API key, got: %s", cfg.Gateway.APIKey)
	}
	if cfg.Gateway.BaseURL != "https://web-env.example.com/gateway/v1" {
		t.Errorf("Expected web env URL, got: %s", cfg.Gateway.BaseURL)
	}
}

func TestPrepareConfig_WebEnvLoaderErrorKeepsBaseGateway(t *testing.T) {
	originalLoader := ConfigLoader
	originalResolver := ModelSelectionResolver
	originalWebEnvLoader := WebEnvLoader
	defer func() {
		ConfigLoader = originalLoader
		ModelSelectionResolver = originalResolver
		WebEnvLoader = originalWebEnvLoader
	}()

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{
				BaseURL: "https://original.example.com/v1",
				APIKey:  "original-key",
			},
		}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (modelselection.ModelSelectionResult, error) {
		return modelselection.ModelSelectionResult{Config: cfg}, nil
	}
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return nil, errors.New("invalid web env")
	}

	cfg, err := prepareConfig("task-1", "gpt-4", OrchestrateTaskOptions{})

	require.NoError(t, err)
	assert.Equal(t, "original-key", cfg.Gateway.APIKey)
	assert.Equal(t, "https://original.example.com/v1", cfg.Gateway.BaseURL)
}

// Regression tests for Bug 6: task_registry.go used context.Background() in
// save(), MarkStartedWithError(), markStartedWithSetNXLock(), and
// UpdateProgress(), preventing graceful shutdown when Redis was unreachable.
//
// The fix introduces persistenceTimeout so every persistence goroutine
// has a bounded wall-clock deadline rather than blocking forever.

// TestPersistenceTimeout_Defined verifies the constant is present and
// has a sensible ceiling so it cannot be accidentally removed or zeroed.
