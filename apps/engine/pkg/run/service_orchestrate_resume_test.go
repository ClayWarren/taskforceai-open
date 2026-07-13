package run

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/core/pkg/agent"
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

func TestOrchestrateTask_RequiresCurrentDataSkipsCacheHit(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	restore(t, &CacheFactory)

	mockCache := new(cacheMock)
	mockCache.On("Get", mock.Anything, mock.Anything).Return("cached", nil).Maybe()
	CacheFactory = func(client redis.Cmdable) corecache.ICache { return mockCache }

	taskID := "current-data-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "latest news today", "gpt-4", OrchestrateTaskOptions{}))

	execCalled := false
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		execCalled = true
		return "fresh", nil, nil
	}

	OrchestrateTask(context.Background(), taskID, 1, "what is the latest news today", "gpt-4", OrchestrateTaskOptions{})
	require.True(t, execCalled)
}

func TestOrchestrateTask_ResolveAdapterError(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateConfigLayer(t, mockRedis)
	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return nil, errors.New("adapter failure")
	}

	taskID := "adapter-error-task"
	registry := GetRegistry()
	_ = registry.Register(taskID, 5, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})

	OrchestrateTask(context.Background(), taskID, 5, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	if state == nil {
		t.Fatalf("expected task state")
	}
	if state.Status != StatusFailed {
		t.Fatalf("expected status failed, got %s", state.Status)
	}
	if state.Error != "adapter failure" {
		t.Fatalf("expected adapter failure error, got %q", state.Error)
	}
}

func TestOrchestrateTask_ResolveAdapterNil(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateConfigLayer(t, mockRedis)
	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return nil, nil
	}

	taskID := "adapter-nil-task"
	registry := GetRegistry()
	_ = registry.Register(taskID, 8, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})

	OrchestrateTask(context.Background(), taskID, 8, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	if state == nil {
		t.Fatalf("expected task state")
	}
	if state.Status != StatusFailed {
		t.Fatalf("expected status failed, got %s", state.Status)
	}
	if state.Error != "adapter is nil" {
		t.Fatalf("expected adapter nil error, got %q", state.Error)
	}
}

func TestOrchestrateTask_ResumeMultimodalWithExistingTrace(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	mockDB := dbtest.NewMockPool(t)

	userID := int32(1)
	now := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
	mockDB.ExpectQuery("GetExecutionTrace").WithArgs("resume-mm-task").WillReturnRows(
		pgxmock.NewRows([]string{"id", "task_id", "user_id", "goal", "plan", "steps", "self_eval", "report", "artifacts", "created_at"}).
			AddRow("trace-mm", "resume-mm-task", &userID, "goal", []byte("[]"), []byte("[]"), []byte("{}"), []byte("{}"), []byte("{}"), now),
	)

	restore(t, &LoadTraceRepository)
	LoadTraceRepository = func(ctx context.Context) (*Repository, error) {
		return NewRepositoryFromQueries(db.New(mockDB)), nil
	}

	restore(t, &LoadRunUserContext)
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{TrustLayerEnabled: true, WebSearchEnabled: true, CodeExecutionEnabled: true}, nil
	}

	resumeCalled := false
	restore(t, &ExecuteResumeOrchestration)
	ExecuteResumeOrchestration = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string, parts []agent.ContentPart, taskID string, uid *int32, existingTrace *orchestrator.ExecutionTrace) (string, *orchestrator.OrchestrationTrace, error) {
		resumeCalled = true
		require.NotNil(t, parts)
		return "resumed-mm", nil, nil
	}

	taskID := "resume-mm-task"
	require.NoError(t, mockRedis.Set(context.Background(), AttachmentKeyPrefix+taskID, []byte(`{"files":[{"id":"img1","mime_type":"image/png","name":"img.png"}]}`), time.Minute))
	require.NoError(t, mockRedis.Set(context.Background(), AttachmentMetaKeyPrefix+"img1", []byte("pngdata"), time.Minute))

	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "describe image", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "describe image", "gpt-4", OrchestrateTaskOptions{})
	require.True(t, resumeCalled)
}

func TestOrchestrateTask_ResumeWithExistingTrace(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	mockDB := dbtest.NewMockPool(t)

	userID := int32(1)
	now := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
	mockDB.ExpectQuery("GetExecutionTrace").WithArgs("resume-text-task").WillReturnRows(
		pgxmock.NewRows([]string{"id", "task_id", "user_id", "goal", "plan", "steps", "self_eval", "report", "artifacts", "created_at"}).
			AddRow("trace-1", "resume-text-task", &userID, "goal", []byte("[]"), []byte("[]"), []byte("{}"), []byte("{}"), []byte("{}"), now),
	)

	restore(t, &LoadTraceRepository)
	LoadTraceRepository = func(ctx context.Context) (*Repository, error) {
		return NewRepositoryFromQueries(db.New(mockDB)), nil
	}

	restore(t, &LoadRunUserContext)
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{TrustLayerEnabled: true, WebSearchEnabled: true, CodeExecutionEnabled: true}, nil
	}

	resumeCalled := false
	restore(t, &ExecuteResumeOrchestration)
	ExecuteResumeOrchestration = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string, parts []agent.ContentPart, taskID string, uid *int32, existingTrace *orchestrator.ExecutionTrace) (string, *orchestrator.OrchestrationTrace, error) {
		resumeCalled = true
		require.NotNil(t, existingTrace)
		require.Nil(t, parts)
		return "resumed", nil, nil
	}

	taskID := "resume-text-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})
	require.True(t, resumeCalled)
	require.NoError(t, mockDB.ExpectationsWereMet())

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusCompleted, state.Status)
}

func TestOrchestrateTask_SetStatusUpdateFailure(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{}, fmt.Errorf("config unavailable")
	}

	taskID := "set-status-fail-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusFailed, state.Status)
	require.Contains(t, strings.ToLower(state.Error), "configuration")
}

func TestOrchestrateTask_SetTaskStatusUpdateFailureOnAdapterError(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	inner := GetRegistry()
	SetRegistry(&delegatingRegistrar{
		inner: inner,
		update: func(ctx context.Context, taskID string, status TaskStatus, result, errStr string) error {
			if status == StatusFailed {
				return errors.New("update failed")
			}
			return inner.Update(ctx, taskID, status, result, errStr)
		},
	})
	t.Cleanup(func() { SetRegistry(inner) })

	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return nil, errors.New("adapter missing")
	}

	taskID := "set-task-status-update-fail"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))
	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := GetRegistry().Get(taskID)
	require.NotNil(t, state)
	// setTaskStatus logs update failure; in-memory registry may remain processing when Update fails.
	_ = state
}

func TestOrchestrateTask_SkipsNativeUploadForPrefixedAttachmentIDs(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ctx := context.Background()
	fileID := "https://storage.example/video.mp4"
	require.NoError(t, StoreAttachment(ctx, fileID, []byte("video-bytes"), time.Minute))
	require.NoError(t, StoreAttachmentInfo(ctx, fileID, AttachmentInfo{
		MimeType: "video/mp4",
		Name:     "clip.mp4",
		Size:     11,
	}, time.Minute))

	payload, err := json.Marshal(Attachments{Files: []FileAttachment{{ID: fileID, MimeType: "video/mp4", Name: "clip.mp4"}}})
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(ctx, AttachmentKeyPrefix+"skip-upload-task", payload, time.Minute))

	mockUploader := &mockGeminiUploader{llmClientMock: new(llmClientMock)}
	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return mockUploader, nil
	}

	taskID := "skip-upload-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{AttachmentCount: 1}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{AttachmentCount: 1})
	mockUploader.AssertNotCalled(t, "UploadFile", mock.Anything, mock.Anything, mock.Anything, mock.Anything)

	state := registry.Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCompleted, state.Status)
}

func TestOrchestrateTask_TraceOwnershipMismatchSkipsResume(t *testing.T) {
	mockDB, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("failed to create db mock: %v", err)
	}
	defer mockDB.Close()

	q := db.New(mockDB)
	now := time.Now()
	ts := pgtype.Timestamp{Time: now, Valid: true}
	otherUserID := int32(999)

	mockDB.ExpectQuery(`SELECT id, task_id, user_id, goal, plan, steps, self_eval, report, artifacts, created_at FROM execution_traces`).
		WithArgs("execution-trace-ownership-mismatch").
		WillReturnRows(
			pgxmock.NewRows([]string{"id", "task_id", "user_id", "goal", "plan", "steps", "self_eval", "report", "artifacts", "created_at"}).
				AddRow("trace-1", "execution-trace-ownership-mismatch", &otherUserID, "goal", []byte(`[]`), []byte(`[]`), []byte(`{}`), []byte(`{}`), []byte(`{}`), ts),
		)

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
	DBQueriesGetter = func(ctx context.Context) (*db.Queries, error) { return q, nil }

	finalized := false
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cacheInstance corecache.ICache, skipCacheSet, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
		finalized = true
		if result != "trusted" {
			t.Fatalf("unexpected finalized result: %q", result)
		}
	}

	taskID := "execution-trace-ownership-mismatch"
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
	if err := mockDB.ExpectationsWereMet(); err != nil {
		t.Fatalf("db expectations not met: %v", err)
	}
}

func TestOrchestrateTask_TrustLayerUserIDOutOfRange(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateConfigLayer(t, mockRedis)
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: true, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		return newTestOrchestrator(input.LLMAdapter)
	}
	taskID := "trust-overflow-task"
	overflowUserID := int(math.MaxInt32) + 1
	registry := GetRegistry()
	if err := registry.Register(taskID, overflowUserID, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}); err != nil {
		t.Fatalf("failed to register task: %v", err)
	}

	OrchestrateTask(context.Background(), taskID, overflowUserID, "prompt", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	if state == nil {
		t.Fatalf("expected task state")
	}
	if state.Status != StatusFailed {
		t.Fatalf("expected failed status, got %s", state.Status)
	}
	if !strings.Contains(state.Error, "userID out of range") {
		t.Fatalf("expected range error, got %q", state.Error)
	}
}

func TestOrchestrateTask_TrustUserIDOutOfRange(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	restore(t, &LoadRunUserContext)
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{TrustLayerEnabled: true}, nil
	}

	taskID := "trust-range-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, int(math.MaxInt32)+1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusFailed, state.Status)
	require.Contains(t, state.Error, "out of range")
}

func TestOrchestrateTask_VideoAttachmentDecodeFailure(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateConfigLayer(t, mockRedis)
	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{BaseURL: "https://ai-gateway.vercel.sh/v1", APIKey: "test-key"},
			Models: coreconfig.ModelsConfig{
				Default: "google/gemini-3.1-pro-preview",
				Options: []coreconfig.ModelOption{{ID: "google/gemini-3.1-pro-preview"}},
			},
		}, nil
	}
	mockGemini := &mockGeminiUploader{llmClientMock: new(llmClientMock)}
	mockGemini.On("UploadFile", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return("", errors.New("decode failure"))
	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return mockGemini, nil
	}

	taskID := "video-decode-failure-task"
	// Use correct 'files' key and separate meta key for data
	if err := mockRedis.Set(context.Background(), AttachmentKeyPrefix+taskID, []byte(`{"files":[{"id":"vid1","mime_type":"video/mp4","name":"clip.mp4"}]}`), time.Minute); err != nil {
		t.Fatalf("failed to seed attachment payload: %v", err)
	}
	if err := mockRedis.Set(context.Background(), AttachmentMetaKeyPrefix+"vid1", []byte("%%%"), time.Minute); err != nil {
		t.Fatalf("failed to seed video meta: %v", err)
	}

	registry := GetRegistry()
	if err := registry.Register(taskID, 7, "analyze video", "google/gemini-3.1-pro-preview", OrchestrateTaskOptions{}); err != nil {
		t.Fatalf("failed to register task: %v", err)
	}

	OrchestrateTask(context.Background(), taskID, 7, "analyze video", "google/gemini-3.1-pro-preview", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	if state == nil {
		t.Fatalf("expected task state")
	}
	if state.Status != StatusFailed {
		t.Fatalf("expected status failed, got %s", state.Status)
	}
	// The error will be "Video upload failed: ..." or "video upload failed: ..." depending on how fmt.Errorf wraps it
	if state.Error == "" || !strings.Contains(strings.ToLower(state.Error), "video upload failed") {
		t.Fatalf("expected video upload failure error, got %q", state.Error)
	}
}

func TestOrchestrateTask_WithOrgIDUsesOrgProfileKey(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	orgID := int32(99)
	taskID := "org-profile-task"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{OrgID: &orgID}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{OrgID: &orgID})

	state := GetRegistry().Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusCompleted, state.Status)
}

func TestPersistApprovalDecisionRedisNil(t *testing.T) {
	restore(t, &RedisClientGetter)
	RedisClientGetter = func() (redis.Cmdable, error) { return nil, nil }

	err := persistApprovalDecision(context.Background(), "task-nil-redis", ApprovalDecision{Approved: true})
	assert.Error(t, err)
}

func TestPrepareConfig_RejectsIncompleteVercelGatewayURL(t *testing.T) {
	originalConfig := ConfigLoader
	originalModel := ModelSelectionResolver
	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{BaseURL: "https://api.vercel.ai", APIKey: "key"},
			Models:  coreconfig.ModelsConfig{Default: "openai/gpt-5.6-sol", Options: []coreconfig.ModelOption{{ID: "openai/gpt-5.6-sol"}}},
		}, nil
	}
	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (orchestrator.ModelSelectionResult, error) {
		return orchestrator.ModelSelectionResult{Config: cfg, SelectedModel: orchestrator.ModelOption{ID: modelID}}, nil
	}
	t.Cleanup(func() {
		ConfigLoader = originalConfig
		ModelSelectionResolver = originalModel
	})

	_, err := prepareConfig("cfg-task", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "VERCEL_AI_GATEWAY_URL is incomplete")
}

func TestRedisCmdableCacheAdapter(t *testing.T) {
	mockRedis := redis.NewMockClient()
	adapter := redisCmdableCacheAdapter{client: mockRedis}
	ctx := context.Background()

	value, found, err := adapter.Get(ctx, "missing")
	if err != nil || found || value != "" {
		t.Fatalf("expected missing key to return not found without error, value=%q found=%v err=%v", value, found, err)
	}

	if err := adapter.Set(ctx, "key", []byte("value"), time.Minute); err != nil {
		t.Fatalf("set cache value: %v", err)
	}
	value, found, err = adapter.Get(ctx, "key")
	if err != nil || !found || value != "value" {
		t.Fatalf("expected cache hit, value=%q found=%v err=%v", value, found, err)
	}

	value, found, err = adapter.GetDel(ctx, "key")
	if err != nil || !found || value != "value" {
		t.Fatalf("expected get-del hit, value=%q found=%v err=%v", value, found, err)
	}
	value, found, err = adapter.GetDel(ctx, "key")
	if err != nil || found || value != "" {
		t.Fatalf("expected second get-del to miss, value=%q found=%v err=%v", value, found, err)
	}
}

func TestRedisCmdableCacheAdapterDel(t *testing.T) {
	mockRedis := redis.NewMockClient()
	adapter := redisCmdableCacheAdapter{client: mockRedis}
	ctx := context.Background()

	require.NoError(t, adapter.Set(ctx, "delete-me", []byte("value"), time.Minute))
	deleted, err := adapter.Del(ctx, "delete-me")
	require.NoError(t, err)
	assert.True(t, deleted)

	deleted, err = adapter.Del(ctx, "missing")
	require.NoError(t, err)
	assert.False(t, deleted)
}

func TestRedisCmdableCacheAdapterGetDelDeleteFailure(t *testing.T) {
	mock := redis.NewMockClient()
	require.NoError(t, mock.Set(context.Background(), "cache-key", []byte("value"), time.Minute))
	adapter := redisCmdableCacheAdapter{client: &redisDelFailClient{MockClient: mock}}
	val, found, err := adapter.GetDel(context.Background(), "cache-key")
	require.Error(t, err)
	assert.False(t, found)
	assert.Empty(t, val)
}

func TestRedisCmdableCacheAdapterGetDelSuccess(t *testing.T) {
	mock := redis.NewMockClient()
	ctx := context.Background()
	require.NoError(t, mock.Set(ctx, "cache-key", []byte("value"), time.Minute))

	adapter := redisCmdableCacheAdapter{client: mock}
	val, found, err := adapter.GetDel(ctx, "cache-key")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "value", val)
}

func TestRedisCmdableCacheAdapterGetErrors(t *testing.T) {
	adapter := redisCmdableCacheAdapter{client: &redisGetFailClient{MockClient: redis.NewMockClient()}}
	_, found, err := adapter.Get(context.Background(), "cache-key")
	require.Error(t, err)
	assert.False(t, found)
}

func TestRedisCmdableCacheAdapter_GetDel(t *testing.T) {
	mockRedis := redis.NewMockClient()
	adapter := redisCmdableCacheAdapter{client: mockRedis}
	ctx := context.Background()

	require.NoError(t, adapter.Set(ctx, "getdel-key", []byte("value"), time.Minute))
	val, found, err := adapter.GetDel(ctx, "getdel-key")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "value", val)

	_, found, err = adapter.GetDel(ctx, "missing-key")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestRedisCmdableCacheAdapter_GetDelDeleteFailure(t *testing.T) {
	mock := redis.NewMockClient()
	adapter := redisCmdableCacheAdapter{client: &getOnlyRedis{MockClient: mock}}
	ctx := context.Background()
	require.NoError(t, mock.Set(ctx, "getdel-fail", []byte("value"), time.Minute))

	_, found, err := adapter.GetDel(ctx, "getdel-fail")
	require.Error(t, err)
	assert.False(t, found)
}

func TestRedisCmdableCacheAdapter_GetDelNotDeleted(t *testing.T) {
	mock := redis.NewMockClient()
	adapter := redisCmdableCacheAdapter{client: &delFalseRedis{MockClient: mock}}
	ctx := context.Background()
	require.NoError(t, mock.Set(ctx, "getdel-missing", []byte("value"), time.Minute))

	_, found, err := adapter.GetDel(ctx, "getdel-missing")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestResetDepsRestoresDefaults(t *testing.T) {
	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{}, errors.New("custom")
	}
	ResetDeps()
	_, err := ConfigLoader("missing-config.yaml")
	assert.Error(t, err)
}

func TestSendTaskEventWithResilienceSuccess(t *testing.T) {
	sender := &captureInngest{id: "evt-resilience"}
	err := sendTaskEventWithResilience(context.Background(), sender, inngestgoEvent("task-resilience"))
	require.NoError(t, err)
	assert.True(t, sender.called)
}

func TestValidateRoleModels_AllowsConfiguredModels(t *testing.T) {
	cfg := coreconfig.Config{
		Models: coreconfig.ModelsConfig{
			Options: []coreconfig.ModelOption{{ID: "allowed/model"}},
		},
	}

	originalModel := ModelSelectionResolver
	defer func() {
		ModelSelectionResolver = originalModel
	}()

	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (orchestrator.ModelSelectionResult, error) {
		if modelID != "allowed/model" {
			return orchestrator.ModelSelectionResult{}, orchestrator.ErrUnknownModel{ModelID: modelID}
		}
		return orchestrator.ModelSelectionResult{}, nil
	}

	err := validateRoleModels(cfg, map[string]string{"planner": " allowed/model "})
	if err != nil {
		t.Fatalf("expected role model validation to pass, got %v", err)
	}
}

func TestValidateRoleModels_RejectsUnknownModel(t *testing.T) {
	cfg := coreconfig.Config{
		Models: coreconfig.ModelsConfig{
			Options: []coreconfig.ModelOption{{ID: "allowed/model"}},
		},
	}

	originalModel := ModelSelectionResolver
	defer func() {
		ModelSelectionResolver = originalModel
	}()

	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (orchestrator.ModelSelectionResult, error) {
		if modelID == "allowed/model" {
			return orchestrator.ModelSelectionResult{}, nil
		}
		return orchestrator.ModelSelectionResult{}, orchestrator.ErrUnknownModel{ModelID: modelID}
	}

	err := validateRoleModels(cfg, map[string]string{"planner": "forbidden/model"})
	if err == nil {
		t.Fatal("expected validation error")
	}
	if !strings.Contains(err.Error(), "invalid role model") {
		t.Fatalf("expected invalid role model error, got %v", err)
	}
}
