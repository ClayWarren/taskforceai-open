package run

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	configpkg "github.com/TaskForceAI/config/pkg"
	"github.com/TaskForceAI/core/pkg/agent"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestOrchestrateTask_LoadRunUserContextFailure(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	restore(t, &LoadRunUserContext)
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{}, errors.New("user context unavailable")
	}

	taskID := "user-context-fail"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusFailed, state.Status)
	require.Contains(t, state.Error, "user context")
}

func TestOrchestrateTask_MarkStartedClaimFailure(t *testing.T) {
	reg := new(mockTaskRegistrar)
	reg.On("Get", "claim-fail-task").Return(&TaskState{TaskID: "claim-fail-task", UserID: 1})
	reg.On("MarkStartedWithError", "claim-fail-task").Return(false, errors.New("redis lock failed"))
	reg.On("Update", mock.Anything, "claim-fail-task", StatusFailed, "", "Task could not be claimed for execution; please retry").Return(nil)

	oldReg := GetRegistry()
	SetRegistry(reg)
	defer SetRegistry(oldReg)

	OrchestrateTask(context.Background(), "claim-fail-task", 1, "prompt", "gpt-4", OrchestrateTaskOptions{})
	reg.AssertExpectations(t)
}

func TestOrchestrateTask_MarkStartedClaimUpdateFailure(t *testing.T) {
	reg := new(mockTaskRegistrar)
	reg.On("Get", "claim-update-fail").Return(&TaskState{TaskID: "claim-update-fail", UserID: 1})
	reg.On("MarkStartedWithError", "claim-update-fail").Return(false, errors.New("redis lock failed"))
	reg.On("Update", mock.Anything, "claim-update-fail", StatusFailed, "", mock.Anything).Return(errors.New("persist failed"))

	oldReg := GetRegistry()
	SetRegistry(reg)
	defer SetRegistry(oldReg)

	OrchestrateTask(context.Background(), "claim-update-fail", 1, "prompt", "gpt-4", OrchestrateTaskOptions{})
	reg.AssertExpectations(t)
}

func TestOrchestrateTask_NativePDFUploadSuccess(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	mockUploader := &mockGeminiUploader{llmClientMock: new(llmClientMock)}
	mockUploader.On("UploadFile", mock.Anything, mock.Anything, "doc.pdf", "application/pdf").Return("file-uploaded-id", nil)
	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return mockUploader, nil
	}

	taskID := "pdf-upload-task"
	require.NoError(t, mockRedis.Set(context.Background(), AttachmentKeyPrefix+taskID, []byte(`{"files":[{"id":"doc1","mime_type":"application/pdf","name":"doc.pdf"}]}`), time.Minute))
	require.NoError(t, mockRedis.Set(context.Background(), AttachmentMetaKeyPrefix+"doc1", []byte("%PDF-1.4"), time.Minute))

	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "summarize pdf", "openai/gpt-5.6-sol", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "summarize pdf", "openai/gpt-5.6-sol", OrchestrateTaskOptions{})
	mockUploader.AssertExpectations(t)
}

func TestOrchestrateTask_NativeUploadFailureFailsTask(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	mockUploader := &mockGeminiUploader{llmClientMock: new(llmClientMock)}
	mockUploader.On("UploadFile", mock.Anything, mock.Anything, "doc.pdf", "application/pdf").Return("", errors.New("upload rejected"))
	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return mockUploader, nil
	}

	taskID := "upload-fail-task"
	require.NoError(t, mockRedis.Set(context.Background(), AttachmentKeyPrefix+taskID, []byte(`{"files":[{"id":"doc1","mime_type":"application/pdf","name":"doc.pdf"}]}`), time.Minute))
	require.NoError(t, mockRedis.Set(context.Background(), AttachmentMetaKeyPrefix+"doc1", []byte("%PDF-1.4"), time.Minute))

	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "summarize", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "summarize", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusFailed, state.Status)
	require.Contains(t, state.Error, "upload")
}

func TestOrchestrateTask_NativeUploadSkipsNonUploadableMime(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ctx := context.Background()
	fileID := "file-plain"
	require.NoError(t, StoreAttachment(ctx, fileID, []byte("text"), time.Minute))
	require.NoError(t, StoreAttachmentInfo(ctx, fileID, AttachmentInfo{
		MimeType: "text/plain",
		Name:     "note.txt",
		Size:     4,
	}, time.Minute))
	payload, err := json.Marshal(Attachments{Files: []FileAttachment{{ID: fileID, MimeType: "text/plain", Name: "note.txt"}}})
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(ctx, AttachmentKeyPrefix+"plain-attach-task", payload, time.Minute))

	mockUploader := &mockGeminiUploader{llmClientMock: new(llmClientMock)}
	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return mockUploader, nil
	}

	taskID := "plain-attach-task"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{AttachmentCount: 1}))
	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{AttachmentCount: 1})
	mockUploader.AssertNotCalled(t, "UploadFile", mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestOrchestrateTask_NilAdapterFails(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ResolveAdapter = func(ctx context.Context, cfg coreconfig.Config, modelID string) (agent.ILLMClient, error) {
		return nil, nil
	}

	taskID := "nil-adapter-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusFailed, state.Status)
	require.Contains(t, state.Error, "adapter is nil")
}

func TestOrchestrateTask_NilOrchestratorFails(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		return nil
	}

	taskID := "nil-orch-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusFailed, state.Status)
	require.Contains(t, state.Error, "orchestrator is nil")
}

func TestOrchestrateTask_PrepareConfigError(t *testing.T) {
	originalConfig := ConfigLoader
	originalRedis := RedisClientGetter
	defer func() {
		ConfigLoader = originalConfig
		RedisClientGetter = originalRedis
	}()

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{}, errors.New("config load failed")
	}
	RedisClientGetter = func() (redis.Cmdable, error) {
		return redis.NewMockClient(), nil
	}

	taskID := "config-error-task"
	registry := GetRegistry()
	_ = registry.Register(taskID, 3, "prompt", "gpt-4", OrchestrateTaskOptions{})

	OrchestrateTask(context.Background(), taskID, 3, "prompt", "gpt-4", OrchestrateTaskOptions{})

	state := registry.Get(taskID)
	if state == nil {
		t.Fatalf("expected task state")
	}
	if state.Status != StatusFailed {
		t.Fatalf("expected status failed, got %s", state.Status)
	}
	if state.Error != "Internal configuration error" {
		t.Fatalf("expected sanitized error message, got %q", state.Error)
	}
}

func TestOrchestrateTask_ProgressUpdateWithBudget(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	budget := 5.0
	taskID := "budget-progress-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{Budget: &budget}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{Budget: &budget})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusCompleted, state.Status)
}

func TestOrchestrateTask_QuickMode(t *testing.T) {
	originalConfig := ConfigLoader
	originalModel := ModelSelectionResolver
	originalWebEnv := WebEnvLoader
	originalRedis := RedisClientGetter
	originalLoadRunUserContext := LoadRunUserContext
	originalInitOrchestrator := InitOrchestrator
	originalExec := ExecuteOrchestrate
	originalDBQueries := DBQueriesGetter
	defer func() {
		ConfigLoader = originalConfig
		ModelSelectionResolver = originalModel
		WebEnvLoader = originalWebEnv
		RedisClientGetter = originalRedis
		LoadRunUserContext = originalLoadRunUserContext
		InitOrchestrator = originalInitOrchestrator
		ExecuteOrchestrate = originalExec
		DBQueriesGetter = originalDBQueries
	}()

	ConfigLoader = func(path string) (coreconfig.Config, error) {
		return coreconfig.Config{
			Gateway: coreconfig.GatewayConfig{
				BaseURL: "https://ai-gateway.vercel.sh/v1",
				APIKey:  "sk-test",
			},
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
	RedisClientGetter = func() (redis.Cmdable, error) {
		return redis.NewMockClient(), nil
	}
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: false, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}

	quickModeWasEnabled := false
	mockClient := new(llmClientMock)
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		quickModeWasEnabled = input.QuickModeEnabled
		return newTestOrchestrator(mockClient)
	}

	execCalled := false
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		execCalled = true
		return "Quick Result", nil, nil
	}
	// Use real finalizeTask but disable DB so it still marks the task completed
	DBQueriesGetter = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("db disabled for test")
	}

	taskID := "quick-mode-task"
	registry := GetRegistry()
	if err := registry.Register(taskID, 4, "quick prompt", "gpt-4", OrchestrateTaskOptions{QuickModeEnabled: true}); err != nil {
		t.Fatalf("failed to register task: %v", err)
	}

	OrchestrateTask(context.Background(), taskID, 4, "quick prompt", "gpt-4", OrchestrateTaskOptions{QuickModeEnabled: true})

	state := registry.Get(taskID)
	if state == nil {
		t.Fatalf("expected task state")
	}
	if state.Status != StatusCompleted {
		t.Fatalf("expected status completed, got %s. Error: %s", state.Status, state.Error)
	}
	if state.Result != "Quick Result" {
		t.Fatalf("expected 'Quick Result', got '%s'", state.Result)
	}
	if !quickModeWasEnabled {
		t.Fatal("expected quickModeEnabled=true to be passed to InitOrchestrator")
	}
	if !execCalled {
		t.Fatal("expected ExecuteOrchestrate to be called")
	}
}

func TestOrchestrateTask_QuickModeAdapterError(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateConfigLayer(t, mockRedis)
	LoadRunUserContext = func(ctx context.Context, input UserContextLoadInput) (RunUserContext, error) {
		return RunUserContext{Memories: nil, DriveClient: nil, ProjectInstructions: "", MemoryEnabled: true, TrustLayerEnabled: false, WebSearchEnabled: true, CodeExecutionEnabled: true, GithubToken: ""}, nil
	}

	mockClient := new(llmClientMock)
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		return newTestOrchestrator(mockClient)
	}
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		return "", nil, errors.New("quick mode request failed")
	}

	taskID := "quick-mode-adapter-error-task"
	registry := GetRegistry()
	_ = registry.Register(taskID, 6, "hello", "openai/gpt-5.6-sol", OrchestrateTaskOptions{QuickModeEnabled: true})

	OrchestrateTask(context.Background(), taskID, 6, "hello", "openai/gpt-5.6-sol", OrchestrateTaskOptions{QuickModeEnabled: true})

	state := registry.Get(taskID)
	if state == nil {
		t.Fatalf("expected task state")
	}
	if state.Status != StatusFailed {
		t.Fatalf("expected status failed, got %s", state.Status)
	}
	if state.Error != "quick mode request failed" {
		t.Fatalf("expected quick mode error, got %q", state.Error)
	}
}

func TestOrchestrateTask_QuickModeIdentityEnforcement(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		return "I am GLM created by Z.ai", nil, nil
	}

	taskID := "quick-identity-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "who are you", "zai/glm-5.2", OrchestrateTaskOptions{QuickModeEnabled: true}))

	OrchestrateTask(context.Background(), taskID, 1, "who are you", "zai/glm-5.2", OrchestrateTaskOptions{QuickModeEnabled: true})

	state := registry.Get(taskID)
	require.NotNil(t, state)
	require.Equal(t, StatusCompleted, state.Status)
	require.Equal(t, sentinelIdentityReply, state.Result)
}

func TestOrchestrateTask_RegisterFailure(t *testing.T) {
	reg := new(mockTaskRegistrar)
	reg.On("Get", "fail-reg").Return(&TaskState{TaskID: "fail-reg", UserID: 1})
	reg.On("MarkStartedWithError", "fail-reg").Return(false, errors.New("reg error"))
	reg.On("Update", mock.Anything, "fail-reg", StatusFailed, mock.Anything, mock.Anything).Return(nil)

	oldReg := GetRegistry()
	SetRegistry(reg)
	defer SetRegistry(oldReg)

	ctx := context.Background()
	OrchestrateTask(ctx, "fail-reg", 1, "p", "m", OrchestrateTaskOptions{})

	reg.AssertExpectations(t)
}

func TestOrchestrateTask_RegistersClientMCPTools(t *testing.T) {
	mockRedis := redis.NewMockClient()
	stubOrchestrateDeps(t, mockRedis)

	var registered bool
	restore(t, &InitOrchestrator)
	InitOrchestrator = func(input OrchestratorInitInput) *orchestrator.TaskOrchestrator {
		orch := newTestOrchestrator(input.LLMAdapter)
		orch.RegisterClientMCPTools("mcp-tools-task", []orchestrator.ClientMCPToolDescriptor{
			{ServerName: "local", ToolName: "search"},
		})
		registered = true
		return orch
	}

	taskID := "mcp-tools-task"
	registry := GetRegistry()
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{
		ClientMCPTools: []ClientMCPTool{{ServerName: "local", ToolName: "search", Title: "Search"}},
	}))

	OrchestrateTask(context.Background(), taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{
		ClientMCPTools: []ClientMCPTool{{ServerName: "local", ToolName: "search", Title: "Search"}},
	})
	assert.True(t, registered)
}
