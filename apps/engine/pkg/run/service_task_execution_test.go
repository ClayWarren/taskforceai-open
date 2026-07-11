package run

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	corecache "github.com/TaskForceAI/core/pkg/cache"
	coreconfig "github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	sharedusage "github.com/TaskForceAI/core/pkg/usage"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	miniredis "github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestRecordTaskUsageHandlesNilAndRecorderErrors(t *testing.T) {
	conversationID := int32(44)
	recordTaskUsage(context.Background(), nil, "task-1", &conversationID, 7, OrchestrateTaskOptions{}, &orchestrator.OrchestrationTrace{})
	recordTaskUsage(context.Background(), &stubTaskPersistenceStore{}, "task-1", &conversationID, 7, OrchestrateTaskOptions{}, nil)

	tokenUsageCalled := false
	toolUsageCalled := false
	store := &stubTaskPersistenceStore{
		createTokenUsageFunc: func(_ context.Context, rows []sharedusage.TokenUsageRow) error {
			tokenUsageCalled = true
			require.Len(t, rows, 1)
			return errors.New("token usage failed")
		},
		createToolUsageFunc: func(_ context.Context, rows []sharedusage.ToolUsageRow) error {
			toolUsageCalled = true
			require.Len(t, rows, 1)
			row := rows[0]
			assert.Equal(t, "failing_tool", row.ToolName)
			assert.False(t, row.Success)
			require.NotNil(t, row.Error)
			assert.Equal(t, "boom", *row.Error)
			return errors.New("tool usage failed")
		},
	}

	recordTaskUsage(context.Background(), store, "task-1", &conversationID, 7, OrchestrateTaskOptions{}, &orchestrator.OrchestrationTrace{
		TokenUsage: []orchestrator.TokenUsageRecord{{
			Model:            "unknown",
			Stage:            "planning",
			PromptTokens:     1,
			CompletionTokens: 2,
			TotalTokens:      3,
		}},
		ToolUsage: []agent.ToolEvent{{
			ToolName: "   ",
		}, {
			ToolName:   "failing_tool",
			Status:     "failed",
			DurationMs: 10,
			Error:      "boom",
		}},
	})

	assert.True(t, tokenUsageCalled)
	assert.True(t, toolUsageCalled)
}

func TestBuildMessageMetadataSourceFallbacksAndMarshalError(t *testing.T) {
	sourcesData, toolEventsData, statusesData, err := buildMessageMetadata(nil)
	require.NoError(t, err)
	assert.Nil(t, sourcesData)
	assert.Nil(t, toolEventsData)
	assert.Nil(t, statusesData)

	sourcesData, toolEventsData, statusesData, err = buildMessageMetadata(&TaskState{
		ToolEvents: []any{
			map[string]any{
				"sources": []any{
					map[string]any{"url": "https://example.com/a", "title": "A", "snippet": "first"},
					map[string]any{"url": "https://example.com/a", "title": "duplicate"},
					map[string]any{"title": "missing url"},
					"ignored",
				},
			},
			map[string]any{
				"sources": []map[string]string{{"url": "https://example.com/b", "title": "B"}},
			},
		},
		AgentStatuses: []any{map[string]any{"status": "done"}},
	})
	require.NoError(t, err)
	assert.JSONEq(t, `[{"url":"https://example.com/a","title":"A","snippet":"first"},{"url":"https://example.com/b","title":"B"}]`, string(sourcesData))
	assert.Contains(t, string(toolEventsData), `"sources"`)
	assert.JSONEq(t, `[{"status":"done"}]`, string(statusesData))

	sourcesData, toolEventsData, statusesData, err = buildMessageMetadata(&TaskState{
		ToolEvents:    []any{func() {}},
		AgentStatuses: []any{func() {}},
	})
	require.Error(t, err)
	assert.Equal(t, []byte("null"), sourcesData)
	assert.Nil(t, toolEventsData)
	assert.Nil(t, statusesData)
}

func TestSourceExtractionHelpers(t *testing.T) {
	assert.Nil(t, extractSourcesFromToolEventsData(nil))
	assert.Nil(t, extractSourcesFromToolEventsData([]byte(`{`)))

	sources := extractSourcesFromToolEventsData([]byte(`[
		{"sources":[{"url":"https://example.com/a","title":"A"},{"url":"","title":"missing"},{"url":"https://example.com/a","title":"duplicate"}]},
		{"sources":[{"url":"https://example.com/b","snippet":"B"}]}
	]`))
	require.Len(t, sources, 2)
	assert.Equal(t, "https://example.com/a", sources[0].URL)

	sources, ok := extractSourcesFromToolEvents(nil)
	require.True(t, ok)
	assert.Nil(t, sources)

	sources = extractSourcesFromMapEvents([]map[string]any{
		{"sources": []map[string]any{{"url": "https://example.com/map", "title": "Map"}}},
		{"other": true},
	})
	require.Len(t, sources, 1)
	assert.Equal(t, "Map", sources[0].Title)

	sources, ok = extractSourcesFromAnyMapEvents([]any{map[string]any{"sources": []map[string]any{{"url": "https://example.com/any"}}}})
	require.True(t, ok)
	require.Len(t, sources, 1)

	sources, ok = extractSourcesFromAnyMapEvents([]any{map[string]any{"other": true}})
	require.True(t, ok)
	assert.Empty(t, sources)

	sources, ok = extractSourcesFromAnyMapEvents([]any{"bad"})
	require.False(t, ok)
	assert.Nil(t, sources)

	sources, ok = extractSourcesFromToolEvents("unsupported")
	require.False(t, ok)
	assert.Nil(t, sources)

	seen := map[string]struct{}{}
	sources = appendSourcesFromValue(nil, seen, []map[string]string{{"url": "https://example.com/string", "title": "String"}})
	sources = appendSourcesFromValue(sources, seen, []map[string]any{{"url": "https://example.com/any", "title": "Any"}})
	sources = appendSourcesFromValue(sources, seen, []any{map[string]any{"url": "https://example.com/slice", "snippet": "Slice"}, "ignored"})
	sources = appendSourcesFromValue(sources, seen, "unsupported")
	require.Len(t, sources, 3)
	assert.Empty(t, stringMapValue(map[string]any{"url": 10}, "url"))

	sources = appendSourceReference(sources, seen, "", "missing", "")
	sources = appendSourceReference(sources, seen, "https://example.com/string", "duplicate", "")
	assert.Len(t, sources, 3)
}

func TestFinalizeTaskSkipsCacheAndMemoryForSpecialModes(t *testing.T) {
	originalRunner := RunTaskPersistenceTx
	RunTaskPersistenceTx = func(ctx context.Context, fn func(store taskPersistenceStore) error) error {
		return fn(&stubTaskPersistenceStore{
			createConversationFunc: func(ctx context.Context, input taskConversationCreateInput) (taskConversationRecord, error) {
				return taskConversationRecord{ID: 55}, nil
			},
		})
	}
	t.Cleanup(func() { RunTaskPersistenceTx = originalRunner })

	taskID := "finalize-computer-use-cache-skip"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))
	finalizeTask(
		context.Background(),
		taskID,
		1,
		"prompt",
		"gpt-4",
		"result",
		nil,
		coreconfig.Config{},
		&cacheMock{},
		false,
		false,
		OrchestrateTaskOptions{ComputerUseEnabled: true},
		"",
	)

	mediaTaskID := "finalize-media-memory-skip"
	require.NoError(t, GetRegistry().Register(mediaTaskID, 1, "prompt", "xai/grok-imagine-video-1.5", OrchestrateTaskOptions{}))
	finalizeTask(
		context.Background(),
		mediaTaskID,
		1,
		"prompt",
		"xai/grok-imagine-video-1.5",
		"result",
		nil,
		coreconfig.Config{},
		nil,
		false,
		true,
		OrchestrateTaskOptions{},
		"",
	)
}

func TestFinalizeTaskRecordsUsageWithoutResultPersistenceForCanceledTask(t *testing.T) {
	redis.SetClient(redis.NewMockClient())
	taskID := "finalize-canceled"
	require.NoError(t, GetRegistry().Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))
	require.NoError(t, GetRegistry().Update(context.Background(), taskID, StatusCanceled, "", "Run canceled"))

	originalRunner := RunTaskPersistenceTx
	conversationCalled := false
	messageCalled := false
	tokenUsageCalled := false
	toolUsageCalled := false
	store := &stubTaskPersistenceStore{
		createConversationFunc: func(context.Context, taskConversationCreateInput) (taskConversationRecord, error) {
			conversationCalled = true
			return taskConversationRecord{}, nil
		},
		createMessageFunc: func(context.Context, taskMessageCreateInput) error {
			messageCalled = true
			return nil
		},
		createTokenUsageFunc: func(ctx context.Context, rows []sharedusage.TokenUsageRow) error {
			tokenUsageCalled = true
			require.NoError(t, ctx.Err())
			require.Len(t, rows, 1)
			assert.Equal(t, taskID, rows[0].TaskID)
			assert.Nil(t, rows[0].ConversationID)
			return nil
		},
		createToolUsageFunc: func(ctx context.Context, rows []sharedusage.ToolUsageRow) error {
			toolUsageCalled = true
			require.NoError(t, ctx.Err())
			require.Len(t, rows, 1)
			assert.Equal(t, taskID, rows[0].TaskID)
			assert.Nil(t, rows[0].ConversationID)
			return nil
		},
	}
	RunTaskPersistenceTx = func(ctx context.Context, fn func(store taskPersistenceStore) error) error {
		require.NoError(t, ctx.Err())
		return fn(store)
	}
	t.Cleanup(func() { RunTaskPersistenceTx = originalRunner })

	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	finalizeTask(canceledCtx, taskID, 1, "prompt", "gpt-4", "result", &orchestrator.OrchestrationTrace{
		TokenUsage: []orchestrator.TokenUsageRecord{{
			Model:            "gpt-4",
			PromptTokens:     10,
			CompletionTokens: 5,
			TotalTokens:      15,
		}},
		ToolUsage: []agent.ToolEvent{{
			ToolName: "web_search",
			Status:   "completed",
		}},
	}, coreconfig.Config{}, nil, false, true, OrchestrateTaskOptions{}, "")
	assert.False(t, conversationCalled)
	assert.False(t, messageCalled)
	assert.True(t, tokenUsageCalled)
	assert.True(t, toolUsageCalled)
	state := GetRegistry().Get(taskID)
	require.NotNil(t, state)
	assert.Equal(t, StatusCanceled, state.Status)
	assert.Empty(t, state.Result)
}

func TestRecordCanceledTaskUsageHandlesMissingTraceAndTransactionFailure(t *testing.T) {
	originalRunner := RunTaskPersistenceTx
	transactionCalls := 0
	RunTaskPersistenceTx = func(context.Context, func(store taskPersistenceStore) error) error {
		transactionCalls++
		return errors.New("database unavailable")
	}
	t.Cleanup(func() { RunTaskPersistenceTx = originalRunner })

	recordCanceledTaskUsage(context.Background(), "task-canceled", 1, OrchestrateTaskOptions{}, nil)
	assert.Zero(t, transactionCalls)

	recordCanceledTaskUsage(context.Background(), "task-canceled", 1, OrchestrateTaskOptions{}, &orchestrator.OrchestrationTrace{})
	assert.Equal(t, 1, transactionCalls)
}

func TestGetCacheInstanceUsesCacheFactory(t *testing.T) {
	mockRedis := withMockRedis(t)
	mockCache := new(cacheMock)
	withCacheFactory(t, func(client redis.Cmdable) corecache.ICache {
		assert.Equal(t, mockRedis, client)
		return mockCache
	})

	assert.Equal(t, mockCache, getCacheInstance())
}

func TestExecuteDirectMediaGeneration(t *testing.T) {
	client := new(llmClientMock)
	client.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(params agent.ChatCompletionCreateParams) bool {
		return params.Model == "xai/grok-imagine-video-1.5" &&
			len(params.Messages) == 1 &&
			params.Messages[0].Role == agent.RoleUser &&
			params.Messages[0].Content == "make a short clip"
	})).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{
			Message: agent.ChatCompletionMessage{
				Role:    agent.RoleAssistant,
				Content: `<video controls><source src="https://example.test/generated.mp4" type="video/mp4"></video>`,
			},
		}},
	}, nil).Once()

	result, err := executeDirectMediaGeneration(context.Background(), mediaGenerationInput{
		Adapter: client,
		ModelID: "xai/grok-imagine-video-1.5",
		Prompt:  "make a short clip",
	})

	require.NoError(t, err)
	assert.Contains(t, result, "generated.mp4")
	client.AssertExpectations(t)
	client.AssertNotCalled(t, "CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything)
}

func TestExecuteDirectMediaGenerationRejectsEmptyResult(t *testing.T) {
	client := new(llmClientMock)
	client.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "   "}}},
	}, nil).Once()

	result, err := executeDirectMediaGeneration(context.Background(), mediaGenerationInput{
		Adapter: client,
		ModelID: "google/gemini-2.5-flash-image",
		Prompt:  "draw a diagram",
	})

	require.Error(t, err)
	assert.Empty(t, result)
	assert.Contains(t, err.Error(), "empty result")
	client.AssertExpectations(t)
}

func TestExecuteDirectMediaGenerationBranches(t *testing.T) {
	result, err := executeDirectMediaGeneration(context.Background(), mediaGenerationInput{
		Prompt: "draw",
	})
	require.Error(t, err)
	assert.Empty(t, result)
	assert.Contains(t, err.Error(), "adapter is nil")

	errorClient := new(llmClientMock)
	errorClient.On("CreateChatCompletion", mock.Anything, mock.Anything).
		Return((*agent.ChatCompletion)(nil), errors.New("llm failed")).Once()
	result, err = executeDirectMediaGeneration(context.Background(), mediaGenerationInput{
		Adapter: errorClient,
		ModelID: "media-model",
		Prompt:  "draw",
	})
	require.EqualError(t, err, "llm failed")
	assert.Empty(t, result)
	errorClient.AssertExpectations(t)

	noChoicesClient := new(llmClientMock)
	noChoicesClient.On("CreateChatCompletion", mock.Anything, mock.Anything).
		Return(&agent.ChatCompletion{}, nil).Once()
	result, err = executeDirectMediaGeneration(context.Background(), mediaGenerationInput{
		Adapter: noChoicesClient,
		ModelID: "media-model",
		Prompt:  "draw",
	})
	require.ErrorContains(t, err, "no choices")
	assert.Empty(t, result)
	noChoicesClient.AssertExpectations(t)

	attachmentClient := new(llmClientMock)
	attachmentClient.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(params agent.ChatCompletionCreateParams) bool {
		return len(params.Messages) == 1 && len(params.Messages[0].ContentParts) > 0
	})).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{
			Message: agent.ChatCompletionMessage{Content: " image ready "},
		}},
	}, nil).Once()
	result, err = executeDirectMediaGeneration(context.Background(), mediaGenerationInput{
		Adapter:        attachmentClient,
		ModelID:        "media-model",
		Prompt:         "draw",
		HasAttachments: true,
		Attachments: Attachments{Files: []FileAttachment{{
			ID:       "file-1",
			Data:     []byte("image"),
			MimeType: "image/png",
			Name:     "image.png",
		}}},
	})
	require.NoError(t, err)
	assert.Equal(t, "image ready", result)
	attachmentClient.AssertExpectations(t)
}

func TestOrchestrateTaskRunnerSetTaskStatusDetachesCanceledContext(t *testing.T) {
	registry := new(mockTaskRegistrar)
	runner := newOrchestrateTaskRunner("task-canceled", 7, "prompt", "model", OrchestrateTaskOptions{}, registry)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	registry.On("Update",
		mock.MatchedBy(func(ctx context.Context) bool { return ctx.Err() == nil }),
		"task-canceled",
		StatusCanceled,
		"",
		"Run canceled",
	).Return(nil).Once()

	runner.setTaskStatus(ctx, StatusCanceled, "", "Run canceled")

	registry.AssertExpectations(t)
}

type mockTaskRegistrar struct {
	TaskRegistrar
	mock.Mock
}

func (m *mockTaskRegistrar) Get(id string) *TaskState {
	ret := m.Called(id).Get(0)
	if ret == nil {
		return nil
	}
	state, ok := ret.(*TaskState)
	if !ok {
		return nil
	}
	return state
}
func (m *mockTaskRegistrar) MarkStartedWithError(id string) (bool, error) {
	args := m.Called(id)
	return args.Bool(0), args.Error(1)
}
func (m *mockTaskRegistrar) Update(ctx context.Context, id string, status TaskStatus, res, err string) error {
	return m.Called(ctx, id, status, res, err).Error(0)
}

func (m *mockTaskRegistrar) Heartbeat(ctx context.Context, id string) error {
	return m.Called(ctx, id).Error(0)
}

func (m *mockTaskRegistrar) UpdateProgress(id string, agentStatuses, toolEvents any, budgetUsage *BudgetUsage) error {
	return m.Called(id, agentStatuses, toolEvents, budgetUsage).Error(0)
}

func (m *mockTaskRegistrar) Register(id string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) error {
	return m.Called(id, userID, prompt, modelID, opts).Error(0)
}

func (m *mockTaskRegistrar) MarkStarted(id string) bool {
	return m.Called(id).Bool(0)
}

func (m *mockTaskRegistrar) UpdateWithConversation(ctx context.Context, id string, status TaskStatus, res, err string, conversationID int32, traceID string) error {
	return m.Called(ctx, id, status, res, err, conversationID, traceID).Error(0)
}

func (m *mockTaskRegistrar) UpdateWithApproval(ctx context.Context, id string, approval *PendingApproval) error {
	return m.Called(ctx, id, approval).Error(0)
}

func (m *mockTaskRegistrar) ClearApproval(ctx context.Context, id string) error {
	return m.Called(ctx, id).Error(0)
}

func TestUpdateTaskStatusWithLockRetryRetriesLockContention(t *testing.T) {
	registry := new(mockTaskRegistrar)
	lockErr := errors.New("failed to acquire update lock")

	registry.On("Update", mock.Anything, "retry-task", StatusCompleted, "done", "").Return(lockErr).Once()
	registry.On("Update", mock.Anything, "retry-task", StatusCompleted, "done", "").Return(lockErr).Once()
	registry.On("Update", mock.Anything, "retry-task", StatusCompleted, "done", "").Return(nil).Once()

	err := updateTaskStatusWithLockRetry(context.Background(), registry, "retry-task", StatusCompleted, "done", "")

	require.NoError(t, err)
	registry.AssertExpectations(t)
}

func TestUpdateTaskStatusWithLockRetryStopsWhenContextCanceled(t *testing.T) {
	registry := new(mockTaskRegistrar)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	registry.On("Update", mock.Anything, "cancel-task", StatusCompleted, "done", "").Return(errors.New("failed to acquire update lock")).Once()

	err := updateTaskStatusWithLockRetry(ctx, registry, "cancel-task", StatusCompleted, "done", "")

	require.ErrorIs(t, err, context.Canceled)
	registry.AssertExpectations(t)
}

func TestUpdateTaskStatusWithLockRetryReturnsLastLockError(t *testing.T) {
	registry := new(mockTaskRegistrar)
	lockErr := errors.New("failed to acquire update lock")

	registry.On("Update", mock.Anything, "last-lock-task", StatusCompleted, "done", "").Return(lockErr).Times(3)

	err := updateTaskStatusWithLockRetry(context.Background(), registry, "last-lock-task", StatusCompleted, "done", "")

	require.Equal(t, lockErr, err)
	registry.AssertExpectations(t)
}

func TestUpdateTaskStatusWithConversationLockRetryRetriesLockContention(t *testing.T) {
	registry := new(mockTaskRegistrar)
	lockErr := errors.New("failed to acquire update lock")

	registry.On("UpdateWithConversation", mock.Anything, "retry-conversation-task", StatusCompleted, "done", "", int32(44), "trace-44").Return(lockErr).Once()
	registry.On("UpdateWithConversation", mock.Anything, "retry-conversation-task", StatusCompleted, "done", "", int32(44), "trace-44").Return(nil).Once()

	err := completeTaskStatusWithConversationLockRetry(
		context.Background(),
		registry,
		"retry-conversation-task",
		"done",
		"",
		44,
		"trace-44",
	)

	require.NoError(t, err)
	registry.AssertExpectations(t)
}

func TestUpdateTaskStatusWithConversationLockRetryStopsWhenContextCanceled(t *testing.T) {
	registry := new(mockTaskRegistrar)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	registry.On("UpdateWithConversation", mock.Anything, "cancel-conversation-task", StatusCompleted, "done", "", int32(44), "trace-44").
		Return(errors.New("failed to acquire update lock")).Once()

	err := completeTaskStatusWithConversationLockRetry(ctx, registry, "cancel-conversation-task", "done", "", 44, "trace-44")

	require.ErrorIs(t, err, context.Canceled)
	registry.AssertExpectations(t)
}

func TestUpdateTaskStatusWithConversationLockRetryReturnsLastLockError(t *testing.T) {
	registry := new(mockTaskRegistrar)
	lockErr := errors.New("failed to acquire update lock")

	registry.On("UpdateWithConversation", mock.Anything, "last-conversation-task", StatusCompleted, "done", "", int32(44), "trace-44").
		Return(lockErr).Times(3)

	err := completeTaskStatusWithConversationLockRetry(context.Background(), registry, "last-conversation-task", "done", "", 44, "trace-44")

	require.Equal(t, lockErr, err)
	registry.AssertExpectations(t)
}

func TestOrchestrateTaskRunnerExecuteFailureBranches(t *testing.T) {
	mediaRegistry := new(mockTaskRegistrar)
	mediaRegistry.On("Update", mock.Anything, "media-exec-fail", StatusFailed, "", "media failed").Return(nil).Once()
	mediaClient := new(llmClientMock)
	mediaClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return((*agent.ChatCompletion)(nil), errors.New("media failed")).Once()

	mediaRunner := newOrchestrateTaskRunner("media-exec-fail", 7, "prompt", "xai/grok-imagine-video-1.5", OrchestrateTaskOptions{}, mediaRegistry)
	result, trace, ok := mediaRunner.execute(context.Background(), &orchestrationPreparation{adapter: mediaClient})
	require.False(t, ok)
	assert.Empty(t, result)
	assert.Nil(t, trace)
	mediaRegistry.AssertExpectations(t)
	mediaClient.AssertExpectations(t)

	mediaSuccessClient := new(llmClientMock)
	mediaSuccessClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "image ready"}}},
	}, nil).Once()
	mediaSuccessRunner := newOrchestrateTaskRunner("media-exec-success", 7, "prompt", "xai/grok-imagine-video-1.5", OrchestrateTaskOptions{}, new(mockTaskRegistrar))
	result, trace, ok = mediaSuccessRunner.execute(context.Background(), &orchestrationPreparation{adapter: mediaSuccessClient})
	require.True(t, ok)
	assert.Equal(t, "image ready", result)
	assert.Nil(t, trace)
	mediaSuccessClient.AssertExpectations(t)

	originalExecute := ExecuteOrchestrate
	t.Cleanup(func() { ExecuteOrchestrate = originalExecute })

	canceledRegistry := new(mockTaskRegistrar)
	canceledRegistry.On("Update", mock.Anything, "orchestration-canceled", StatusCanceled, "", "Run canceled").Return(nil).Once()
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		return "", nil, context.Canceled
	}
	canceledRunner := newOrchestrateTaskRunner("orchestration-canceled", 7, "prompt", "gpt-4", OrchestrateTaskOptions{}, canceledRegistry)
	_, _, ok = canceledRunner.execute(context.Background(), &orchestrationPreparation{
		orch:        newTestOrchestrator(new(llmClientMock)),
		userContext: RunUserContext{},
	})
	require.False(t, ok)
	canceledRegistry.AssertExpectations(t)

	deadlineRegistry := new(mockTaskRegistrar)
	deadlineRegistry.On("Update", mock.Anything, "orchestration-deadline", StatusFailed, "", "Request timed out. For complex questions, try breaking them into smaller parts.").Return(nil).Once()
	ExecuteOrchestrate = func(orch *orchestrator.TaskOrchestrator, ctx context.Context, prompt string) (string, *orchestrator.OrchestrationTrace, error) {
		return "", nil, errors.New("late")
	}
	deadlineCtx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	deadlineRunner := newOrchestrateTaskRunner("orchestration-deadline", 7, "prompt", "gpt-4", OrchestrateTaskOptions{}, deadlineRegistry)
	_, _, ok = deadlineRunner.execute(deadlineCtx, &orchestrationPreparation{
		orch:        newTestOrchestrator(new(llmClientMock)),
		userContext: RunUserContext{},
	})
	require.False(t, ok)
	deadlineRegistry.AssertExpectations(t)

	trustRegistry := new(mockTaskRegistrar)
	trustRegistry.On("Update", mock.Anything, "trust-user-overflow", StatusFailed, "", mock.MatchedBy(func(msg string) bool {
		return strings.Contains(msg, "userID")
	})).Return(nil).Once()
	trustRunner := newOrchestrateTaskRunner("trust-user-overflow", math.MaxInt32+1, "prompt", "gpt-4", OrchestrateTaskOptions{}, trustRegistry)
	_, _, ok = trustRunner.execute(context.Background(), &orchestrationPreparation{
		orch:        newTestOrchestrator(new(llmClientMock)),
		userContext: RunUserContext{TrustLayerEnabled: true},
	})
	require.False(t, ok)
	trustRegistry.AssertExpectations(t)
}

func TestOrchestrateTaskRunnerCompleteTraceID(t *testing.T) {
	originalFinalize := FinalizeTask
	t.Cleanup(func() { FinalizeTask = originalFinalize })

	var gotTraceID string
	FinalizeTask = func(ctx context.Context, taskID string, userID int, prompt, modelID, result string, trace *orchestrator.OrchestrationTrace, cfg coreconfig.Config, cache corecache.ICache, requiresCurrentData bool, memoryEnabled bool, opts OrchestrateTaskOptions, traceID string) {
		gotTraceID = traceID
	}

	runner := newOrchestrateTaskRunner("complete-trace", 7, "prompt", "gpt-4", OrchestrateTaskOptions{}, new(mockTaskRegistrar))
	runner.complete(context.Background(), &orchestrationPreparation{}, "done", &orchestrator.OrchestrationTrace{})
	assert.Equal(t, "trace_complete-trace", gotTraceID)
}

func TestHandleOrchestrateTaskProgressUpdate_WithBudget(t *testing.T) {
	mr, err := miniredis.Run()
	require.NoError(t, err)
	defer mr.Close()

	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	defer func() { _ = rdb.Close() }()
	redis.SetClient(redis.NewClient(rdb))
	t.Cleanup(func() { redis.SetClient(redis.NewMockClient()) })
	registry := requireTaskRegistry(t)
	taskID := "progress-handler-budget"
	require.NoError(t, registry.Register(taskID, 1, "prompt", "gpt-4", OrchestrateTaskOptions{}))

	budget := 4.0
	orch := newTestOrchestrator(new(llmClientMock))
	handleOrchestrateTaskProgressUpdate(
		registry,
		taskID,
		orch,
		OrchestrateTaskOptions{Budget: &budget},
		[]orchestrator.AgentStatusSnapshot{{AgentID: 0, Status: orchestrator.StatusProcessing}},
	)

	state := registry.Get(taskID)
	require.NotNil(t, state)
}
