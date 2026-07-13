package run

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	configpkg "github.com/TaskForceAI/config/pkg"
	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestOrchestratePulseTurn_DBQueriesError(t *testing.T) {
	restore(t, &DBQueriesGetter)

	DBQueriesGetter = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	}

	OrchestratePulseTurn(context.Background(), "agent-1", "scheduled")
}

func TestOrchestratePulseTurn_ExecutionErrorSetsIdle(t *testing.T) {
	mockDB, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create db mock: %v", err)
	}
	defer mockDB.Close()

	q := db.New(mockDB)
	redisClient := redis.NewMockClient()
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	agentColumns := []string{
		"id", "user_id", "name", "description", "avatar", "model_id", "autonomy_enabled",
		"timezone", "active_start", "active_end", "active_days", "check_interval",
		"last_run_at", "next_run_at", "status", "created_at", "updated_at",
	}
	mockDB.ExpectQuery(`SELECT .* FROM agents`).
		WithArgs("agent-exec-fail").
		WillReturnRows(
			pgxmock.NewRows(agentColumns).AddRow(
				"agent-exec-fail", int32(32), "Pulse Agent", nil, nil, nil, true,
				"UTC", "09:00", "17:00", []int32{1, 2, 3}, int32(120),
				ts, ts, "IDLE", ts, ts,
			),
		)
	mockDB.ExpectExec(`UPDATE agents`).
		WithArgs("agent-exec-fail", "BUSY").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mockDB.ExpectExec(`UPDATE agents`).
		WithArgs("agent-exec-fail", "IDLE").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	stubOrchestrateConfigLayer(t, redisClient)
	withDBQueries(t, q)
	restore(t, &RedisClientGetter)
	RedisClientGetter = func() (redis.Cmdable, error) { return redisClient, nil }
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: false, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		return nil
	}
	ExecutePulseOrchestration = func(ctx context.Context, orch *orchestrator.TaskOrchestrator, prompt, taskID string, userID int, trustLayerEnabled bool) (string, *orchestrator.OrchestrationTrace, error) {
		return "", nil, errors.New("pulse execution failed")
	}

	OrchestratePulseTurn(context.Background(), "agent-exec-fail", "timer")

	status, err := redisClient.Get(context.Background(), "agent_status:agent-exec-fail")
	if err != nil {
		t.Fatalf("expected redis status to be set: %v", err)
	}
	if status != "IDLE" {
		t.Fatalf("expected IDLE status after execution failure, got %q", status)
	}
	if err := mockDB.ExpectationsWereMet(); err != nil {
		t.Fatalf("db expectations not met: %v", err)
	}
}

func TestOrchestratePulseTurn_RegisterFailureSetsIdle(t *testing.T) {
	mockDB, agentID := setupPulseAgentMockStatusOnly(t, "agent-register-fail", int32(45))
	redisClient := redis.NewMockClient()
	stubPulseDeps(t, mockDB, redisClient)

	registry := new(mockTaskRegistrar)
	originalRegistry := GetRegistry()
	SetRegistry(registry)
	t.Cleanup(func() { SetRegistry(originalRegistry) })
	registry.On("Register", mock.MatchedBy(func(taskID string) bool {
		return strings.HasPrefix(taskID, "pulse_")
	}), 45, mock.Anything, mock.Anything, mock.Anything).Return(errors.New("register failed")).Once()

	OrchestratePulseTurn(context.Background(), agentID, "timer")

	status, err := redisClient.Get(context.Background(), "agent_status:"+agentID)
	require.NoError(t, err)
	assert.Equal(t, "IDLE", status)
	registry.AssertExpectations(t)
	require.NoError(t, mockDB.ExpectationsWereMet())
}

func TestOrchestratePulseTurn_ExecutionErrorUpdateFailureSetsIdle(t *testing.T) {
	mockDB, agentID := setupPulseAgentMockStatusOnly(t, "agent-update-fail", int32(46))
	redisClient := redis.NewMockClient()
	stubPulseDeps(t, mockDB, redisClient)

	registry := new(mockTaskRegistrar)
	originalRegistry := GetRegistry()
	SetRegistry(registry)
	t.Cleanup(func() { SetRegistry(originalRegistry) })
	registry.On("Register", mock.MatchedBy(func(taskID string) bool {
		return strings.HasPrefix(taskID, "pulse_")
	}), 46, mock.Anything, mock.Anything, mock.Anything).Return(nil).Once()
	registry.On("Update", mock.Anything, mock.MatchedBy(func(taskID string) bool {
		return strings.HasPrefix(taskID, "pulse_")
	}), StatusFailed, "", "pulse execution failed").Return(errors.New("update failed")).Once()

	OrchestratePulseTurn(context.Background(), agentID, "timer")

	status, err := redisClient.Get(context.Background(), "agent_status:"+agentID)
	require.NoError(t, err)
	assert.Equal(t, "IDLE", status)
	registry.AssertExpectations(t)
	require.NoError(t, mockDB.ExpectationsWereMet())
}

func TestOrchestratePulseTurn_PulseStateUpdateFailureStillCompletes(t *testing.T) {
	mockDB, agentID := setupPulseAgentMock(t, "agent-pulse-state-fail", int32(44))
	redisClient := redis.NewMockClient()
	stubPulseDeps(t, mockDB, redisClient)

	mockDB.ExpectExec(`UPDATE agents`).
		WithArgs(agentID, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errors.New("pulse state update failed"))

	ExecutePulseOrchestration = func(ctx context.Context, orch *orchestrator.TaskOrchestrator, prompt, taskID string, userID int, trustLayerEnabled bool) (string, *orchestrator.OrchestrationTrace, error) {
		return "done", nil, nil
	}
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
	}

	OrchestratePulseTurn(context.Background(), agentID, "timer")

	status, err := redisClient.Get(context.Background(), "agent_status:"+agentID)
	require.NoError(t, err)
	assert.Equal(t, "IDLE", status)
}

func TestOrchestratePulseTurn_RedisBusySetFailureStillRuns(t *testing.T) {
	mockDB, agentID := setupPulseAgentMock(t, "agent-redis-busy", int32(43))
	redisClient := &pulseSetErrorRedis{MockClient: redis.NewMockClient(), failAgentStatus: true}
	stubPulseDeps(t, mockDB, redisClient)

	ExecutePulseOrchestration = func(ctx context.Context, orch *orchestrator.TaskOrchestrator, prompt, taskID string, userID int, trustLayerEnabled bool) (string, *orchestrator.OrchestrationTrace, error) {
		return "ok", nil, nil
	}
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
	}

	OrchestratePulseTurn(context.Background(), agentID, "timer")
	require.NoError(t, mockDB.ExpectationsWereMet())
}

func TestOrchestratePulseTurn_Scheduled(t *testing.T) {
	mockDB, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create db mock: %v", err)
	}
	defer mockDB.Close()

	q := db.New(mockDB)
	redisClient := redis.NewMockClient()
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}

	agentColumns := []string{
		"id", "user_id", "name", "description", "avatar", "model_id", "autonomy_enabled",
		"timezone", "active_start", "active_end", "active_days", "check_interval",
		"last_run_at", "next_run_at", "status", "created_at", "updated_at",
	}
	mockDB.ExpectQuery(`SELECT .* FROM agents`).
		WithArgs("agent-scheduled").
		WillReturnRows(
			pgxmock.NewRows(agentColumns).AddRow(
				"agent-scheduled", int32(21), "Pulse Agent", nil, nil, nil, true,
				"UTC", "00:00", "23:59", []int32{0, 1, 2, 3, 4, 5, 6}, int32(60),
				ts, ts, "ready", ts, ts,
			))

	mockDB.ExpectExec(`UPDATE agents SET status = \$1`).
		WithArgs("busy", "agent-scheduled").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	// Mock dependencies
	withDBQueries(t, q)
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return redisClient, nil })
	restore(t, &ExecutePulseOrchestration)
	ExecutePulseOrchestration = func(ctx context.Context, orch *orchestrator.TaskOrchestrator, prompt, taskID string, userID int, trustLayerEnabled bool) (string, *orchestrator.OrchestrationTrace, error) {
		return "Scheduled pulse ok", nil, nil
	}

	OrchestratePulseTurn(context.Background(), "agent-scheduled", "scheduled")
}

func TestOrchestratePulseTurn_Success(t *testing.T) {
	mockDB, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create db mock: %v", err)
	}
	defer mockDB.Close()

	q := db.New(mockDB)
	redisClient := redis.NewMockClient()
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}

	agentColumns := []string{
		"id", "user_id", "name", "description", "avatar", "model_id", "autonomy_enabled",
		"timezone", "active_start", "active_end", "active_days", "check_interval",
		"last_run_at", "next_run_at", "status", "created_at", "updated_at",
	}
	mockDB.ExpectQuery(`SELECT .* FROM agents`).
		WithArgs("agent-success").
		WillReturnRows(
			pgxmock.NewRows(agentColumns).AddRow(
				"agent-success",
				int32(21),
				"Pulse Agent",
				nil,
				nil,
				nil,
				true,
				"UTC",
				"09:00",
				"17:00",
				[]int32{1, 2, 3},
				int32(120),
				ts,
				ts,
				"IDLE",
				ts,
				ts,
			),
		)
	mockDB.ExpectExec(`UPDATE agents`).
		WithArgs("agent-success", "BUSY").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mockDB.ExpectExec(`UPDATE agents`).
		WithArgs("agent-success", pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mockDB.ExpectExec(`UPDATE agents`).
		WithArgs("agent-success", "IDLE").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	stubOrchestrateConfigLayer(t, redisClient)
	withDBQueries(t, q)
	restore(t, &RedisClientGetter)
	RedisClientGetter = func() (redis.Cmdable, error) { return redisClient, nil }
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: false, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		return nil
	}

	executed := false
	var capturedTaskID string
	ExecutePulseOrchestration = func(ctx context.Context, orch *orchestrator.TaskOrchestrator, prompt, taskID string, userID int, trustLayerEnabled bool) (string, *orchestrator.OrchestrationTrace, error) {
		executed = true
		capturedTaskID = taskID
		return "Pulse execution complete", nil, nil
	}

	finalized := false
	var capturedModel string
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
		finalized = true
		capturedModel = modelID
	}

	OrchestratePulseTurn(context.Background(), "agent-success", "timer")

	if !executed {
		t.Fatal("expected pulse execution runner to be invoked")
	}
	if !finalized {
		t.Fatal("expected finalize task to be invoked")
	}
	assert.Equal(t, "openai/gpt-5.6-sol", capturedModel)
	state := GetRegistry().Get(capturedTaskID)
	require.NotNil(t, state)
	assert.Equal(t, int(21), state.UserID)
	assert.Equal(t, "pulse", state.Options.Source)

	status, err := redisClient.Get(context.Background(), "agent_status:agent-success")
	if err != nil {
		t.Fatalf("expected redis agent status to be set, got error: %v", err)
	}
	if status != "IDLE" {
		t.Fatalf("expected final redis status IDLE, got %q", status)
	}

	if err := mockDB.ExpectationsWereMet(); err != nil {
		t.Fatalf("db expectations not met: %v", err)
	}
}

func TestOrchestratePulseTurn_TrustLayerLoadsTraceRepository(t *testing.T) {
	mockDB, agentID := setupPulseAgentMock(t, "agent-trust-trace", int32(46))
	redisClient := redis.NewMockClient()
	stubPulseDeps(t, mockDB, redisClient)

	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{
			TrustLayerEnabled:    true,
			WebSearchEnabled:     true,
			CodeExecutionEnabled: true,
		}, nil
	}
	traceLoaded := false
	restore(t, &LoadTraceRepository)
	LoadTraceRepository = func(ctx context.Context) (*Repository, error) {
		traceLoaded = true
		return &Repository{}, nil
	}

	ExecutePulseOrchestration = func(ctx context.Context, orch *orchestrator.TaskOrchestrator, prompt, taskID string, userID int, trustLayerEnabled bool) (string, *orchestrator.OrchestrationTrace, error) {
		return "pulse-ok", &orchestrator.OrchestrationTrace{OriginalQuery: "q"}, nil
	}
	var capturedTraceID string
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
		capturedTraceID = traceID
	}

	OrchestratePulseTurn(context.Background(), agentID, "timer")
	assert.True(t, traceLoaded)
	assert.Contains(t, capturedTraceID, "trace_")
	require.NoError(t, mockDB.ExpectationsWereMet())
}

func TestOrchestratePulseTurn_UsesUserMemoryAndPlanSettings(t *testing.T) {
	mockDB, agentID := setupPulseAgentMock(t, "agent-memory-disabled", int32(47))
	redisClient := redis.NewMockClient()
	stubPulseDeps(t, mockDB, redisClient)

	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{
			UserPlan:             "enterprise",
			MemoryEnabled:        false,
			WebSearchEnabled:     true,
			CodeExecutionEnabled: true,
		}, nil
	}
	ExecutePulseOrchestration = func(ctx context.Context, orch *orchestrator.TaskOrchestrator, prompt, taskID string, userID int, trustLayerEnabled bool) (string, *orchestrator.OrchestrationTrace, error) {
		return "pulse-ok", nil, nil
	}
	var capturedMemoryEnabled bool
	var capturedPlan string
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
		capturedMemoryEnabled = memoryEnabled
		capturedPlan = opts.UserPlan
	}

	OrchestratePulseTurn(context.Background(), agentID, "timer")

	assert.False(t, capturedMemoryEnabled)
	assert.Equal(t, "enterprise", capturedPlan)
	require.NoError(t, mockDB.ExpectationsWereMet())
}

func TestOrchestratePulseTurn_UserContextFailureSetsIdle(t *testing.T) {
	mockDB, agentID := setupPulseAgentMockStatusOnly(t, "agent-userctx-fail", int32(42))
	redisClient := redis.NewMockClient()
	stubPulseDeps(t, mockDB, redisClient)

	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: false, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{}, errors.New("user context unavailable")
	}

	OrchestratePulseTurn(context.Background(), agentID, "timer")

	status, err := redisClient.Get(context.Background(), "agent_status:"+agentID)
	require.NoError(t, err)
	assert.Equal(t, "IDLE", status)
	require.NoError(t, mockDB.ExpectationsWereMet())
}

func TestOrchestratePulseTurn_UsesConfiguredAgentModelID(t *testing.T) {
	agentID := "agent-model-id"
	modelID := "openai/gpt-5.6-luna"
	mockDB := dbtest.NewMockPool(t)

	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	agentColumns := []string{
		"id", "user_id", "name", "description", "avatar", "model_id", "autonomy_enabled",
		"timezone", "active_start", "active_end", "active_days", "check_interval",
		"last_run_at", "next_run_at", "status", "created_at", "updated_at",
	}
	mockDB.ExpectQuery(`SELECT .* FROM agents`).
		WithArgs(agentID).
		WillReturnRows(
			pgxmock.NewRows(agentColumns).AddRow(
				agentID, int32(45), "Pulse Agent", nil, nil, &modelID, true,
				"UTC", "09:00", "17:00", []int32{1}, int32(60),
				ts, ts, "IDLE", ts, ts,
			),
		)
	mockDB.ExpectExec(`UPDATE agents`).WithArgs(agentID, "BUSY").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mockDB.ExpectExec(`UPDATE agents`).WithArgs(agentID, pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mockDB.ExpectExec(`UPDATE agents`).WithArgs(agentID, "IDLE").WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	redisClient := redis.NewMockClient()
	stubPulseDeps(t, mockDB, redisClient)

	var capturedModel string
	ExecutePulseOrchestration = func(ctx context.Context, orch *orchestrator.TaskOrchestrator, prompt, taskID string, userID int, trustLayerEnabled bool) (string, *orchestrator.OrchestrationTrace, error) {
		return "ok", nil, nil
	}
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, model string, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
		capturedModel = model
	}

	OrchestratePulseTurn(context.Background(), agentID, "timer")
	assert.Equal(t, modelID, capturedModel)
	require.NoError(t, mockDB.ExpectationsWereMet())
}

func TestOrchestrateTask_AlreadyStarted(t *testing.T) {
	taskID := "already-started-task"
	registry := GetRegistry()
	_ = registry.Register(taskID, 2, "prompt", "gpt-4", OrchestrateTaskOptions{})
	_ = registry.MarkStarted(taskID)

	OrchestrateTask(context.Background(), taskID, 2, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	if state == nil {
		t.Fatalf("expected task state")
	}
	if !state.Started {
		t.Fatalf("expected task to remain started")
	}
	if state.Status != StatusProcessing {
		t.Fatalf("expected status processing, got %s", state.Status)
	}
}

func TestOrchestrateTask_AlreadyStartedSkipsExecution(t *testing.T) {
	taskID := "already-started-skip"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))
	require.True(t, registry.MarkStarted(taskID))

	execCalled := false
	restore(t, &ExecuteOrchestrate)
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		execCalled = true
		return "", nil, nil
	}

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})
	require.False(t, execCalled)
}

func TestOrchestrateTask_AttachmentBlobMissingFails(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	taskID := "missing-blob-task"
	require.NoError(t, mockRedis.Set(context.Background(), AttachmentKeyPrefix+taskID, []byte(`{"files":[{"id":"missing","mime_type":"image/png","name":"img.png"}]}`), time.Minute))

	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusFailed, state.Status)
	require.Contains(t, state.Error, "attachments")
}

func TestOrchestrateTask_AttachmentCountMismatchFails(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	taskID := "attachment-mismatch-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{AttachmentCount: 2}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{AttachmentCount: 2})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusFailed, state.Status)
	require.Contains(t, state.Error, "attachments are no longer available")
}

func TestOrchestrateTask_CacheHit(t *testing.T) {
	originalConfig := ConfigLoader
	originalModel := ModelSelectionResolver
	originalWebEnv := WebEnvLoader
	defer func() {
		ConfigLoader = originalConfig
		ModelSelectionResolver = originalModel
		WebEnvLoader = originalWebEnv
	}()

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Models: coreconfig.ModelsConfig{
				Default: "gpt-4",
				Options: []coreconfig.ModelOption{{ID: "gpt-4"}},
			},
		}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (orchestrator.ModelSelectionResult, error) {
		return orchestrator.ModelSelectionResult{
			Config:          cfg,
			SelectedModel:   orchestrator.ModelOption{ID: modelID},
			SelectorEnabled: true,
			Options:         []orchestrator.ModelOption{{ID: modelID}},
		}, nil
	}
	WebEnvLoader = func(opts configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return &configpkg.WebEnv{}, nil
	}
	withMockRedis(t)

	mockCache := new(cacheMock)
	mockCache.On("Get", mock.Anything, mock.Anything).Return("cached answer", nil)

	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		return mockCache
	})

	registry := GetRegistry()
	taskID := "cache-hit-task"
	_ = registry.Register(taskID, 1, "simple question", "gpt-4", OrchestrateTaskOptions{})

	OrchestrateTask(context.Background(), taskID, 1, "simple question", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	if state == nil {
		t.Fatalf("expected task state")
	}
	if state.Status != StatusCompleted {
		t.Fatalf("expected status completed, got %s", state.Status)
	}
	if state.Result != "cached answer" {
		t.Fatalf("expected cached answer, got %s", state.Result)
	}
	mockCache.AssertExpectations(t)
}

func TestOrchestrateTask_CacheHitCompletesWithoutExecution(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	mockCache := new(cacheMock)
	mockCache.On("Get", mock.Anything, mock.Anything).Return("cached answer", nil)
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache { return mockCache })

	execCalled := false
	restore(t, &ExecuteOrchestrate)
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		execCalled = true
		return "", nil, nil
	}

	taskID := "cache-hit-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "simple question", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "simple question", "gpt-4", OrchestrateTaskOptions{})
	require.False(t, execCalled)

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusCompleted, state.Status)
	require.Equal(t, "cached answer", state.Result)
}
