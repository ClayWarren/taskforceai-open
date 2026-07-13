package run

import (
	"context"
	"errors"
	"io"
	"math"
	"strings"
	"testing"
	"time"

	configpkg "github.com/TaskForceAI/config/pkg"
	"github.com/TaskForceAI/core/pkg/agent"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/memories"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	sharedusage "github.com/TaskForceAI/core/pkg/usage"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func newTestOrchestrator(client agent.ILLMClient) *orchestrator.TaskOrchestrator {
	return orchestrator.New(coreconfig.Config{
		Orchestrator: coreconfig.OrchestratorConfig{
			ParallelAgents: 1,
			TaskTimeout:    60,
		},
	}, orchestrator.OrchestratorDeps{
		Client: client,
	}, orchestrator.OrchestratorOptions{AgentCount: 1})
}

type mockGeminiUploader struct {
	*llmClientMock
}

func (m *mockGeminiUploader) UploadFile(ctx context.Context, reader io.Reader, filename, mimeType string) (string, error) {
	args := m.Called(ctx, reader, filename, mimeType)
	return args.String(0), args.Error(1)
}

func TestApplyComputerUseSessionMode(t *testing.T) {
	unchanged := applyComputerUseSessionMode("existing", false, false)
	if unchanged != "existing" {
		t.Fatalf("expected disabled computer use to leave instructions unchanged")
	}

	loggedOut := applyComputerUseSessionMode("", true, false)
	if !strings.Contains(loggedOut, "Mode: LOGGED OUT") || !strings.Contains(loggedOut, "logged-out browsing context") {
		t.Fatalf("expected logged-out mode instructions, got %q", loggedOut)
	}

	loggedIn := applyComputerUseSessionMode("project instructions", true, true)
	if !strings.Contains(loggedIn, "project instructions\n\n[COMPUTER USE SESSION MODE]") {
		t.Fatalf("expected mode section appended to project instructions, got %q", loggedIn)
	}
	if !strings.Contains(loggedIn, "Mode: LOGGED IN") || !strings.Contains(loggedIn, "authenticated website sessions") {
		t.Fatalf("expected logged-in mode instructions, got %q", loggedIn)
	}
}

func TestApplyComputerUseSessionModeBranches(t *testing.T) {
	base := "base instructions"
	loggedIn := applyComputerUseSessionMode(base, true, true)
	assert.Contains(t, loggedIn, "LOGGED IN")
	assert.Contains(t, loggedIn, base)

	loggedOut := applyComputerUseSessionMode(base, true, false)
	assert.Contains(t, loggedOut, "LOGGED OUT")

	onlyMode := applyComputerUseSessionMode("   ", true, false)
	assert.Contains(t, onlyMode, "COMPUTER USE SESSION MODE")
	assert.NotContains(t, onlyMode, "base")
}

func TestConfigHelperBranches(t *testing.T) {
	originalResolver := ModelSelectionResolver
	originalWebEnvLoader := WebEnvLoader
	t.Cleanup(func() {
		ModelSelectionResolver = originalResolver
		WebEnvLoader = originalWebEnvLoader
	})

	ModelSelectionResolver = func(cfg coreconfig.Config, modelID string) (orchestrator.ModelSelectionResult, error) {
		return orchestrator.ModelSelectionResult{Config: cfg}, nil
	}
	require.NoError(t, validateRoleModels(coreconfig.Config{}, map[string]string{"planner": "   "}))

	WebEnvLoader = func(configpkg.LoadWebEnvOptions) (*configpkg.WebEnv, error) {
		return nil, nil
	}
	webEnv := loadOptionalWebEnv("test")
	require.NotNil(t, webEnv)
	assert.Empty(t, webEnv.AIGatewayAPIKey)
}

func TestAttachmentsToContentParts(t *testing.T) {
	attachments := Attachments{
		Files: []FileAttachment{
			{ID: "f1", Data: []byte("image"), MimeType: "image/jpeg", Name: "img.jpg"},
			{ID: "f2", Data: []byte("audio"), MimeType: "audio/wav", Name: "audio.wav"},
			{ID: "file://video-blob", Data: nil, MimeType: "video/webm", Name: "video.webm"},
			{ID: "file://doc-blob", Data: nil, MimeType: "application/pdf", Name: "doc.pdf"},
		},
	}

	parts := attachmentsToContentParts(attachments)
	if len(parts) != 4 {
		t.Fatalf("expected 4 content parts, got %d", len(parts))
	}
	if parts[0].Type != agent.ContentPartImageURL || parts[0].ImageURL == nil {
		t.Fatalf("expected first part to be image")
	}
	if parts[1].Type != agent.ContentPartInputAudio || parts[1].InputAudio == nil {
		t.Fatalf("expected second part to be audio")
	}
	if parts[2].Type != agent.ContentPartFileData || parts[2].FileData == nil {
		t.Fatalf("expected third part to be file data")
	}
	if parts[3].Type != agent.ContentPartFileData || parts[3].FileData == nil || parts[3].FileData.MimeType != "application/pdf" {
		t.Fatalf("expected fourth part to be document file data")
	}
}

func TestAttachmentsToContentPartsAllMimeFamilies(t *testing.T) {
	parts := attachmentsToContentParts(Attachments{Files: []FileAttachment{
		{ID: "img", MimeType: "image/jpeg", Data: []byte("jpg")},
		{ID: "audio", MimeType: "audio/mp3", Data: []byte("mp3")},
		{ID: "video", MimeType: "video/webm", Data: []byte("webm")},
		{ID: "pdf", MimeType: "application/pdf", Data: []byte("pdf")},
	}})
	require.Len(t, parts, 4)
}

func TestBuildUserMessageWithAttachments(t *testing.T) {
	msg := buildUserMessage("describe this", Attachments{
		Files: []FileAttachment{
			{ID: "img-1", MimeType: "image/png", Name: "diagram.png", Data: []byte("png")},
			{ID: "aud-1", MimeType: "audio/wav", Name: "clip.wav", Data: []byte("wav")},
			{ID: "aud-2", MimeType: "audio/mpeg", Name: "clip.mp3", Data: []byte("mp3")},
			{ID: "file-1", MimeType: "video/mp4", Name: "clip.mp4", Data: []byte("mp4")},
			{ID: "file-2", MimeType: "application/pdf", Name: "doc.pdf", Data: []byte("%PDF")},
		},
	})
	assert.Equal(t, agent.RoleUser, msg.Role)
	require.Len(t, msg.ContentParts, 6)
}

func TestBuildUserMessage_ReturnsPlainMessageWithoutAttachments(t *testing.T) {
	msg := buildUserMessage("hello", Attachments{})
	assert.Equal(t, agent.RoleUser, msg.Role)
	assert.Equal(t, "hello", msg.Content)
	assert.Empty(t, msg.ContentParts)
}

func TestBuildUserMessage_WithAttachments(t *testing.T) {
	attachments := Attachments{
		Files: []FileAttachment{
			{ID: "f1", Data: []byte("fake"), MimeType: "image/png", Name: "img.png"},
			{ID: "f2", Data: []byte("sound"), MimeType: "audio/mp3", Name: "audio.mp3"},
			{ID: "file://video-uri", Data: nil, MimeType: "video/mp4", Name: "video.mp4"},
		},
	}

	msg := buildUserMessage("hello", attachments)

	if msg.Role != agent.RoleUser {
		t.Fatalf("expected user role, got %s", msg.Role)
	}
	if len(msg.ContentParts) != 4 {
		t.Fatalf("expected 4 content parts (text + image + audio + video), got %d", len(msg.ContentParts))
	}
	if msg.ContentParts[0].Type != agent.ContentPartText || msg.ContentParts[0].Text != "hello" {
		t.Fatalf("expected first content part to be prompt text")
	}
	if msg.ContentParts[1].ImageURL == nil || msg.ContentParts[1].ImageURL.URL != "data:image/png;base64,ZmFrZQ==" {
		t.Fatalf("expected image data URI in second content part")
	}
	if msg.ContentParts[2].InputAudio == nil || msg.ContentParts[2].InputAudio.Format != "mp3" {
		t.Fatalf("expected audio content part in third position")
	}
	if msg.ContentParts[3].FileData == nil || msg.ContentParts[3].FileData.FileURI != "file://video-uri" {
		t.Fatalf("expected file data content part in fourth position")
	}
}

func TestCheckLLMCacheDisabledWithoutRedis(t *testing.T) {
	withUnavailableRedis(t, errors.New("redis down"))
	withCacheFactory(t, nil)

	result, cacheInstance, requiresCurrent := checkLLMCache(context.Background(), "task-cache", 1, "latest news?", "gpt")
	assert.Empty(t, result)
	assert.Nil(t, cacheInstance)
	assert.True(t, requiresCurrent)
}

func TestEnforceQuickModeIdentityPromptAndLeakPaths(t *testing.T) {
	assert.Equal(t, sentinelIdentityReply, enforceQuickModeIdentity("who are you", "zai/glm-5.2", "anything"))
	assert.Equal(t, sentinelIdentityReply, enforceQuickModeIdentity("hello", "zai/glm-5.2", "I am GLM created by Z.ai"))
	assert.Equal(t, "plain answer", enforceQuickModeIdentity("hello", "zai/glm-5.2", "plain answer"))
	assert.Equal(t, "other model", enforceQuickModeIdentity("who are you", "openai/gpt-5.6-sol", "other model"))
	assert.Equal(t, "recommendations", enforceQuickModeIdentity("What are your recommendations for the roadmap?", "zai/glm-5.2", "recommendations"))
	assert.Equal(t, "stats answer", enforceQuickModeIdentity("Explain GLM diagnostics for generalized linear models", "zai/glm-5.2", "stats answer"))
}

func TestEnforceQuickModeIdentity_NoopForNonSentinelModel(t *testing.T) {
	original := "I am GPT."
	result := enforceQuickModeIdentity("what model are you?", "openai/gpt-5.6-sol", original)
	if result != original {
		t.Fatalf("expected unchanged result for non-sentinel model, got %q", result)
	}
}

func TestEnforceQuickModeIdentity_RewritesIdentityQuestion(t *testing.T) {
	result := enforceQuickModeIdentity(
		"what model are you?",
		"zai/glm-5.2",
		"I am GLM, an AI assistant created by Z.ai.",
	)
	if result != sentinelIdentityReply {
		t.Fatalf("expected sentinel identity reply, got %q", result)
	}
}

func TestEnforceQuickModeIdentity_RewritesProviderLeakWithoutIdentityPrompt(t *testing.T) {
	result := enforceQuickModeIdentity(
		"hello",
		"zai/glm-5.2",
		"I am GLM, an AI assistant created by Z.ai.",
	)
	if result != sentinelIdentityReply {
		t.Fatalf("expected sentinel identity reply, got %q", result)
	}
}

func TestExecutePulseOrchestration_NilOrchestratorWithTrustLayer(t *testing.T) {
	result, trace, err := executePulseOrchestration(
		context.Background(),
		nil,
		"prompt",
		"task-1",
		1,
		true,
	)
	if err == nil {
		t.Fatal("expected nil orchestrator error")
	}
	if !strings.Contains(err.Error(), "orchestrator is nil") {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "" {
		t.Fatalf("expected empty result on error, got %q", result)
	}
	if trace != nil {
		t.Fatal("expected nil trace on error")
	}
}

func TestExecutePulseOrchestration_NilOrchestratorWithoutTrustLayer(t *testing.T) {
	result, trace, err := executePulseOrchestration(
		context.Background(),
		nil,
		"prompt",
		"task-1",
		1,
		false,
	)
	if err == nil {
		t.Fatal("expected nil orchestrator error")
	}
	if !strings.Contains(err.Error(), "orchestrator is nil") {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "" {
		t.Fatalf("expected empty result on error, got %q", result)
	}
	if trace != nil {
		t.Fatal("expected nil trace on error")
	}
}

func TestExecutePulseOrchestration_NonTrustLayerUsesInjectedExecutor(t *testing.T) {
	restore(t, &ExecuteOrchestrate)

	called := false
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		called = true
		return "ok", nil, nil
	}

	result, trace, err := executePulseOrchestration(context.Background(), &orchestrator.TaskOrchestrator{}, "prompt", "task-1", 1, false)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !called {
		t.Fatal("expected non-trust-layer executor to be called")
	}
	if result != "ok" {
		t.Fatalf("unexpected result: %q", result)
	}
	if trace != nil {
		t.Fatal("expected nil trace")
	}
}

func TestExecutePulseOrchestration_TrustLayerUsesInjectedExecutor(t *testing.T) {
	restore(t, &ExecuteOrchestrateWithTask)

	called := false
	ExecuteOrchestrateWithTask = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt, taskID string, userID *int32) (string, *orchestrator.OrchestrationTrace, error) {
		called = true
		if userID == nil || *userID != 42 {
			t.Fatalf("unexpected user id pointer: %+v", userID)
		}
		return "ok", nil, nil
	}

	result, trace, err := executePulseOrchestration(context.Background(), &orchestrator.TaskOrchestrator{}, "prompt", "task-1", 42, true)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !called {
		t.Fatal("expected trust-layer executor to be called")
	}
	if result != "ok" {
		t.Fatalf("unexpected result: %q", result)
	}
	if trace != nil {
		t.Fatal("expected nil trace")
	}
}

func TestOrchestrateTaskRunnerExecuteRegistersCallbacks(t *testing.T) {
	restore(t, &ExecuteOrchestrate)
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		return "ok", nil, nil
	}

	callbackRegistry := new(mockTaskRegistrar)
	callbackRegistry.On("UpdateProgress", "runner-callbacks", mock.Anything, nil, mock.Anything).Return(nil).Once()
	callbackRegistry.On("UpdateProgress", "runner-callbacks", nil, mock.Anything, mock.Anything).Return(nil).Once()
	orch := orchestrator.New(coreconfig.Config{}, orchestrator.OrchestratorDeps{}, orchestrator.OrchestratorOptions{})
	runner := &orchestrateTaskRunner{
		taskID:   "runner-callbacks",
		userID:   7,
		prompt:   "prompt",
		modelID:  "gpt-4",
		registry: callbackRegistry,
	}
	prep := &orchestrationPreparation{
		orch:        orch,
		userContext: RunUserContext{},
	}
	runner.progressUpdateHandler(prep)([]orchestrator.AgentStatusSnapshot{{Status: orchestrator.StatusProcessing}})
	runner.toolUsageUpdateHandler(context.Background(), prep)(agent.ToolEvent{}, []agent.ToolEvent{{ToolName: "search"}})
	callbackRegistry.AssertExpectations(t)

	runner.registry = &delegatingRegistrar{inner: GetRegistry()}
	result, trace, completed := runner.execute(context.Background(), prep)
	require.True(t, completed)
	assert.Equal(t, "ok", result)
	assert.Nil(t, trace)
}

func TestExecutePulseOrchestration_UserIDOutOfRange(t *testing.T) {
	result, trace, err := executePulseOrchestration(
		context.Background(),
		nil,
		"prompt",
		"task-1",
		int(math.MaxInt32)+1,
		true,
	)
	if err == nil {
		t.Fatal("expected out-of-range error")
	}
	if result != "" {
		t.Fatalf("expected empty result on error, got %q", result)
	}
	if trace != nil {
		t.Fatal("expected nil trace on error")
	}
}

func TestExecutePulseOrchestration_UserIDOutOfRangeWithOrchestrator(t *testing.T) {
	result, trace, err := executePulseOrchestration(
		context.Background(),
		&orchestrator.TaskOrchestrator{},
		"prompt",
		"task-1",
		int(math.MaxInt32)+1,
		true,
	)
	require.Error(t, err)
	assert.Empty(t, result)
	assert.Nil(t, trace)
}

func TestFetchAttachmentsInvalidJSONIgnored(t *testing.T) {
	mockRedis := withMockRedis(t)

	require.NoError(t, mockRedis.Set(context.Background(), AttachmentKeyPrefix+"bad-json", []byte("{"), time.Minute))
	attachments, err := fetchAttachments(context.Background(), "bad-json")
	require.NoError(t, err)
	assert.Empty(t, attachments.Files)
}

func TestFetchAttachmentsRedisUnavailableReturnsEmpty(t *testing.T) {
	withUnavailableRedis(t, errors.New("redis offline"))

	attachments, err := fetchAttachments(context.Background(), "no-redis-task")
	require.NoError(t, err)
	assert.Empty(t, attachments.Files)
}

func TestFetchAttachments_InvalidJSON(t *testing.T) {
	mockRedis := withMockRedis(t)

	taskID := "attachments-invalid-json"
	key := AttachmentKeyPrefix + taskID
	if err := mockRedis.Set(context.Background(), key, []byte("{invalid-json"), time.Minute); err != nil {
		t.Fatalf("failed to seed invalid attachment cache: %v", err)
	}

	attachments, err := fetchAttachments(context.Background(), taskID)
	if err != nil {
		t.Fatalf("expected invalid json to return empty attachments without error, got %v", err)
	}
	if len(attachments.Files) != 0 {
		t.Fatalf("expected empty attachments on invalid payload")
	}
	if _, err := mockRedis.Get(context.Background(), key); err != nil {
		t.Fatalf("expected invalid payload to remain in cache for inspection: %v", err)
	}
}

func TestFetchAttachments_MissingBlobDataReturnsError(t *testing.T) {
	mockRedis := withMockRedis(t)

	taskID := "attachments-missing-blob"
	key := AttachmentKeyPrefix + taskID
	payload := `{"files":[{"id":"missing-file","mime_type":"image/png","name":"test.png","size":10}]}`
	if err := mockRedis.Set(context.Background(), key, []byte(payload), time.Minute); err != nil {
		t.Fatalf("failed to seed attachment cache: %v", err)
	}

	attachments, err := fetchAttachments(context.Background(), taskID)
	if err == nil {
		t.Fatalf("expected missing blob data error")
	}
	if len(attachments.Files) != 0 {
		t.Fatalf("expected no attachments when blob data is missing")
	}
}

func TestFetchAttachments_RedisGetErrorLogsAndContinues(t *testing.T) {
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return &redisGetFailClient{}, nil })

	attachments, err := fetchAttachments(context.Background(), "redis-get-err")
	require.NoError(t, err)
	assert.Empty(t, attachments.Files)
}

func TestFetchAttachments_SuccessAndRetainsDataForRetry(t *testing.T) {
	mockRedis := withMockRedis(t)

	taskID := "attachments-task"
	key := AttachmentKeyPrefix + taskID
	fileID := "file-123"
	payload := `{"files":[{"id":"file-123","mime_type":"image/png","name":"test.png","size":10}]}`
	if err := mockRedis.Set(context.Background(), key, []byte(payload), time.Minute); err != nil {
		t.Fatalf("failed to seed attachment cache: %v", err)
	}
	if err := mockRedis.Set(context.Background(), AttachmentMetaKeyPrefix+fileID, []byte("fake-data"), time.Minute); err != nil {
		t.Fatalf("failed to seed binary data: %v", err)
	}

	attachments, err := fetchAttachments(context.Background(), taskID)
	if err != nil {
		t.Fatalf("expected fetch success, got %v", err)
	}
	if len(attachments.Files) != 1 {
		t.Fatalf("unexpected attachment counts: files=%d", len(attachments.Files))
	}
	if string(attachments.Files[0].Data) != "fake-data" {
		t.Errorf("expected data fake-data, got %s", string(attachments.Files[0].Data))
	}

	// The key and blob should remain available so a retry/recovery attempt can
	// re-hydrate the same attachment set for the same task ID.
	if _, err := mockRedis.Get(context.Background(), key); err != nil {
		t.Fatalf("expected attachment cache key to be retained for retry, got %v", err)
	}
	if _, err := mockRedis.Get(context.Background(), AttachmentMetaKeyPrefix+fileID); err != nil {
		t.Fatalf("expected attachment blob key to be retained for retry, got %v", err)
	}

	attachmentsRetry, retryErr := fetchAttachments(context.Background(), taskID)
	if retryErr != nil {
		t.Fatalf("expected second fetch success for retry, got %v", retryErr)
	}
	if len(attachmentsRetry.Files) != 1 {
		t.Fatalf("expected one attachment on retry fetch, got %d", len(attachmentsRetry.Files))
	}
	if string(attachmentsRetry.Files[0].Data) != "fake-data" {
		t.Errorf("expected retry data fake-data, got %s", string(attachmentsRetry.Files[0].Data))
	}
}

func TestFinalizeTask_CacheSaveFailureAppendsError(t *testing.T) {
	mockCache := new(cacheMock)
	mockCache.On("Set", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(errors.New("cache write failed"))

	taskID := "finalize-cache-fail"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	originalRunner := RunTaskPersistenceTx
	RunTaskPersistenceTx = func(ctx context.Context, fn func(store taskPersistenceStore) error) error {
		return nil
	}
	t.Cleanup(func() { RunTaskPersistenceTx = originalRunner })

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		mockCache,
		false,
		false,
		OrchestrateTaskOptions{},
		"",
	)

	state := GetRegistry().Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCompleted, state.Status)
	assert.Contains(t, state.Error, "cache save failed")
}

func TestFinalizeTask_MemoryStoreLoadFailureIsNonFatal(t *testing.T) {
	taskID := "finalize-mem-store-fail"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	originalStore := LoadMemoryStore
	LoadMemoryStore = func(ctx context.Context) (memories.MemoryStore, error) {
		return nil, errors.New("memory store unavailable")
	}
	t.Cleanup(func() { LoadMemoryStore = originalStore })

	originalRunner := RunTaskPersistenceTx
	RunTaskPersistenceTx = func(ctx context.Context, fn func(store taskPersistenceStore) error) error {
		return nil
	}
	t.Cleanup(func() { RunTaskPersistenceTx = originalRunner })

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		false,
		true,
		OrchestrateTaskOptions{},
		"",
	)

	state := GetRegistry().Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCompleted, state.Status)
}

func TestFinalizeTask_NoRetentionUpdateFailure(t *testing.T) {
	taskID := "finalize-no-retention-update-fail"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	originalRegistry := defaultRegistry
	inner := GetRegistry()
	SetRegistry(&delegatingRegistrar{
		inner: inner,
		updateWithConversation: func(context.Context, string, TaskStatus, string, string, int32, string) error {
			return errors.New("persist final state failed")
		},
	})
	t.Cleanup(func() { SetRegistry(originalRegistry) })
	restore(t, &RunTaskPersistenceTx)
	RunTaskPersistenceTx = func(ctx context.Context, fn func(taskPersistenceStore) error) error {
		require.NoError(t, fn(&stubTaskPersistenceStore{}))
		return errors.New("usage transaction failed")
	}

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		false,
		false,
		OrchestrateTaskOptions{NoTraining: true},
		"trace-1",
	)
}

func TestFinalizeTask_TraceMarshalFailure(t *testing.T) {
	taskID := "finalize-trace-marshal-fail"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	originalMarshal := marshalOrchestrationTrace
	marshalOrchestrationTrace = func(v any) ([]byte, error) {
		return nil, errors.New("marshal failed")
	}
	t.Cleanup(func() { marshalOrchestrationTrace = originalMarshal })

	originalRunner := RunTaskPersistenceTx
	RunTaskPersistenceTx = func(ctx context.Context, fn func(store taskPersistenceStore) error) error {
		return fn(&stubTaskPersistenceStore{
			createConversationFunc: func(ctx context.Context, input taskConversationCreateInput) (taskConversationRecord, error) {
				return taskConversationRecord{ID: 99}, nil
			},
		})
	}
	t.Cleanup(func() { RunTaskPersistenceTx = originalRunner })

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		&orchestrator.OrchestrationTrace{OriginalQuery: "q"},
		coreconfig.Config{},
		nil,
		false,
		false,
		OrchestrateTaskOptions{},
		"",
	)

	state := GetRegistry().Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCompleted, state.Status)
}

func TestFinalizeTaskMetadataMarshalWarningAndMessageFailure(t *testing.T) {
	taskID := "finalize-metadata-message-fail"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))
	originalRegistry := defaultRegistry
	inner := GetRegistry()
	SetRegistry(&delegatingRegistrar{
		inner: inner,
		get: func(id string) *TaskState {
			if id == taskID {
				return &TaskState{TaskID: taskID, UserID: 1, Status: StatusProcessing, ToolEvents: []any{func() {}}}
			}
			return inner.Get(id)
		},
	})
	t.Cleanup(func() { SetRegistry(originalRegistry) })

	originalRunner := RunTaskPersistenceTx
	RunTaskPersistenceTx = func(ctx context.Context, fn func(store taskPersistenceStore) error) error {
		return fn(&stubTaskPersistenceStore{
			createConversationFunc: func(ctx context.Context, input taskConversationCreateInput) (taskConversationRecord, error) {
				return taskConversationRecord{ID: 99}, nil
			},
			createMessageFunc: func(ctx context.Context, input taskMessageCreateInput) error {
				return errors.New("message failed")
			},
		})
	}
	t.Cleanup(func() { RunTaskPersistenceTx = originalRunner })

	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		false,
		false,
		OrchestrateTaskOptions{},
		"",
	)
}

func TestRecordTaskUsagePersistsTraceUsage(t *testing.T) {
	orgID := int32(12)
	agentID := 3
	tokenUsageCalled := false
	toolUsageCalled := false
	store := &stubTaskPersistenceStore{
		createTokenUsageFunc: func(_ context.Context, rows []sharedusage.TokenUsageRow) error {
			tokenUsageCalled = true
			require.Len(t, rows, 1)
			row := rows[0]
			assert.Equal(t, "task-1", row.TaskID)
			require.NotNil(t, row.ConversationID)
			assert.Equal(t, 44, *row.ConversationID)
			require.NotNil(t, row.UserID)
			assert.Equal(t, "7", *row.UserID)
			require.NotNil(t, row.OrganizationID)
			assert.Equal(t, int(orgID), *row.OrganizationID)
			require.NotNil(t, row.Plan)
			assert.Equal(t, "pro", *row.Plan)
			assert.Equal(t, "xai/grok-4.5", row.Model)
			assert.Equal(t, "synthesis", row.Stage)
			assert.Equal(t, 1000, row.PromptTokens)
			assert.Equal(t, 100, row.CompletionTokens)
			assert.Equal(t, 1100, row.TotalTokens)
			assert.NotEmpty(t, row.Metadata)
			return nil
		},
		createToolUsageFunc: func(_ context.Context, rows []sharedusage.ToolUsageRow) error {
			toolUsageCalled = true
			require.Len(t, rows, 1)
			row := rows[0]
			assert.Equal(t, "task-1", row.TaskID)
			assert.Equal(t, "web_search", row.ToolName)
			assert.True(t, row.Success)
			assert.Equal(t, 250, row.DurationMs)
			require.NotNil(t, row.Metadata.AgentID)
			assert.Equal(t, "3", *row.Metadata.AgentID)
			require.NotNil(t, row.Metadata.AgentLabel)
			assert.Equal(t, "Research", *row.Metadata.AgentLabel)
			require.NotNil(t, row.Metadata.ResultPreview)
			assert.Equal(t, "done", *row.Metadata.ResultPreview)
			return nil
		},
	}

	conversationID := int32(44)
	recordTaskUsage(context.Background(), store, "task-1", &conversationID, 7, "model", "prompt", OrchestrateTaskOptions{
		UserPlan: " pro ",
		OrgID:    &orgID,
	}, &orchestrator.OrchestrationTrace{
		TokenUsage: []orchestrator.TokenUsageRecord{{
			Model:            "xai/grok-4.5",
			Stage:            "synthesis",
			PromptTokens:     1000,
			CompletionTokens: 100,
			TotalTokens:      1100,
			CachedTokens:     400,
		}},
		ToolUsage: []agent.ToolEvent{{
			ToolName:      "web_search",
			Status:        "completed",
			DurationMs:    250,
			AgentID:       &agentID,
			AgentLabel:    "Research",
			ResultPreview: "done",
		}},
	})

	assert.True(t, tokenUsageCalled)
	assert.True(t, toolUsageCalled)
}
