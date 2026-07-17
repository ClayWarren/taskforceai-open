package submission

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/inngest/inngestgo"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type evalResultRedis struct {
	*redis.MockClient
	result any
	err    error
}

func (c *evalResultRedis) SupportsEval() bool { return true }

func (c *evalResultRedis) Eval(ctx context.Context, _ string, _ []string, _ ...any) *goredis.Cmd {
	cmd := goredis.NewCmd(ctx)
	if c.err != nil {
		cmd.SetErr(c.err)
		return cmd
	}
	cmd.SetVal(c.result)
	return cmd
}

func TestPersistTaskSubmissionDeadLetterRedisGetterError(t *testing.T) {
	withUnavailableRedis(t, errors.New("redis offline"))

	err := persistTaskSubmissionDeadLetter(context.Background(), "task-no-redis", inngestgo.GenericEvent[map[string]any]{
		Name: "task.execute",
	}, errors.New("failed"))
	require.Error(t, err)
}

func TestPersistTaskSubmissionDeadLetterPersistsToStream(t *testing.T) {
	for _, taskID := range []string{"task-trim", "task-stream-persist"} {
		withMockRedis(t)
		err := persistTaskSubmissionDeadLetter(context.Background(), taskID, inngestgoEvent(taskID), errors.New("queue down"))
		require.NoError(t, err)
	}
}

func TestPersistTaskSubmissionDeadLetter_RedisUnavailable(t *testing.T) {
	event := inngestgo.GenericEvent[map[string]any]{Name: "task.execute"}
	for _, getterErr := range []error{errors.New("redis down"), nil} {
		withUnavailableRedis(t, getterErr)
		require.Error(t, persistTaskSubmissionDeadLetter(context.Background(), "task-dlq", event, errors.New("fail")))
	}
}

func TestReserveAndReleaseIdempotency_RedisUnavailable(t *testing.T) {
	for _, getterErr := range []error{errors.New("redis down"), nil} {
		withUnavailableRedis(t, getterErr)
		_, _, err := reserveTaskSubmissionIdempotency(context.Background(), 1, "key", "task-1")
		require.Error(t, err)
		require.Error(t, releaseTaskSubmissionIdempotency(context.Background(), 1, "key"))
	}
}

func TestReserveTaskSubmissionIdempotencyExistingEmptyValue(t *testing.T) {
	mockRedis := withMockRedis(t)
	ctx := context.Background()

	_, reserved, err := reserveTaskSubmissionIdempotency(ctx, 7, "dup-key", "task-1")
	require.NoError(t, err)
	require.True(t, reserved)

	require.NoError(t, mockRedis.Set(ctx, taskSubmissionIdempotencyKey(7, "dup-key-2"), []byte("   "), time.Minute))
	_, reserved, err = reserveTaskSubmissionIdempotency(ctx, 7, "dup-key-2", "task-2")
	require.Error(t, err)
	assert.False(t, reserved)
}

func TestReserveTaskSubmissionIdempotencyEncodeFailure(t *testing.T) {
	restore(t, &marshalTaskSubmissionIdempotency)
	marshalTaskSubmissionIdempotency = func(any) ([]byte, error) { return nil, errors.New("encode failed") }
	withMockRedis(t)

	_, reserved, err := reserveTaskSubmissionIdempotency(context.Background(), 7, "key", "task-1")
	require.ErrorContains(t, err, "encode idempotency reservation")
	assert.False(t, reserved)
}

func TestStoreAndGetAttachment_DefaultPaths(t *testing.T) {
	for _, getterErr := range []error{errors.New("redis down"), nil} {
		withUnavailableRedis(t, getterErr)
		require.Error(t, StoreAttachment(context.Background(), "file-1", []byte("x"), time.Minute))
		_, err := GetAttachment(context.Background(), "file-1")
		require.Error(t, err)
	}
}

func TestStoreAttachmentAndGetAttachment(t *testing.T) {
	withMockRedis(t)
	ctx := context.Background()

	require.NoError(t, StoreAttachment(ctx, "file-1", []byte("payload"), time.Minute))
	data, err := GetAttachment(ctx, "file-1")
	require.NoError(t, err)
	assert.Equal(t, []byte("payload"), data)
}

func TestStoreAttachmentSetAndGetErrors(t *testing.T) {
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &setErrorRedisClient{MockClient: redis.NewMockClient()}, nil
	})
	require.ErrorContains(t, StoreAttachment(context.Background(), "file-set-fail", []byte("x"), time.Minute), "failed to store binary attachment")

	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &redisGetFailClient{MockClient: redis.NewMockClient()}, nil
	})
	_, err := GetAttachment(context.Background(), "file-get-fail")
	require.ErrorContains(t, err, "redis get failed")
}

func TestExecuteSubmittedTaskBackgroundDefaultUsesInlineHook(t *testing.T) {
	restore(t, &executeSubmittedTaskInline)
	called := make(chan struct{}, 1)
	executeSubmittedTaskInline = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
		called <- struct{}{}
	}

	executeSubmittedTaskBackground(context.Background(), "task-background-default", 7, "prompt", "model", OrchestrateTaskOptions{})

	select {
	case <-called:
	case <-time.After(time.Second):
		t.Fatal("expected background execution to invoke inline hook")
	}
}

func TestStoreAttachments(t *testing.T) {
	restore(t, &marshalAttachments)
	attachments := Attachments{
		Files: []FileAttachment{{Data: []byte("hello"), MimeType: "image/png", Name: "img.png"}},
	}
	marshalAttachments = func(any) ([]byte, error) { return nil, errors.New("encode failed") }
	withMockRedis(t)
	require.ErrorContains(t, StoreAttachments(context.Background(), attachments, "task-encode-fail"), "encode attachments")
	marshalAttachments = json.Marshal

	withUnavailableRedis(t, errors.New("redis offline"))
	if err := StoreAttachments(context.Background(), attachments, "task-1"); err == nil || !strings.Contains(err.Error(), "redis unavailable") {
		t.Fatalf("expected redis unavailable error, got %v", err)
	}

	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &setErrorRedisClient{MockClient: redis.NewMockClient()}, nil
	})
	if err := StoreAttachments(context.Background(), attachments, "task-3"); err == nil || !strings.Contains(err.Error(), "failed to store attachments") {
		t.Fatalf("expected set error, got %v", err)
	}

	withMockRedis(t)
	if err := StoreAttachments(context.Background(), attachments, "task-4"); err != nil {
		t.Fatalf("expected store success, got %v", err)
	}
}

func TestStoreAttachments_DefaultPaths(t *testing.T) {
	for _, getterErr := range []error{errors.New("redis down"), nil} {
		withUnavailableRedis(t, getterErr)
		require.Error(t, StoreAttachments(context.Background(), Attachments{Files: []FileAttachment{{ID: "f1"}}}, "task-store"))
	}

	withMockRedis(t)
	require.NoError(t, StoreAttachments(context.Background(), Attachments{Files: []FileAttachment{{ID: "f1", Data: []byte("x")}}}, "task-store-ok"))
}

func TestSubmitTaskReleasesIdempotencyOnValidationFailure(t *testing.T) {
	withMockRedis(t)

	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{id: "evt-1"}

	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:         7,
		Prompt:         "hello",
		ModelID:        "openai/gpt-5.6-sol",
		IdempotencyKey: "release-on-fail",
		Attachments: Attachments{
			Files: []FileAttachment{{Data: []byte("x"), MimeType: "video/avi", Name: "bad.avi"}},
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
	})
	require.Error(t, err)

	existingTaskID, reserved, reserveErr := reserveTaskSubmissionIdempotency(context.Background(), 7, "release-on-fail", "task-retry")
	require.NoError(t, reserveErr)
	assert.True(t, reserved)
	assert.Equal(t, "task-retry", existingTaskID)
}

func TestSubmitTaskLogsIdempotencyReleaseFailureOnValidationError(t *testing.T) {
	mockRedis := &idempotencyDelFailRedis{MockClient: redis.NewMockClient()}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return mockRedis, nil })

	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:         7,
		Prompt:         "hello",
		ModelID:        "openai/gpt-5.6-sol",
		IdempotencyKey: "release-failure",
		Attachments: Attachments{
			Files: []FileAttachment{{Data: []byte("x"), MimeType: "image/png", Name: "image.png"}},
		},
	}, TaskSubmissionDeps{
		Registry: &captureRegistry{tasks: map[string]*TaskState{}},
		Inngest:  &captureInngest{id: "evt-release-failure"},
		StoreAttachments: func(context.Context, Attachments, string) error {
			return errors.New("attachment storage failed")
		},
	})

	require.Error(t, err)
}

func TestTaskSubmissionIdempotencyEdgeCases(t *testing.T) {
	ctx := context.Background()

	evalClient := &evalResultRedis{MockClient: redis.NewMockClient(), result: int64(1)}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return evalClient, nil })
	require.NoError(t, releaseTaskSubmissionIdempotency(ctx, 7, "eval-release", "task-1"))

	emptyClient := redis.NewMockClient()
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return emptyClient, nil })
	require.NoError(t, releaseTaskSubmissionIdempotency(ctx, 7, "missing-release", "task-1"))
	assert.False(t, taskSubmissionIdempotencyReservationPending(ctx, 7, "missing", "task-1"))

	getFailure := &redisGetFailClient{MockClient: redis.NewMockClient()}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return getFailure, nil })
	require.Error(t, releaseTaskSubmissionIdempotency(ctx, 7, "get-failure", "task-1"))

	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return nil, errors.New("redis getter failed")
	})
	assert.False(t, taskSubmissionIdempotencyReservationPending(ctx, 7, "getter-failure", "task-1"))

	assert.Empty(t, decodeTaskSubmissionIdempotencyReservation("   ").TaskID)
	withoutTimestamp := redis.NewMockClient()
	require.NoError(t, withoutTimestamp.Set(ctx, taskSubmissionIdempotencyKey(7, "no-timestamp"), []byte(`{"taskId":"task-1"}`), time.Minute))
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return withoutTimestamp, nil })
	assert.False(t, taskSubmissionIdempotencyReservationPending(ctx, 7, "no-timestamp", "task-1"))
}

func TestSubmitTaskQueueFailureWithDeadLetterPersistenceFailure(t *testing.T) {
	withUnavailableRedis(t, errors.New("redis offline"))

	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{err: errors.New("queue down")}
	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "hello",
		ModelID: "openai/gpt-5.6-sol",
	}, TaskSubmissionDeps{
		Registry:  registry,
		Inngest:   sender,
		NewTaskID: func(prefix string) string { return prefix + "dlq-fail" },
	})
	require.Error(t, err)
	var submissionErr *TaskSubmissionError
	require.ErrorAs(t, err, &submissionErr)
	assert.Equal(t, TaskSubmissionQueue, submissionErr.Code)
}

func TestSubmitTask_DrainDLQFailureIsNonFatal(t *testing.T) {
	withUnavailableRedis(t, errors.New("redis offline"))

	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  4,
		Prompt:  "hello",
		ModelID: "gpt-4",
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  &captureInngest{id: "evt-drain"},
	})
	require.NoError(t, err)
	assert.NotEmpty(t, result.TaskID)
}

func TestSubmitTask_DrainDeadLetterWarningDoesNotFail(t *testing.T) {
	mockRedis := &dlqStreamRedisClient{MockClient: redis.NewMockClient()}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return mockRedis, nil })

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "hello",
		ModelID: "openai/gpt-5.6-sol",
	}, TaskSubmissionDeps{
		Registry: &captureRegistry{},
		Inngest:  &captureInngest{id: "evt-drain"},
	})
	require.NoError(t, err)
	assert.NotEmpty(t, result.TaskID)
}

func TestSubmitTask_IdempotencyStaleTaskIDRecovers(t *testing.T) {
	mockRedis := withMockRedis(t)

	registry := &captureRegistry{}
	sender := &captureInngest{id: "evt-1"}
	idCounter := 0
	nextID := func(prefix string) string {
		idCounter++
		return prefix + fmt.Sprintf("id-%d", idCounter)
	}

	req := TaskSubmissionRequest{
		UserID:         7,
		Prompt:         "run task",
		ModelID:        "openai/gpt-5.6-sol",
		IdempotencyKey: "idem-key",
	}

	first, err := SubmitTask(context.Background(), req, TaskSubmissionDeps{
		Registry:  registry,
		Inngest:   sender,
		NewTaskID: nextID,
	})
	if err != nil {
		t.Fatalf("first submit failed: %v", err)
	}

	delete(registry.tasks, first.TaskID)
	if _, err := mockRedis.Del(context.Background(), "task:"+first.TaskID); err != nil {
		t.Fatalf("failed to delete task key: %v", err)
	}
	seedStaleTaskSubmissionIdempotency(t, mockRedis, "idem-key", first.TaskID)

	second, err := SubmitTask(context.Background(), req, TaskSubmissionDeps{
		Registry:  registry,
		Inngest:   sender,
		NewTaskID: nextID,
	})
	if err != nil {
		t.Fatalf("second submit should recover stale idempotency key, got %v", err)
	}
	if second.TaskID == first.TaskID {
		t.Fatalf("expected stale idempotency reservation to be replaced with a new task id")
	}
}

func TestSubmitTask_MissingDependencies(t *testing.T) {
	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{}, TaskSubmissionDeps{
		Inngest: &captureInngest{},
	})
	if err == nil {
		t.Fatal("expected error when registry is missing")
	}
	var subErr *TaskSubmissionError
	if !errors.As(err, &subErr) {
		t.Fatalf("expected TaskSubmissionError, got %T", err)
	}
	if subErr.Code != TaskSubmissionInternal {
		t.Fatalf("expected internal code, got %s", subErr.Code)
	}

	_, err = SubmitTask(context.Background(), TaskSubmissionRequest{}, TaskSubmissionDeps{
		Registry: &captureRegistry{},
	})
	if err == nil {
		t.Fatal("expected error when inngest is missing")
	}
	if !errors.As(err, &subErr) {
		t.Fatalf("expected TaskSubmissionError, got %T", err)
	}
	if subErr.Code != TaskSubmissionInternal {
		t.Fatalf("expected internal code, got %s", subErr.Code)
	}
}

func TestSubmitTask_NilRegistry(t *testing.T) {
	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  1,
		Prompt:  "hi",
		ModelID: "gpt-4",
	}, TaskSubmissionDeps{
		Registry: nil,
		Inngest:  &captureInngest{},
	})
	require.Error(t, err)
	var submissionErr *TaskSubmissionError
	require.ErrorAs(t, err, &submissionErr)
	assert.Equal(t, TaskSubmissionInternal, submissionErr.Code)
}

func TestSubmitTask_QueueFailurePersistsDeadLetter(t *testing.T) {
	withMockRedis(t)

	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  5,
		Prompt:  "hello",
		ModelID: "gpt-4",
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  &captureInngest{err: errors.New("queue down")},
	})
	require.NoError(t, err)
	assert.NotEmpty(t, result.TaskID)
	assert.Equal(t, StatusProcessing, result.Status)
	assert.NotNil(t, registry.Get(result.TaskID))

	_, reserved, reserveErr := reserveTaskSubmissionIdempotency(context.Background(), 5, "unused", "task-retry")
	require.NoError(t, reserveErr)
	assert.True(t, reserved)
}

func TestSubmitTask_RegisterFailure(t *testing.T) {
	registry := &captureRegistry{err: errors.New("redis unavailable")}
	sender := &captureInngest{}

	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  1,
		Prompt:  "hello",
		ModelID: "openai/gpt-5.6-sol",
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return "task_register_error"
		},
	})
	if err == nil {
		t.Fatal("expected register failure")
	}
	var subErr *TaskSubmissionError
	if !errors.As(err, &subErr) || subErr.Code != TaskSubmissionInternal {
		t.Fatalf("expected internal TaskSubmissionError, got %v", err)
	}
}

func TestSubmitTask_DeadLetterRetainsIdempotencyReservation(t *testing.T) {
	mockRedis := &releaseFailRedis{MockClient: redis.NewMockClient()}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return mockRedis, nil })

	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:         8,
		Prompt:         "hello",
		ModelID:        "gpt-4",
		IdempotencyKey: "release-fail-key",
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  &captureInngest{err: errors.New("queue down")},
	})
	require.NoError(t, err)
	assert.NotEmpty(t, result.TaskID)

	existingTaskID, reserved, reserveErr := reserveTaskSubmissionIdempotency(context.Background(), 8, "release-fail-key", "task-new")
	require.NoError(t, reserveErr)
	assert.False(t, reserved, "release failure should leave the existing reservation in place")
	assert.NotEmpty(t, existingTaskID)
	assert.NotEqual(t, "task-new", existingTaskID)
}

func TestSubmitTask_DeadLetterPreventsIdempotentRetryDuplication(t *testing.T) {
	withMockRedis(t)

	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	first, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:         7,
		Prompt:         "hello",
		ModelID:        "openai/gpt-5.6-sol",
		IdempotencyKey: "queue-fail-key",
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  &captureInngest{err: errors.New("queue unavailable")},
	})
	require.NoError(t, err)

	existingTaskID, reserved, reserveErr := reserveTaskSubmissionIdempotency(context.Background(), 7, "queue-fail-key", "task-retry")
	require.NoError(t, reserveErr)
	assert.False(t, reserved)
	assert.Equal(t, first.TaskID, existingTaskID)
}

func TestSubmitTask_ReturnsExistingIdempotentTask(t *testing.T) {
	withMockRedis(t)

	registry := &captureRegistry{tasks: map[string]*TaskState{
		"task-existing": {TaskID: "task-existing", Status: StatusProcessing},
	}}
	_, reserved, err := reserveTaskSubmissionIdempotency(context.Background(), 7, "submit-idem", "task-existing")
	require.NoError(t, err)
	require.True(t, reserved)

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:         7,
		Prompt:         "hello",
		ModelID:        "gpt-4",
		IdempotencyKey: "submit-idem",
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  &captureInngest{id: "evt-skip"},
	})
	require.NoError(t, err)
	assert.Equal(t, "task-existing", result.TaskID)
	assert.Equal(t, StatusProcessing, result.Status)
}

func TestSubmitTask_QuickModeExecutesInlineWithoutQueue(t *testing.T) {
	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{id: "evt-should-not-send"}
	originalInline := executeSubmittedTaskInline
	executeSubmittedTaskInline = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
		task := registry.Get(taskID)
		require.NotNil(t, task)
		task.Status = StatusCompleted
		task.Result = "done"
	}
	t.Cleanup(func() { executeSubmittedTaskInline = originalInline })

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "hello",
		ModelID: "openai/gpt-5.6-sol",
		Options: OrchestrateTaskOptions{
			QuickModeEnabled: true,
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return "task_inline"
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "task_inline", result.TaskID)
	assert.Equal(t, StatusCompleted, result.Status)
	assert.False(t, sender.called)
	assert.Equal(t, StatusCompleted, registry.Get("task_inline").Status)
}

func TestSubmitTask_QuickModeInlineRespectsTaskExecutionCapacity(t *testing.T) {
	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{id: "evt-should-not-send"}
	originalInline := executeSubmittedTaskInline
	originalAcquire := acquireTaskExecutionSlot
	inlineCalled := false
	executeSubmittedTaskInline = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
		inlineCalled = true
	}
	acquireTaskExecutionSlot = func() (func(), bool) {
		return nil, false
	}
	t.Cleanup(func() {
		executeSubmittedTaskInline = originalInline
		acquireTaskExecutionSlot = originalAcquire
	})

	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "hello",
		ModelID: "openai/gpt-5.6-sol",
		Options: OrchestrateTaskOptions{
			QuickModeEnabled: true,
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return "task_inline_capacity"
		},
	})

	require.Error(t, err)
	var submissionErr *TaskSubmissionError
	require.ErrorAs(t, err, &submissionErr)
	assert.Equal(t, TaskSubmissionCapacity, submissionErr.Code)
	assert.False(t, inlineCalled)
	assert.False(t, sender.called)
	assert.Nil(t, registry.Get("task_inline_capacity"), "capacity rejection must not leave a durable processing task")
}

func TestSubmitTask_ComputerUseQuickModeExecutesInBackground(t *testing.T) {
	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{id: "evt-should-not-send"}
	originalBackground := executeSubmittedTaskBackground
	var backgroundCalled bool
	executeSubmittedTaskBackground = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
		backgroundCalled = true
		assert.Equal(t, "task_computer_bg", taskID)
		assert.Equal(t, 7, userID)
		assert.True(t, opts.ComputerUseEnabled)
	}
	t.Cleanup(func() { executeSubmittedTaskBackground = originalBackground })

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "browse",
		ModelID: "openai/gpt-5.6-sol",
		Options: OrchestrateTaskOptions{
			QuickModeEnabled:   true,
			ComputerUseEnabled: true,
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return "task_computer_bg"
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "task_computer_bg", result.TaskID)
	assert.Equal(t, StatusProcessing, result.Status)
	assert.True(t, backgroundCalled)
	assert.False(t, sender.called)
	assert.Equal(t, StatusProcessing, registry.Get("task_computer_bg").Status)
}

func TestSubmitTask_LocalAgentTeamsExecutesInBackground(t *testing.T) {
	t.Setenv("TASKFORCE_LOCAL_TASK_EXECUTION", "true")
	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{id: "evt-should-not-send"}
	originalBackground := executeSubmittedTaskBackground
	var backgroundCalled bool
	executeSubmittedTaskBackground = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
		backgroundCalled = true
		assert.Equal(t, "task_agent_teams_bg", taskID)
		assert.Equal(t, 7, userID)
		assert.False(t, opts.QuickModeEnabled)
	}
	t.Cleanup(func() { executeSubmittedTaskBackground = originalBackground })

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "agent teams",
		ModelID: "zai/glm-5.2",
		Options: OrchestrateTaskOptions{
			QuickModeEnabled: false,
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return "task_agent_teams_bg"
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "task_agent_teams_bg", result.TaskID)
	assert.Equal(t, StatusProcessing, result.Status)
	assert.True(t, backgroundCalled)
	assert.False(t, sender.called)
}

func TestSubmitTask_LocalAgentTeamsDefaultQueuesTask(t *testing.T) {
	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{id: "evt-queued"}

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "agent teams",
		ModelID: "zai/glm-5.2",
		Options: OrchestrateTaskOptions{
			QuickModeEnabled: false,
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return "task_agent_teams_queue"
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "task_agent_teams_queue", result.TaskID)
	assert.Equal(t, StatusProcessing, result.Status)
	assert.True(t, sender.called)
}

func TestSubmitTask_LocalAgentTeamsEvalQueuesTask(t *testing.T) {
	t.Setenv("TASKFORCE_LOCAL_TASK_EXECUTION", "true")
	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{id: "evt-queued"}

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "agent teams",
		ModelID: "zai/glm-5.2",
		IsEval:  true,
		Options: OrchestrateTaskOptions{
			QuickModeEnabled: false,
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return "task_agent_teams_eval"
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "task_agent_teams_eval", result.TaskID)
	assert.Equal(t, StatusProcessing, result.Status)
	assert.True(t, sender.called)
}

func TestSubmitTask_QuickModeAsyncKillSwitchQueuesTask(t *testing.T) {
	t.Setenv("TASKFORCE_ASYNC_QUICK_MODE", "1")
	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{id: "evt-queued"}

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "hello",
		ModelID: "openai/gpt-5.6-sol",
		Options: OrchestrateTaskOptions{
			QuickModeEnabled: true,
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return "task_async"
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "task_async", result.TaskID)
	assert.Equal(t, StatusProcessing, result.Status)
	assert.True(t, sender.called)
}

func TestSubmitTask_QuickModeGeneratedFileQueuesTask(t *testing.T) {
	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{id: "evt-file-queued"}
	originalInline := executeSubmittedTaskInline
	var inlineCalled bool
	executeSubmittedTaskInline = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
		inlineCalled = true
	}
	t.Cleanup(func() { executeSubmittedTaskInline = originalInline })

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "Create an Excel file called sunlight-distplanets.xlsx with planet light travel times.",
		ModelID: "openai/gpt-5.6-sol",
		Options: OrchestrateTaskOptions{
			QuickModeEnabled: true,
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return "task_file_async"
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "task_file_async", result.TaskID)
	assert.Equal(t, StatusProcessing, result.Status)
	assert.True(t, sender.called)
	assert.False(t, inlineCalled)
}

func TestSubmitTask_LocalQuickModeGeneratedFileExecutesInBackground(t *testing.T) {
	t.Setenv("TASKFORCE_LOCAL_TASK_EXECUTION", "true")
	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	sender := &captureInngest{id: "evt-should-not-send"}
	originalBackground := executeSubmittedTaskBackground
	var backgroundCalled bool
	executeSubmittedTaskBackground = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
		backgroundCalled = true
		assert.Equal(t, "task_local_file_bg", taskID)
		assert.Equal(t, 7, userID)
		assert.True(t, opts.QuickModeEnabled)
	}
	t.Cleanup(func() { executeSubmittedTaskBackground = originalBackground })

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  7,
		Prompt:  "Create an Excel file called sunlight-distplanets.xlsx with planet light travel times.",
		ModelID: "zai/glm-5.2",
		Options: OrchestrateTaskOptions{
			QuickModeEnabled: true,
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		NewTaskID: func(prefix string) string {
			return "task_local_file_bg"
		},
	})

	require.NoError(t, err)
	assert.Equal(t, "task_local_file_bg", result.TaskID)
	assert.Equal(t, StatusProcessing, result.Status)
	assert.True(t, backgroundCalled)
	assert.False(t, sender.called)
}

func TestSubmitTask_SuccessAndQueueError(t *testing.T) {
	withMockRedis(t)
	registry := &captureRegistry{}
	sender := &captureInngest{id: "evt-123"}
	storeCalled := false

	result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:       7,
		Prompt:       "run task",
		ModelID:      "openai/gpt-5.6-sol",
		Source:       "web",
		IsEval:       true,
		TaskIDPrefix: "custom_",
		Options: OrchestrateTaskOptions{
			QuickModeEnabled: true,
		},
		Attachments: Attachments{
			Files: []FileAttachment{{Data: []byte("hello"), MimeType: "image/png", Name: "img.png"}},
		},
	}, TaskSubmissionDeps{
		Registry: registry,
		Inngest:  sender,
		StoreAttachments: func(ctx context.Context, attachments Attachments, taskID string) error {
			storeCalled = true
			if taskID != "custom_fixed-id" {
				return errors.New("unexpected task id")
			}
			return nil
		},
		NewTaskID: func(prefix string) string { return prefix + "fixed-id" },
	})
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}
	if result.TaskID != "custom_fixed-id" {
		t.Fatalf("unexpected task id: %s", result.TaskID)
	}
	if result.Status != StatusProcessing {
		t.Fatalf("unexpected status: %s", result.Status)
	}
	if !storeCalled {
		t.Fatal("expected attachments to be stored")
	}

	event, ok := sender.event.(inngestgo.GenericEvent[map[string]any])
	if !ok {
		t.Fatalf("expected GenericEvent payload, got %T", sender.event)
	}
	if event.Name != "task.execute" {
		t.Fatalf("unexpected event name: %s", event.Name)
	}
	options, ok := event.Data["options"].(OrchestrateTaskOptions)
	if !ok {
		t.Fatalf("expected options payload, got %T", event.Data["options"])
	}
	if options.AttachmentCount != 1 {
		t.Fatalf("expected attachment count 1, got %d", options.AttachmentCount)
	}

	queueSender := &captureInngest{err: errors.New("queue unavailable")}
	deadLettered, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:  1,
		Prompt:  "hello",
		ModelID: "openai/gpt-5.6-sol",
	}, TaskSubmissionDeps{
		Registry: &captureRegistry{},
		Inngest:  queueSender,
		NewTaskID: func(prefix string) string {
			return "task_queue_error"
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "task_queue_error", deadLettered.TaskID)
	assert.Equal(t, StatusProcessing, deadLettered.Status)
}

func TestSubmitTask_SuccessWithMediaAttachmentAndCustomPrefix(t *testing.T) {
	cases := []struct {
		name    string
		prompt  string
		modelID string
		mime    string
		file    string
	}{
		{"multimodal video model", "hello", "google/gemini-2.5-pro", "video/mp4", "clip.mp4"},
		{"video generation start frame", "animate this image into a short video", "xai/grok-imagine-video-1.5", "image/png", "start.png"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withMockRedis(t)

			registry := &captureRegistry{tasks: map[string]*TaskState{}}
			result, err := SubmitTask(context.Background(), TaskSubmissionRequest{
				UserID:       3,
				Prompt:       tc.prompt,
				ModelID:      tc.modelID,
				TaskIDPrefix: "custom_",
				Attachments: Attachments{
					Files: []FileAttachment{{MimeType: tc.mime, Name: tc.file, Data: []byte("media")}},
				},
			}, TaskSubmissionDeps{
				Registry: registry,
				Inngest:  &captureInngest{id: "evt-ok"},
				NewTaskID: func(prefix string) string {
					return prefix + "fixed-id"
				},
			})
			require.NoError(t, err)
			assert.Equal(t, "custom_fixed-id", result.TaskID)
			assert.Equal(t, StatusProcessing, result.Status)
			assert.NotNil(t, registry.Get(result.TaskID))
		})
	}
}
