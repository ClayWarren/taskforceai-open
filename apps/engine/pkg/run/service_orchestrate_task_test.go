package run

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/TaskForceAI/core/pkg/workflows"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func setOrchestrateTaskHeartbeatIntervalForTest(interval time.Duration) func() {
	previous := atomic.SwapInt64(&orchestrateTaskHeartbeatIntervalNanos, interval.Nanoseconds())
	return func() {
		atomic.StoreInt64(&orchestrateTaskHeartbeatIntervalNanos, previous)
	}
}

func TestOrchestrateTask_CacheIgnoredStaleFailure(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	restore(t, &CacheFactory)

	mockCache := new(cacheMock)
	mockCache.On("Get", mock.Anything, mock.Anything).Return("Maximum iterations reached without answer", nil)
	CacheFactory = func(client redis.Cmdable) corecache.ICache { return mockCache }

	taskID := "cache-stale-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "simple question", "gpt-4", OrchestrateTaskOptions{}))

	execCalled := false
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		execCalled = true
		return "fresh", nil, nil
	}

	OrchestrateTask(context.Background(), taskID, 1, "simple question", "gpt-4", OrchestrateTaskOptions{})
	require.True(t, execCalled)
	mockCache.AssertExpectations(t)
}

func TestOrchestrateTask_ClientMCPToolsRegistered(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	budget := 10.0
	taskID := "mcp-budget-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{
		ClientMCPTools: []ClientMCPTool{{ServerName: "local", ToolName: "search", Title: "Search"}},
		Budget:         &budget,
	}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{
		ClientMCPTools: []ClientMCPTool{{ServerName: "local", ToolName: "search", Title: "Search"}},
		Budget:         &budget,
	})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusCompleted, state.Status)
}

func TestOrchestrateTask_ComputerUseLoggedInInstructions(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	var capturedInstructions string
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		capturedInstructions = input.ProjectInstructions
		return newTestOrchestrator(input.LLMAdapter)
	}

	restore(t, &LoadRunUserContext)
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{
			ProjectInstructions:  "base instructions",
			WebSearchEnabled:     true,
			CodeExecutionEnabled: true,
		}, nil
	}

	taskID := "computer-use-task"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{
		ComputerUseEnabled:  true,
		UseLoggedInServices: true,
	}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{
		ComputerUseEnabled:  true,
		UseLoggedInServices: true,
	})

	require.Contains(t, capturedInstructions, "LOGGED IN")
}

func TestOrchestrateTask_ResearchWorkflowInstructions(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	var capturedInstructions string
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		capturedInstructions = input.ProjectInstructions
		return newTestOrchestrator(input.LLMAdapter)
	}

	restore(t, &LoadRunUserContext)
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{
			ProjectInstructions:  "base instructions",
			WebSearchEnabled:     true,
			CodeExecutionEnabled: true,
		}, nil
	}

	opts := OrchestrateTaskOptions{
		ResearchWorkflow: ResearchWorkflowOption{
			Workflow:          workflows.ResearchWorkflowEarningsSummary,
			RequiredCitations: true,
			SourcePolicy:      workflows.ResearchWorkflowSourcePublicAndAttached,
		},
	}
	taskID := "research-workflow-task"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", opts))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", opts)

	require.Contains(t, capturedInstructions, "[FINANCE RESEARCH WORKFLOW]")
	require.Contains(t, capturedInstructions, "Workflow: earnings summary")
	require.Contains(t, capturedInstructions, "company investor-relations pages")
	require.Contains(t, capturedInstructions, "do not rely on paid market-data")
}

func TestOrchestrateTask_ExecutionBranch_NoAttachments_NonTrust(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)
	execCalled := false
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		execCalled = true
		return "orchestrated", nil, nil
	}
	ExecuteOrchestrateWithTask = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt, taskID string, userID *int32) (string, *orchestrator.OrchestrationTrace, error) {
		t.Fatal("unexpected trust-layer execution path")
		return "", nil, nil
	}
	ExecuteOrchestrateMultimodal = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string, parts []agent.ContentPart) (string, *orchestrator.OrchestrationTrace, error) {
		t.Fatal("unexpected multimodal execution path")
		return "", nil, nil
	}
	ExecuteOrchestrateMultimodalWithTask = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string, parts []agent.ContentPart, taskID string, userID *int32) (string, *orchestrator.OrchestrationTrace, error) {
		t.Fatal("unexpected trust multimodal execution path")
		return "", nil, nil
	}

	finalized := false
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
		finalized = true
		if result != "orchestrated" {
			t.Fatalf("unexpected finalized result: %q", result)
		}
	}

	taskID := "execution-no-attachments-non-trust"
	registry := GetRegistry()
	if err := registry.Register(taskID, 10, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
		t.Fatalf("failed to register task: %v", err)
	}

	OrchestrateTask(context.Background(), taskID, 10, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})

	if !execCalled {
		t.Fatal("expected non-trust execution path to be called")
	}
	if !finalized {
		t.Fatal("expected finalize task to be called")
	}
}

func TestOrchestrateTask_ExecutionBranch_NoAttachments_TrustLayer(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateConfigLayer(t, mockRedis)
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: true, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		return newTestOrchestrator(input.LLMAdapter)
	}
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		t.Fatal("unexpected non-trust execution path")
		return "", nil, nil
	}

	execWithTaskCalled := false
	ExecuteOrchestrateWithTask = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt, taskID string, userID *int32) (string, *orchestrator.OrchestrationTrace, error) {
		execWithTaskCalled = true
		if userID == nil || *userID != 11 {
			t.Fatalf("unexpected trust user id pointer: %+v", userID)
		}
		return "trusted", nil, nil
	}

	finalized := false
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
		finalized = true
		if result != "trusted" {
			t.Fatalf("unexpected finalized result: %q", result)
		}
	}

	taskID := "execution-no-attachments-trust"
	registry := GetRegistry()
	if err := registry.Register(taskID, 11, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
		t.Fatalf("failed to register task: %v", err)
	}

	OrchestrateTask(context.Background(), taskID, 11, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})

	if !execWithTaskCalled {
		t.Fatal("expected trust execution path to be called")
	}
	if !finalized {
		t.Fatal("expected finalize task to be called")
	}
}

func TestOrchestrateTask_ExecutionBranch_WithAttachments(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)
	ExecuteOrchestrateMultimodal = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string, parts []agent.ContentPart) (string, *orchestrator.OrchestrationTrace, error) {
		return "mm", nil, nil
	}

	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
	}

	taskIDNonTrust := "execution-attachments-non-trust"
	if err := mockRedis.Set(context.Background(), AttachmentKeyPrefix+taskIDNonTrust, []byte(`{"files":[{"id":"img1","mime_type":"image/png","name":"img.png"}]}`), time.Minute); err != nil {
		t.Fatalf("failed to seed attachments: %v", err)
	}
	if err := mockRedis.Set(context.Background(), AttachmentMetaKeyPrefix+"img1", []byte("aGVsbG8="), time.Minute); err != nil {
		t.Fatalf("failed to seed attachment meta: %v", err)
	}
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: false, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}

	nonTrustCalled := false
	ExecuteOrchestrateMultimodal = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string, parts []agent.ContentPart) (string, *orchestrator.OrchestrationTrace, error) {
		nonTrustCalled = true
		if len(parts) != 1 || parts[0].Type != agent.ContentPartImageURL {
			t.Fatalf("unexpected parts: %+v", parts)
		}
		return "mm", nil, nil
	}

	registry := GetRegistry()
	if err := registry.Register(taskIDNonTrust, 12, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
		t.Fatalf("failed to register task: %v", err)
	}
	OrchestrateTask(context.Background(), taskIDNonTrust, 12, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})
	if !nonTrustCalled {
		t.Fatal("expected non-trust multimodal path")
	}

	taskIDTrust := "execution-attachments-trust"
	if err := mockRedis.Set(context.Background(), AttachmentKeyPrefix+taskIDTrust, []byte(`{"files":[{"id":"img2","mime_type":"image/png","name":"img.png"}]}`), time.Minute); err != nil {
		t.Fatalf("failed to seed trust attachments: %v", err)
	}
	if err := mockRedis.Set(context.Background(), AttachmentMetaKeyPrefix+"img2", []byte("aGVsbG8="), time.Minute); err != nil {
		t.Fatalf("failed to seed trust attachment meta: %v", err)
	}
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: true, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}

	trustCalled := false
	ExecuteOrchestrateMultimodalWithTask = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string, parts []agent.ContentPart, taskID string, userID *int32) (string, *orchestrator.OrchestrationTrace, error) {
		trustCalled = true
		if len(parts) != 1 || parts[0].Type != agent.ContentPartImageURL {
			t.Fatalf("unexpected trust parts: %+v", parts)
		}
		if userID == nil || *userID != 13 {
			t.Fatalf("unexpected trust user id pointer: %+v", userID)
		}
		return "mm-trust", nil, nil
	}

	if err := registry.Register(taskIDTrust, 13, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
		t.Fatalf("failed to register task: %v", err)
	}
	OrchestrateTask(context.Background(), taskIDTrust, 13, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})
	if !trustCalled {
		t.Fatal("expected trust multimodal path")
	}
}

func TestOrchestrateTask_ExecutionContextDeadlineUsesFriendlyMessage(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		return "", nil, context.DeadlineExceeded
	}

	taskID := "timeout-msg-task"
	reg := new(mockTaskRegistrar)
	reg.On("Get", taskID).Return(&TaskState{TaskID: taskID, UserID: 1})
	reg.On("MarkStartedWithError", taskID).Return(true, nil)
	reg.On("Heartbeat", mock.Anything, taskID).Return(nil).Maybe()
	reg.On("UpdateProgress", taskID, mock.Anything, mock.Anything, mock.Anything).Return(nil)
	reg.On("Update", mock.Anything, taskID, StatusFailed, "", mock.MatchedBy(func(msg string) bool {
		return strings.Contains(msg, "timed out")
	})).Return(nil)

	oldReg := GetRegistry()
	SetRegistry(reg)
	defer SetRegistry(oldReg)

	ctx, cancel := context.WithTimeout(context.Background(), time.Nanosecond)
	defer cancel()
	time.Sleep(2 * time.Nanosecond)

	OrchestrateTask(ctx, taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})
	reg.AssertExpectations(t)
}

func TestOrchestrateTask_ExecutionErrorMarksTaskFailed(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		return "", nil, errors.New("model unavailable")
	}

	taskID := "execution-error-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusFailed, state.Status)
	assert.Contains(t, state.Error, "model unavailable")
}

func TestOrchestrateTask_ExecutionErrorWithoutDeadline(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		return "", nil, errors.New("model provider unavailable")
	}

	taskID := "exec-error-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusFailed, state.Status)
	require.Contains(t, state.Error, "model provider unavailable")
}

func TestOrchestrateTask_HeartbeatFailureIsNonFatal(t *testing.T) {
	t.Cleanup(setOrchestrateTaskHeartbeatIntervalForTest(10 * time.Millisecond))

	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		time.Sleep(35 * time.Millisecond)
		return "ok", nil, nil
	}

	taskID := "heartbeat-error-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	originalRegistry := defaultRegistry
	SetRegistry(&delegatingRegistrar{
		inner:     registry,
		heartbeat: func(context.Context, string) error { return errors.New("heartbeat failed") },
	})
	t.Cleanup(func() { SetRegistry(originalRegistry) })

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusCompleted, state.Status)
}

func TestOrchestrateTask_HeartbeatPanicRecovered(t *testing.T) {
	t.Cleanup(setOrchestrateTaskHeartbeatIntervalForTest(5 * time.Millisecond))

	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	inner := GetRegistry()
	panicOnce := false
	panicRegistrar := &delegatingRegistrar{
		inner: inner,
		heartbeat: func(ctx context.Context, taskID string) error {
			if !panicOnce {
				panicOnce = true
				panic("heartbeat panic")
			}
			return inner.Heartbeat(ctx, taskID)
		},
	}
	SetRegistry(panicRegistrar)
	t.Cleanup(func() { SetRegistry(inner) })

	done := make(chan struct{})
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		time.Sleep(50 * time.Millisecond)
		close(done)
		return "ok", nil, nil
	}

	taskID := "heartbeat-panic-task"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))
	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	<-done
	state := GetRegistry().Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCompleted, state.Status)
}

func TestOrchestrateTask_HeartbeatPersistsDuringExecution(t *testing.T) {
	t.Cleanup(setOrchestrateTaskHeartbeatIntervalForTest(15 * time.Millisecond))

	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		time.Sleep(60 * time.Millisecond)
		return "ok", nil, nil
	}

	taskID := "heartbeat-live-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))
	var heartbeatCalls atomic.Int32
	originalRegistry := defaultRegistry
	SetRegistry(&delegatingRegistrar{
		inner: registry,
		heartbeat: func(ctx context.Context, taskID string) error {
			heartbeatCalls.Add(1)
			return registry.Heartbeat(ctx, taskID)
		},
	})
	t.Cleanup(func() { SetRegistry(originalRegistry) })

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	final := registry.Get(taskID)
	require.NotNil(t, final)
	require.Equal(t, StatusCompleted, final.Status)
	require.GreaterOrEqual(t, heartbeatCalls.Load(), int32(1))
}

func TestOrchestrateTask_InitOrchestratorNil(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateConfigLayer(t, mockRedis)
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: false, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		return nil
	}

	taskID := "orchestrator-nil-task"
	registry := GetRegistry()
	_ = registry.Register(taskID, 9, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})

	OrchestrateTask(context.Background(), taskID, 9, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	if state == nil {
		t.Fatalf("expected task state")
	}
	if state.Status != StatusFailed {
		t.Fatalf("expected status failed, got %s", state.Status)
	}
	if state.Error != "orchestrator is nil" {
		t.Fatalf("expected orchestrator nil error, got %q", state.Error)
	}
}

func TestOrchestrateTask_InitRegistryProgressFailureContinues(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	inner := GetRegistry()
	SetRegistry(&delegatingRegistrar{
		inner:          inner,
		updateProgress: func(string, any, any, *BudgetUsage) error { return errors.New("progress update failed") },
	})
	t.Cleanup(func() { SetRegistry(inner) })

	taskID := "progress-init-fail"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))
	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := GetRegistry().Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCompleted, state.Status)
}

func TestOrchestrateTask_InvalidRoleModelFails(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (orchestrator.ModelSelectionResult, error) {
		if modelID == "bad-role-model" {
			return orchestrator.ModelSelectionResult{}, errors.New("unknown model")
		}
		return orchestrator.ModelSelectionResult{
			Config: cfg, SelectedModel: orchestrator.ModelOption{ID: "openai/gpt-5.6-sol"},
			SelectorEnabled: true, Options: []orchestrator.ModelOption{{ID: "openai/gpt-5.6-sol"}},
		}, nil
	}

	taskID := "bad-role-model-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{
		RoleModels: map[string]string{"coder": "bad-role-model"},
	})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusFailed, state.Status)
}
