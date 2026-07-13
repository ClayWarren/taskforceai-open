package stream

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/go-engine/pkg/run"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStreamHandler_SendStartEventIncludesAgentCount(t *testing.T) {
	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: "task-start",
		userID: 1,
		rc:     http.NewResponseController(resp),
	}
	h.sendStartEvent(&run.TaskState{
		ModelID:       "gpt-4",
		AgentStatuses: []any{map[string]any{"status": "RUNNING"}, map[string]any{"status": "QUEUED"}},
	})
	assert.True(t, h.hasStarted)
	assert.Contains(t, resp.Body.String(), `"type":"start"`)
	assert.Contains(t, resp.Body.String(), `"agent_count":2`)
}

func TestStreamHandler_SendStateAwaitingStatus(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	taskID := "task-awaiting"
	registry := run.GetRegistry()
	require.NoError(t, registry.Register(taskID, 3, "prompt", "gpt", run.OrchestrateTaskOptions{}))
	require.NoError(t, registry.UpdateWithApproval(context.Background(), taskID, &run.PendingApproval{Permission: "write"}))

	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: taskID, userID: 3, rc: http.NewResponseController(resp)}
	assert.True(t, h.sendState())
	assert.Contains(t, resp.Body.String(), `"pending_approval"`)
}

func TestStreamHandler_SendStateDefaultStatus(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	taskID := "task-custom-status"
	registry := run.GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", run.OrchestrateTaskOptions{}))
	require.NoError(t, registry.Update(context.Background(), taskID, run.TaskStatus("queued"), "waiting", ""))

	resp := httptest.NewRecorder()
	h := &streamHandler{
		w:      resp,
		taskID: taskID,
		userID: 1,
		rc:     http.NewResponseController(resp),
	}
	assert.True(t, h.sendState())
	assert.Contains(t, resp.Body.String(), `"type":"progress"`)
}

func TestStreamHandler_SendStateUnauthorizedAndMissing(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: "missing", userID: 1, rc: http.NewResponseController(resp)}
	assert.False(t, h.sendState())

	registry := run.GetRegistry()
	taskID := "task-unauthorized"
	require.NoError(t, registry.Register(taskID, 2, "prompt", "gpt", run.OrchestrateTaskOptions{}))

	resp2 := httptest.NewRecorder()
	h2 := &streamHandler{w: resp2, taskID: taskID, userID: 1, rc: http.NewResponseController(resp2)}
	assert.False(t, h2.sendState())
	assert.Contains(t, resp2.Body.String(), "Unauthorized")
}

func TestStreamHandler_TaskAwaitingIncludesPendingApproval(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamAuth(t, 16)

	taskID := "task-awaiting-approval"
	registry := run.GetRegistry()
	_ = registry.Register(taskID, 16, "prompt", "gpt-4", run.OrchestrateTaskOptions{})
	_ = registry.UpdateWithApproval(context.Background(), taskID, &run.PendingApproval{
		ApprovalID: "approval-stream-1",
		Permission: "fs.read",
		AgentName:  "agent-1",
		Patterns:   []string{"**/*"},
		Metadata:   map[string]any{"source": "test"},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
	ctx, cancel := context.WithCancel(req.Context())
	cancel()
	req = req.WithContext(ctx)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"type":"progress"`)
	assert.Contains(t, resp.Body.String(), `"pending_approval":{"approvalId":"approval-stream-1","permission":"fs.read","agentName":"agent-1","patterns":["**/*"],"metadata":{"source":"test"}}`)
}

func TestStreamHandler_TaskCompleted(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamAuth(t, 7)

	taskID := "task-complete"
	registry := run.GetRegistry()
	_ = registry.Register(taskID, 7, "prompt", "gpt-4", run.OrchestrateTaskOptions{})
	_ = registry.UpdateProgress(taskID, []any{map[string]any{"status": "RUNNING"}}, nil, nil)
	_ = registry.UpdateWithConversation(context.Background(), taskID, run.StatusCompleted, "done", "", 42, "")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"type":"complete"`)
	assert.Contains(t, resp.Body.String(), `"conversation_id":42`)
}

func TestStreamHandler_TaskCompletedIncludesToolUsage(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamAuth(t, 17)

	taskID := "task-complete-tools"
	registry := run.GetRegistry()
	_ = registry.Register(taskID, 17, "prompt", "gpt-4", run.OrchestrateTaskOptions{})
	_ = registry.UpdateProgress(taskID, []any{map[string]any{"status": "RUNNING"}}, []any{map[string]any{"tool_name": "search"}}, nil)
	_ = registry.UpdateWithConversation(context.Background(), taskID, run.StatusCompleted, "done", "", 45, "")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"type":"complete"`)
	assert.Contains(t, resp.Body.String(), `"tool_usage":[{"toolName":"search"}]`)
}

func TestStreamHandler_TaskCompletedIncludesTraceID(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamAuth(t, 13)

	taskID := "task-complete-trace"
	registry := run.GetRegistry()
	_ = registry.Register(taskID, 13, "prompt", "openai/gpt-5.6-sol", run.OrchestrateTaskOptions{})
	_ = registry.UpdateWithConversation(context.Background(), taskID, run.StatusCompleted, "done", "", 44, "trace_task-complete-trace")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"type":"complete"`)
	assert.Contains(t, resp.Body.String(), `"trace_id":"trace_task-complete-trace"`)
	assert.Contains(t, resp.Body.String(), `"conversation_id":44`)
}

// Regression tests for Bug 5: recoveryLease sync.Map grows unbounded.
// The fix replaced the bare sync.Map with a TTL-aware recoveryLeaseMap whose
// entries are evicted on access and by a periodic background sweep, so the
// map can never accumulate entries for tasks that have long since finished.

func TestStreamHandler_TaskCompletedWithTrailingSlash(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamAuth(t, 7)

	taskID := "task-complete-slash"
	registry := run.GetRegistry()
	_ = registry.Register(taskID, 7, "prompt", "gpt-4", run.OrchestrateTaskOptions{})
	_ = registry.UpdateWithConversation(context.Background(), taskID, run.StatusCompleted, "done", "", 42, "")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID+"/", nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"type":"complete"`)
	assert.NotContains(t, resp.Body.String(), "Task not found")
}

func TestStreamHandler_TaskFailed(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamAuth(t, 12)

	taskID := "task-failed"
	registry := run.GetRegistry()
	_ = registry.Register(taskID, 12, "prompt", "openai/gpt-5.6-sol", run.OrchestrateTaskOptions{})
	_ = registry.Update(context.Background(), taskID, run.StatusFailed, "", "model failed")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"type":"error"`)
	assert.Contains(t, resp.Body.String(), "model failed")
}

func TestStreamHandler_TaskCanceledTerminates(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	taskID := "task-canceled"
	registry := run.GetRegistry()
	require.NoError(t, registry.Register(taskID, 12, "prompt", "openai/gpt-5.6-sol", run.OrchestrateTaskOptions{}))
	require.NoError(t, registry.Update(context.Background(), taskID, run.StatusCanceled, "", "Run canceled"))

	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: taskID, userID: 12, rc: http.NewResponseController(resp)}
	assert.False(t, h.sendState())
	assert.Contains(t, resp.Body.String(), `"type":"error"`)
	assert.Contains(t, resp.Body.String(), "Run canceled")
}

func TestStreamHandler_TaskNotFound(t *testing.T) {
	withStreamAuth(t, 1)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/task_1", nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "Task not found")
}

func TestStreamHandler_TaskProcessingStart(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamAuth(t, 5)

	taskID := "task-processing"
	registry := run.GetRegistry()
	_ = registry.Register(taskID, 5, "prompt", "gpt-4", run.OrchestrateTaskOptions{})
	_ = registry.UpdateProgress(taskID, []any{map[string]any{"status": "RUNNING"}}, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
	ctx, cancel := context.WithCancel(req.Context())
	cancel()
	req = req.WithContext(ctx)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), `"type":"start"`)
	assert.Contains(t, resp.Body.String(), `"type":"progress"`)
}

func TestStreamHandler_TaskUnauthorized(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	withStreamAuth(t, 1)

	taskID := "task-unauth"
	registry := run.GetRegistry()
	_ = registry.Register(taskID, 99, "prompt", "gpt-4", run.OrchestrateTaskOptions{})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/"+taskID, nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "Unauthorized")
}

func TestStreamHandler_TriggerRecoveryLease(t *testing.T) {
	restore(t, &orchestrateTask)
	recoveryDone := make(chan struct{})
	orchestrateTask = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts run.OrchestrateTaskOptions) {
		close(recoveryDone)
	}

	redis.SetClient(redis.NewMockClient())
	taskID := "task-stale-recovery"
	registry := run.GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt", run.OrchestrateTaskOptions{}))
	state := registry.Get(taskID)
	require.NotNil(t, state)
	state.UpdatedAt = time.Now().Unix() - 120
	payload, err := json.Marshal(state)
	require.NoError(t, err)
	client, err := redis.GetClient()
	require.NoError(t, err)
	require.NoError(t, client.Set(context.Background(), "task:"+taskID, payload, run.TaskTTL))

	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: taskID, userID: 1, rc: http.NewResponseController(resp)}
	assert.True(t, h.sendState())
	select {
	case <-recoveryDone:
	case <-time.After(2 * time.Second):
		t.Fatal("expected stale-task recovery goroutine to finish")
	}
}

func TestStreamHandler_TriggerRecoverySkipsWhenLeaseHeld(t *testing.T) {
	restore(t, &recoveryLease)
	recoveryLease = &recoveryLeaseMap{entries: make(map[string]time.Time)}

	restore(t, &orchestrateTask)
	var calls int
	recoveryDone := make(chan struct{})
	orchestrateTask = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts run.OrchestrateTaskOptions) {
		calls++
		close(recoveryDone)
	}

	taskID := "lease-held-unique-task"
	task := &run.TaskState{TaskID: taskID, UserID: 1, Status: run.StatusProcessing, UpdatedAt: time.Now().Unix() - 120}
	resp := httptest.NewRecorder()
	h := &streamHandler{w: resp, taskID: taskID, userID: 1, rc: http.NewResponseController(resp)}
	h.triggerRecovery(task)
	select {
	case <-recoveryDone:
	case <-time.After(2 * time.Second):
		t.Fatal("expected recovery orchestration to start")
	}
	h.triggerRecovery(task)
	assert.Equal(t, 1, calls)
}

func TestStreamHandler_UnauthenticatedUser(t *testing.T) {
	withUnauthenticatedStream(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/stream/task_any", nil)
	resp := httptest.NewRecorder()

	Handler(resp, req)

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
	assert.Contains(t, resp.Body.String(), "Unauthorized")
}
