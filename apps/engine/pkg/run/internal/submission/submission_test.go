package submission

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/inngest/inngestgo"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type dlqCursorClient struct {
	value string
	err   error
}

func (c dlqCursorClient) Get(ctx context.Context, key string) (string, error) {
	return c.value, c.err
}

type setErrorRedisClient struct {
	*redis.MockClient
}

func (c *setErrorRedisClient) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return errors.New("set failed")
}

type xaddErrorRedisClient struct {
	*redis.MockClient
}

func (c *xaddErrorRedisClient) XAdd(ctx context.Context, stream string, values map[string]any) (string, error) {
	return "", errors.New("stream operations require REDIS_URL")
}

type xtrimErrorRedisClient struct {
	*redis.MockClient
}

func (c *xtrimErrorRedisClient) XTrimMaxLen(ctx context.Context, key string, maxLen int64) (int64, error) {
	return 0, errors.New("trim failed")
}

type xaddIncrErrorRedisClient struct {
	*redis.MockClient
}

func (c *xaddIncrErrorRedisClient) XAdd(ctx context.Context, stream string, values map[string]any) (string, error) {
	return "", errors.New("xadd failed")
}

func (c *xaddIncrErrorRedisClient) Incr(ctx context.Context, key string) (int, error) {
	return 0, errors.New("incr failed")
}

type fallbackCursorErrorRedisClient struct {
	*redis.MockClient
}

func (c *fallbackCursorErrorRedisClient) Get(ctx context.Context, key string) (string, error) {
	switch key {
	case dlqFallbackSeqKey:
		return "1", nil
	case dlqFallbackCursor:
		return "", errors.New("cursor failed")
	default:
		return c.MockClient.Get(ctx, key)
	}
}

type fallbackEntryGetErrorRedisClient struct {
	*redis.MockClient
}

func (c *fallbackEntryGetErrorRedisClient) Get(ctx context.Context, key string) (string, error) {
	switch {
	case key == dlqFallbackSeqKey:
		return "1", nil
	case key == dlqFallbackCursor:
		return "0", nil
	case strings.HasPrefix(key, dlqFallbackPrefix):
		return "", errors.New("entry get failed")
	default:
		return c.MockClient.Get(ctx, key)
	}
}

type recoverReserveFailAfterReleaseRedis struct {
	*redis.MockClient
	released bool
}

func (c *recoverReserveFailAfterReleaseRedis) Del(ctx context.Context, key string) (bool, error) {
	deleted, err := c.MockClient.Del(ctx, key)
	if strings.HasPrefix(key, "run:submit:idempotency:") {
		c.released = true
	}
	return deleted, err
}

func (c *recoverReserveFailAfterReleaseRedis) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if c.released && strings.HasPrefix(key, "run:submit:idempotency:") {
		return false, errors.New("recover reserve failed")
	}
	return c.MockClient.SetNX(ctx, key, value, ttl)
}

func TestDLQPayloadAndSequenceBranches(t *testing.T) {
	if payload, err := decodeTaskSubmissionDLQPayload(nil); err == nil || payload != nil {
		t.Fatalf("expected empty payload error, got payload=%#v err=%v", payload, err)
	}
	if payload, err := decodeTaskSubmissionDLQPayload([]byte(`{`)); err == nil || payload != nil {
		t.Fatalf("expected invalid json payload error, got payload=%#v err=%v", payload, err)
	}
	if payload, err := decodeTaskSubmissionDLQPayload([]byte(`{"taskId":"","name":"task.execute"}`)); err == nil || payload != nil {
		t.Fatalf("expected invalid payload error, got payload=%#v err=%v", payload, err)
	}
	payload, err := decodeTaskSubmissionDLQPayload([]byte(`{"taskId":"task-1","name":"task.execute","event":{"taskId":"task-1"}}`))
	if err != nil || payload.TaskID != "task-1" || payload.Name != "task.execute" {
		t.Fatalf("unexpected decoded payload: %#v err=%v", payload, err)
	}

	seq, err := loadTaskSubmissionDLQSequence(context.Background(), dlqCursorClient{value: "   "}, "seq")
	if err != nil || seq != 0 {
		t.Fatalf("expected blank sequence to be zero, seq=%d err=%v", seq, err)
	}
	seq, err = loadTaskSubmissionDLQSequence(context.Background(), dlqCursorClient{value: "-1"}, "seq")
	if err != nil || seq != 0 {
		t.Fatalf("expected negative sequence to be zero, seq=%d err=%v", seq, err)
	}
	_, err = loadTaskSubmissionDLQSequence(context.Background(), dlqCursorClient{value: "not-int"}, "seq")
	if err == nil {
		t.Fatal("expected parse error")
	}
	_, err = loadTaskSubmissionDLQSequence(context.Background(), dlqCursorClient{err: errors.New("redis unavailable")}, "seq")
	if err == nil {
		t.Fatal("expected redis error")
	}
}

func TestDrainTaskSubmissionDeadLetterAsyncNilSender(t *testing.T) {
	drainTaskSubmissionDeadLetterAsync(context.Background(), nil)
}

func TestPersistTaskSubmissionDeadLetterErrorBranches(t *testing.T) {
	mockRedis := withMockRedis(t)
	err := persistTaskSubmissionDeadLetter(context.Background(), "task-bad-payload", inngestgo.GenericEvent[map[string]any]{
		Name: "task.execute",
		Data: map[string]any{"bad": func() {}},
	}, errors.New("queue down"))
	require.Error(t, err)

	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &xtrimErrorRedisClient{MockClient: mockRedis}, nil
	})
	err = persistTaskSubmissionDeadLetter(context.Background(), "task-trim-error", inngestgoEvent("task-trim-error"), errors.New("queue down"))
	require.NoError(t, err)

	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) {
		return &xaddIncrErrorRedisClient{MockClient: redis.NewMockClient()}, nil
	})
	err = persistTaskSubmissionDeadLetter(context.Background(), "task-incr-error", inngestgoEvent("task-incr-error"), errors.New("queue down"))
	require.ErrorContains(t, err, "incr failed")
}

func TestDecodeTaskSubmissionDLQPayloadInvalidTaskID(t *testing.T) {
	_, err := decodeTaskSubmissionDLQPayload([]byte(`{"name":"task.execute","event":{}}`))
	require.Error(t, err)
}

func TestDrainTaskSubmissionDeadLetterCursorPersistFailure(t *testing.T) {
	payload, err := json.Marshal(taskSubmissionDLQPayload{
		TaskID: "task-cursor-fail",
		Name:   "task.execute",
		Event:  map[string]any{"taskId": "task-cursor-fail"},
	})
	require.NoError(t, err)

	mockRedis := &dlqCursorSetFailRedis{
		dlqStreamRedisClient: &dlqStreamRedisClient{
			MockClient: redis.NewMockClient(),
			messages: []goredis.XMessage{
				{ID: "20-0", Values: map[string]any{"payload": string(payload)}},
			},
		},
	}
	err = drainTaskSubmissionDeadLetterWithClient(context.Background(), &captureInngest{id: "evt-cursor"}, mockRedis)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cursor persist failed")
}

func TestDrainTaskSubmissionDeadLetterAdvancesPastPoisonBatch(t *testing.T) {
	payload, err := json.Marshal(taskSubmissionDLQPayload{
		TaskID: "task-valid",
		Name:   "task.execute",
		Event:  map[string]any{"taskId": "task-valid"},
	})
	require.NoError(t, err)
	client := &cursorAwareDLQStreamRedisClient{
		MockClient: redis.NewMockClient(),
		messages: []goredis.XMessage{
			{ID: "1-0", Values: map[string]any{}},
			{ID: "2-0", Values: map[string]any{"payload": 123}},
			{ID: "3-0", Values: map[string]any{"payload": "{"}},
			{ID: "4-0", Values: map[string]any{"payload": ""}},
			{ID: "5-0", Values: map[string]any{"payload": []byte(`{"name":"task.execute"}`)}},
			{ID: "6-0", Values: map[string]any{"payload": string(payload)}},
		},
	}
	sender := &captureInngest{id: "evt-valid"}

	require.NoError(t, drainTaskSubmissionDeadLetterWithClient(context.Background(), sender, client))
	assert.False(t, sender.called)
	cursor, cursorErr := client.Get(context.Background(), dlqCursorKey)
	require.NoError(t, cursorErr)
	assert.Equal(t, "5-0", cursor)

	require.NoError(t, drainTaskSubmissionDeadLetterWithClient(context.Background(), sender, client))
	assert.True(t, sender.called)
}

func TestDrainTaskSubmissionDeadLetterFallbackDeleteWarningStillAdvances(t *testing.T) {
	mockRedis := redis.NewMockClient()
	ctx := context.Background()
	require.NoError(t, mockRedis.Set(ctx, dlqFallbackSeqKey, []byte("1"), time.Minute))

	payload, err := json.Marshal(taskSubmissionDLQPayload{
		TaskID: "task-del-warn",
		Name:   "task.execute",
		Event:  map[string]any{"taskId": "task-del-warn"},
	})
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(ctx, dlqFallbackPrefix+"1", payload, time.Minute))

	sender := &captureInngest{id: "evt-del-warn"}
	require.NoError(t, drainTaskSubmissionDeadLetterFallback(ctx, mockRedis, sender, 1))
	assert.True(t, sender.called)
}

func TestDrainTaskSubmissionDeadLetterFallbackInvalidSequence(t *testing.T) {
	mockRedis := redis.NewMockClient()
	ctx := context.Background()
	require.NoError(t, mockRedis.Set(ctx, dlqFallbackSeqKey, []byte("not-a-number"), time.Minute))

	err := drainTaskSubmissionDeadLetterFallback(ctx, mockRedis, &captureInngest{}, 5)
	require.Error(t, err)
}

func TestDrainTaskSubmissionDeadLetterFallbackProcessesEntries(t *testing.T) {
	mockRedis := withMockRedis(t)
	ctx := context.Background()

	require.NoError(t, mockRedis.Set(ctx, dlqFallbackSeqKey, []byte("1"), time.Hour))
	payload, err := json.Marshal(taskSubmissionDLQPayload{
		TaskID: "task-fallback-2",
		Name:   "task.execute",
		Event:  map[string]any{"taskId": "task-fallback-2"},
	})
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(ctx, dlqFallbackPrefix+"1", payload, time.Hour))

	sender := &captureInngest{id: "evt-fallback-2"}
	require.NoError(t, drainTaskSubmissionDeadLetterFallback(ctx, mockRedis, sender, 5))
	assert.True(t, sender.called)
}

func TestDrainTaskSubmissionDeadLetterBranchCoverage(t *testing.T) {
	ctx := context.Background()

	err := drainTaskSubmissionDeadLetterWithClient(ctx, &captureInngest{}, nil)
	require.ErrorContains(t, err, "redis unavailable")

	err = drainTaskSubmissionDeadLetterWithClient(ctx, &captureInngest{}, &redisGetFailClient{MockClient: redis.NewMockClient()})
	require.Error(t, err)

	missingPayloadRedis := &dlqStreamRedisClient{
		MockClient: redis.NewMockClient(),
		messages:   []goredis.XMessage{{ID: "30-0", Values: map[string]any{"other": "value"}}},
	}
	require.NoError(t, drainTaskSubmissionDeadLetterWithClient(ctx, &captureInngest{}, missingPayloadRedis))

	badPayloadRedis := &dlqStreamRedisClient{
		MockClient: redis.NewMockClient(),
		messages:   []goredis.XMessage{{ID: "31-0", Values: map[string]any{"payload": "{"}}},
	}
	require.NoError(t, drainTaskSubmissionDeadLetterWithClient(ctx, &captureInngest{}, badPayloadRedis))

	err = drainTaskSubmissionDeadLetterFallback(ctx, &fallbackCursorErrorRedisClient{MockClient: redis.NewMockClient()}, &captureInngest{}, 5)
	require.ErrorContains(t, err, "cursor failed")

	err = drainTaskSubmissionDeadLetterFallback(ctx, &fallbackEntryGetErrorRedisClient{MockClient: redis.NewMockClient()}, &captureInngest{}, 5)
	require.ErrorContains(t, err, "entry get failed")

	baseRedis := redis.NewMockClient()
	require.NoError(t, baseRedis.Set(ctx, dlqFallbackSeqKey, []byte("1"), time.Minute))
	err = drainTaskSubmissionDeadLetterFallback(ctx, &setErrorRedisClient{MockClient: baseRedis}, &captureInngest{}, 5)
	require.ErrorContains(t, err, "set failed")
}

func TestDrainTaskSubmissionDeadLetterFallbackSendError(t *testing.T) {
	mockRedis := redis.NewMockClient()
	ctx := context.Background()
	require.NoError(t, mockRedis.Set(ctx, dlqFallbackSeqKey, []byte("1"), time.Minute))
	payload := `{"taskId":"task-fallback-send","name":"task.execute","event":{"taskId":"task-fallback-send"}}`
	require.NoError(t, mockRedis.Set(ctx, dlqFallbackPrefix+"1", []byte(payload), time.Minute))

	err := drainTaskSubmissionDeadLetterFallback(ctx, mockRedis, &captureInngest{err: errors.New("send failed")}, 5)
	require.ErrorContains(t, err, "send failed")
}

func TestDrainTaskSubmissionDeadLetterFallbackReplaysEntries(t *testing.T) {
	mockRedis := redis.NewMockClient()
	ctx := context.Background()

	require.NoError(t, mockRedis.Set(ctx, dlqFallbackSeqKey, []byte("2"), time.Minute))
	payload, err := json.Marshal(taskSubmissionDLQPayload{
		TaskID: "task-fallback",
		Name:   "task.execute",
		Event:  map[string]any{"taskId": "task-fallback"},
	})
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(ctx, dlqFallbackPrefix+"1", payload, time.Minute))
	require.NoError(t, mockRedis.Set(ctx, dlqFallbackPrefix+"2", payload, time.Minute))

	sender := &captureInngest{id: "evt-fallback"}
	require.NoError(t, drainTaskSubmissionDeadLetterFallback(ctx, mockRedis, sender, 5))
	assert.True(t, sender.called)
}

func TestDrainTaskSubmissionDeadLetterFallback_DeleteFailureContinues(t *testing.T) {
	mockRedis := &dlqDelFailClient{MockClient: redis.NewMockClient()}
	ctx := context.Background()
	payload := `{"taskId":"task-fb-del","name":"task.execute","event":{"taskId":"task-fb-del"}}`
	_, err := mockRedis.Incr(ctx, dlqFallbackSeqKey)
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(ctx, dlqFallbackPrefix+"1", []byte(payload), dlqTTL))

	sender := &captureInngest{id: "evt-fb-del"}
	require.NoError(t, drainTaskSubmissionDeadLetterFallback(ctx, mockRedis, sender, 5))
}

func TestDrainTaskSubmissionDeadLetterFallback_MaxEntriesZero(t *testing.T) {
	mockRedis := redis.NewMockClient()
	err := drainTaskSubmissionDeadLetterFallback(context.Background(), mockRedis, &captureInngest{}, 0)
	require.NoError(t, err)
}

func TestDrainTaskSubmissionDeadLetterSendErrorPropagates(t *testing.T) {
	payload, err := json.Marshal(taskSubmissionDLQPayload{
		TaskID: "task-send-fail",
		Name:   "task.execute",
		Event:  map[string]any{"taskId": "task-send-fail"},
	})
	require.NoError(t, err)

	mockRedis := &dlqStreamRedisClient{
		MockClient: redis.NewMockClient(),
		messages: []goredis.XMessage{
			{ID: "13-0", Values: map[string]any{"payload": string(payload)}},
		},
	}
	err = drainTaskSubmissionDeadLetterWithClient(context.Background(), &captureInngest{err: errors.New("send failed")}, mockRedis)
	require.Error(t, err)
}

func TestDrainTaskSubmissionDeadLetter_ReplaysBytePayloads(t *testing.T) {
	payload, err := json.Marshal(taskSubmissionDLQPayload{
		TaskID: "task-byte-payload",
		Name:   "task.execute",
		Event:  map[string]any{"taskId": "task-byte-payload"},
	})
	require.NoError(t, err)

	mockRedis := &dlqStreamRedisClient{
		MockClient: redis.NewMockClient(),
		messages: []goredis.XMessage{
			{
				ID: "12-0",
				Values: map[string]any{
					"payload": payload,
				},
			},
		},
	}
	sender := &captureInngest{id: "evt-byte"}
	require.NoError(t, drainTaskSubmissionDeadLetterWithClient(context.Background(), sender, mockRedis))
	assert.True(t, sender.called)
}

func TestDrainTaskSubmissionDeadLetter_ReplaysFallbackEntries(t *testing.T) {
	mockRedis := &xaddErrorRedisClient{MockClient: redis.NewMockClient()}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return mockRedis, nil })

	err := persistTaskSubmissionDeadLetter(context.Background(), "task-fallback", inngestgo.GenericEvent[map[string]any]{
		Name: "task.execute",
		Data: map[string]any{
			"taskId": "task-fallback",
			"userId": 7,
		},
	}, errors.New("queue down"))
	if err != nil {
		t.Fatalf("persist fallback failed: %v", err)
	}

	sender := &captureInngest{id: "evt-fallback"}
	if err := drainTaskSubmissionDeadLetterWithClient(context.Background(), sender, mockRedis); err != nil {
		t.Fatalf("drain should replay fallback entry: %v", err)
	}
	if !sender.called {
		t.Fatalf("expected fallback entry replay to call sender")
	}
}

func TestDrainTaskSubmissionDeadLetter_ReplaysStreamEntries(t *testing.T) {
	payload, err := json.Marshal(taskSubmissionDLQPayload{
		TaskID: "task-stream",
		Name:   "task.execute",
		Event:  map[string]any{"taskId": "task-stream", "userId": 7},
	})
	require.NoError(t, err)

	mockRedis := &dlqStreamRedisClient{
		MockClient: redis.NewMockClient(),
		messages: []goredis.XMessage{
			{
				ID: "10-0",
				Values: map[string]any{
					"payload": string(payload),
				},
			},
		},
	}
	sender := &captureInngest{id: "evt-stream"}
	require.NoError(t, drainTaskSubmissionDeadLetterWithClient(context.Background(), sender, mockRedis))
	assert.True(t, sender.called)
}

func TestDrainTaskSubmissionDeadLetter_SkipsInvalidPayloadTypes(t *testing.T) {
	mockRedis := &dlqStreamRedisClient{
		MockClient: redis.NewMockClient(),
		messages: []goredis.XMessage{
			{ID: "11-0", Values: map[string]any{"payload": 123}},
		},
	}
	require.NoError(t, drainTaskSubmissionDeadLetterWithClient(context.Background(), &captureInngest{id: "evt-none"}, mockRedis))
}

func TestDrainTaskSubmissionDeadLetter_SkipsUnrecognizedPayloadType(t *testing.T) {
	mockRedis := withMockRedis(t)

	ctx := context.Background()
	_, err := mockRedis.XAdd(ctx, dlqStreamName, map[string]any{
		"payload": 12345,
	})
	require.NoError(t, err)

	sender := &captureInngest{id: "evt-dlq-skip"}
	require.NoError(t, drainTaskSubmissionDeadLetterWithClient(ctx, sender, mockRedis))
}

func TestHandleTaskSubmissionIdempotencyExistingTask(t *testing.T) {
	withMockRedis(t)

	registry := &captureRegistry{tasks: map[string]*TaskState{
		"task-existing": {TaskID: "task-existing"},
	}}
	_, reserved, err := reserveTaskSubmissionIdempotency(context.Background(), 7, "key", "task-existing")
	if err != nil || !reserved {
		t.Fatalf("seed reservation: reserved=%v err=%v", reserved, err)
	}

	result, reserved, err := handleTaskSubmissionIdempotency(context.Background(), 7, "key", "task-new", registry)
	require.NoError(t, err)
	if result == nil || result.TaskID != "task-existing" || result.Status != StatusProcessing {
		t.Fatalf("expected existing task result, got %#v", result)
	}
	if reserved {
		t.Fatal("expected existing idempotency result not to reserve")
	}
}

func TestHandleTaskSubmissionIdempotencyRecoverReserveErrorFailsClosed(t *testing.T) {
	mockRedis := &recoverReserveFailAfterReleaseRedis{MockClient: redis.NewMockClient()}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return mockRedis, nil })
	ctx := context.Background()

	_, reserved, err := reserveTaskSubmissionIdempotency(ctx, 7, "recover-fail", "task-old")
	require.NoError(t, err)
	require.True(t, reserved)
	seedStaleTaskSubmissionIdempotency(t, mockRedis, "recover-fail", "task-old")

	result, stillReserved, handleErr := handleTaskSubmissionIdempotency(ctx, 7, "recover-fail", "task-new", &captureRegistry{})
	assert.Nil(t, result)
	assert.False(t, stillReserved)
	require.Error(t, handleErr)
}

func TestHandleTaskSubmissionIdempotencyRecoveredExistingTask(t *testing.T) {
	mockRedis := &idempotencyRebindRedis{MockClient: redis.NewMockClient()}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return mockRedis, nil })
	ctx := context.Background()

	_, reserved, err := reserveTaskSubmissionIdempotency(ctx, 7, "stale-recovered-existing", "gone-task")
	require.NoError(t, err)
	require.True(t, reserved)
	seedStaleTaskSubmissionIdempotency(t, mockRedis, "stale-recovered-existing", "gone-task")

	registry := &captureRegistry{tasks: map[string]*TaskState{
		"still-gone": {TaskID: "still-gone", Status: StatusCompleted},
	}}
	result, stillReserved, handleErr := handleTaskSubmissionIdempotency(ctx, 7, "stale-recovered-existing", "task-new", registry)
	require.NoError(t, handleErr)
	require.NotNil(t, result)
	assert.Equal(t, "still-gone", result.TaskID)
	assert.Equal(t, StatusCompleted, result.Status)
	assert.False(t, stillReserved)
}

func TestHandleTaskSubmissionIdempotencyRecoveredTaskStillRegistered(t *testing.T) {
	withMockRedis(t)
	ctx := context.Background()

	_, reserved, err := reserveTaskSubmissionIdempotency(ctx, 7, "stale-recovered", "task-recovered")
	require.NoError(t, err)
	require.True(t, reserved)

	registry := &captureRegistry{tasks: map[string]*TaskState{
		"task-recovered": {TaskID: "task-recovered", Status: StatusProcessing},
	}}

	result, stillReserved, handleErr := handleTaskSubmissionIdempotency(ctx, 7, "stale-recovered", "task-new", registry)
	require.NoError(t, handleErr)
	require.NotNil(t, result)
	assert.Equal(t, "task-recovered", result.TaskID)
	assert.False(t, stillReserved)
}

func TestHandleTaskSubmissionIdempotencyReserveErrorFailsClosed(t *testing.T) {
	withUnavailableRedis(t, errors.New("redis offline"))

	result, reserved, handleErr := handleTaskSubmissionIdempotency(context.Background(), 7, "key", "task-new", &captureRegistry{})
	assert.Nil(t, result)
	assert.False(t, reserved)
	require.Error(t, handleErr)
}

func TestSubmitTaskIdempotencyStorageFailureDoesNotRegisterOrQueue(t *testing.T) {
	withUnavailableRedis(t, errors.New("redis offline"))
	registry := &captureRegistry{}
	sender := &captureInngest{}

	_, err := SubmitTask(context.Background(), TaskSubmissionRequest{
		UserID:         7,
		Prompt:         "do work",
		ModelID:        "gpt",
		IdempotencyKey: "dedupe-me",
	}, TaskSubmissionDeps{Registry: registry, Inngest: sender})
	require.Error(t, err)
	var submissionErr *TaskSubmissionError
	require.ErrorAs(t, err, &submissionErr)
	assert.Equal(t, TaskSubmissionStorage, submissionErr.Code)
	assert.False(t, registry.called)
	assert.False(t, sender.called)
}

func TestHandleTaskSubmissionIdempotencyReturnsExistingRegisteredTask(t *testing.T) {
	mockRedis := withMockRedis(t)
	ctx := context.Background()

	require.NoError(t, mockRedis.Set(ctx, taskSubmissionIdempotencyKey(7, "existing-key"), []byte("task-existing"), time.Minute))
	registry := &captureRegistry{tasks: map[string]*TaskState{
		"task-existing": {TaskID: "task-existing", Status: StatusProcessing},
	}}

	result, reserved, handleErr := handleTaskSubmissionIdempotency(ctx, 7, "existing-key", "task-new", registry)
	require.NoError(t, handleErr)
	require.NotNil(t, result)
	assert.Equal(t, "task-existing", result.TaskID)
	assert.False(t, reserved)
}

func TestHandleTaskSubmissionIdempotencyReturnsExistingCompletedStatus(t *testing.T) {
	mockRedis := withMockRedis(t)
	ctx := context.Background()

	require.NoError(t, mockRedis.Set(ctx, taskSubmissionIdempotencyKey(7, "done-key"), []byte("task-done"), time.Minute))
	registry := &captureRegistry{tasks: map[string]*TaskState{
		"task-done": {TaskID: "task-done", Status: StatusCompleted},
	}}

	result, reserved, handleErr := handleTaskSubmissionIdempotency(ctx, 7, "done-key", "task-new", registry)
	require.NoError(t, handleErr)
	require.NotNil(t, result)
	assert.Equal(t, "task-done", result.TaskID)
	assert.Equal(t, StatusCompleted, result.Status)
	assert.False(t, reserved)
}

func TestHandleTaskSubmissionIdempotencyReturnsExistingTask(t *testing.T) {
	withMockRedis(t)

	registry := &captureRegistry{tasks: map[string]*TaskState{
		"task-existing": {TaskID: "task-existing", Status: StatusProcessing},
	}}
	_, reserved, err := reserveTaskSubmissionIdempotency(context.Background(), 7, "idem-key", "task-existing")
	require.NoError(t, err)
	require.True(t, reserved)

	result, stillReserved, handleErr := handleTaskSubmissionIdempotency(context.Background(), 7, "idem-key", "task-new", registry)
	require.NoError(t, handleErr)
	require.NotNil(t, result)
	assert.Equal(t, "task-existing", result.TaskID)
	assert.False(t, stillReserved)
}

func TestHandleTaskSubmissionIdempotencyStaleReleaseDelFailureFailsClosed(t *testing.T) {
	mockRedis := &idempotencyDelFailRedis{MockClient: redis.NewMockClient()}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return mockRedis, nil })
	ctx := context.Background()

	_, reserved, err := reserveTaskSubmissionIdempotency(ctx, 7, "stale-release-fail", "task-old")
	require.NoError(t, err)
	require.True(t, reserved)
	seedStaleTaskSubmissionIdempotency(t, mockRedis, "stale-release-fail", "task-old")

	result, stillReserved, handleErr := handleTaskSubmissionIdempotency(ctx, 7, "stale-release-fail", "task-new", &captureRegistry{})
	assert.Nil(t, result)
	assert.False(t, stillReserved)
	require.Error(t, handleErr)
}

func TestHandleTaskSubmissionIdempotencyStaleReleaseFailureContinues(t *testing.T) {
	mockRedis := withMockRedis(t)
	ctx := context.Background()

	_, reserved, err := reserveTaskSubmissionIdempotency(ctx, 7, "stale-release", "task-old")
	require.NoError(t, err)
	require.True(t, reserved)
	seedStaleTaskSubmissionIdempotency(t, mockRedis, "stale-release", "task-old")

	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	result, stillReserved, handleErr := handleTaskSubmissionIdempotency(ctx, 7, "stale-release", "task-new", registry)
	require.NoError(t, handleErr)
	assert.Nil(t, result)
	assert.True(t, stillReserved)
}

func TestHandleTaskSubmissionIdempotencyStillPointsToStaleTask(t *testing.T) {
	mockRedis := &idempotencyRebindRedis{MockClient: redis.NewMockClient()}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return mockRedis, nil })
	ctx := context.Background()

	_, reserved, err := reserveTaskSubmissionIdempotency(ctx, 7, "stale-still", "gone-task")
	require.NoError(t, err)
	require.True(t, reserved)
	seedStaleTaskSubmissionIdempotency(t, mockRedis, "stale-still", "gone-task")

	registry := &captureRegistry{tasks: map[string]*TaskState{}}
	result, stillReserved, handleErr := handleTaskSubmissionIdempotency(ctx, 7, "stale-still", "task-new", registry)
	assert.Nil(t, result)
	assert.False(t, stillReserved)
	require.Error(t, handleErr)
	assert.True(t, mockRedis.released)
}

func TestHandleTaskSubmissionIdempotencyKeepsFreshPendingReservation(t *testing.T) {
	withMockRedis(t)
	ctx := context.Background()

	_, reserved, err := reserveTaskSubmissionIdempotency(ctx, 7, "pending", "task-first")
	require.NoError(t, err)
	require.True(t, reserved)

	result, stillReserved, handleErr := handleTaskSubmissionIdempotency(ctx, 7, "pending", "task-second", &captureRegistry{})
	require.NoError(t, handleErr)
	require.NotNil(t, result)
	assert.Equal(t, "task-first", result.TaskID)
	assert.Equal(t, StatusProcessing, result.Status)
	assert.False(t, stillReserved)
}

func TestReleaseTaskSubmissionIdempotencyDoesNotDeleteAnotherOwner(t *testing.T) {
	mockRedis := withMockRedis(t)
	ctx := context.Background()

	_, reserved, err := reserveTaskSubmissionIdempotency(ctx, 7, "owned", "task-first")
	require.NoError(t, err)
	require.True(t, reserved)
	encoded, err := json.Marshal(taskSubmissionIdempotencyReservation{TaskID: "task-second", CreatedAt: time.Now().UnixMilli()})
	require.NoError(t, err)
	require.NoError(t, mockRedis.Set(ctx, taskSubmissionIdempotencyKey(7, "owned"), encoded, time.Minute))

	require.NoError(t, releaseTaskSubmissionIdempotency(ctx, 7, "owned", "task-first"))
	existingTaskID, reserved, err := reserveTaskSubmissionIdempotency(ctx, 7, "owned", "task-third")
	require.NoError(t, err)
	assert.False(t, reserved)
	assert.Equal(t, "task-second", existingTaskID)
}

func TestHandleTaskSubmissionIdempotency_ReturnsExistingRegisteredTaskDirect(t *testing.T) {
	withMockRedis(t)

	registry := &captureRegistry{tasks: map[string]*TaskState{
		"task-dedupe": {TaskID: "task-dedupe", Status: StatusProcessing},
	}}
	_, reserved, err := reserveTaskSubmissionIdempotency(context.Background(), 9, "dedupe-key", "task-dedupe")
	require.NoError(t, err)
	require.True(t, reserved)

	result, stillReserved, handleErr := handleTaskSubmissionIdempotency(context.Background(), 9, "dedupe-key", "task-new", registry)
	require.NoError(t, handleErr)
	require.NotNil(t, result)
	assert.Equal(t, "task-dedupe", result.TaskID)
	assert.False(t, stillReserved)
}

func TestIsRetryableInngestError(t *testing.T) {
	assert.False(t, isRetryableInngestError(nil))
	assert.True(t, isRetryableInngestError(context.DeadlineExceeded))
	assert.False(t, isRetryableInngestError(context.Canceled))
	assert.True(t, isRetryableInngestError(errors.New("upstream timeout while sending")))
	assert.True(t, isRetryableInngestError(errors.New("HTTP 503 service unavailable")))
	assert.False(t, isRetryableInngestError(errors.New("validation failed")))
}

func TestLoadTaskSubmissionDLQCursor(t *testing.T) {
	cursor, err := loadTaskSubmissionDLQCursor(context.Background(), dlqCursorClient{value: "12-0"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cursor != "12-0" {
		t.Fatalf("unexpected cursor: %s", cursor)
	}

	cursor, err = loadTaskSubmissionDLQCursor(context.Background(), dlqCursorClient{value: "   "})
	if err != nil {
		t.Fatalf("unexpected error for blank cursor: %v", err)
	}
	if cursor != "0-0" {
		t.Fatalf("expected default cursor for blank value, got %s", cursor)
	}

	cursor, err = loadTaskSubmissionDLQCursor(context.Background(), dlqCursorClient{err: errors.New("key not found")})
	if err != nil {
		t.Fatalf("unexpected error for missing key: %v", err)
	}
	if cursor != "0-0" {
		t.Fatalf("expected default cursor for missing key, got %s", cursor)
	}

	_, err = loadTaskSubmissionDLQCursor(context.Background(), dlqCursorClient{err: errors.New("redis unavailable")})
	if err == nil {
		t.Fatal("expected error for unexpected redis error")
	}
}

func TestLoadTaskSubmissionDLQSequence_ParseError(t *testing.T) {
	mockRedis := redis.NewMockClient()
	require.NoError(t, mockRedis.Set(context.Background(), "seq-key", []byte("not-a-number"), time.Minute))
	_, err := loadTaskSubmissionDLQSequence(context.Background(), mockRedis, "seq-key")
	require.Error(t, err)
}

func TestMakeTaskIDUsesInjectedGenerator(t *testing.T) {
	assert.Equal(t, "pref-abc", makeTaskID("pref-", func(prefix string) string {
		return prefix + "abc"
	}))
}

func TestMakeTaskID_DefaultGenerator(t *testing.T) {
	taskID := makeTaskID("task_", nil)
	if !strings.HasPrefix(taskID, "task_") {
		t.Fatalf("expected default task id to include prefix, got %s", taskID)
	}
}

func TestPersistTaskSubmissionDeadLetterFallbackSet(t *testing.T) {
	mockRedis := &xAddFailRedis{MockClient: redis.NewMockClient()}
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return mockRedis, nil })

	err := persistTaskSubmissionDeadLetter(context.Background(), "task-xadd-fallback", inngestgo.GenericEvent[map[string]any]{
		Name: "task.execute",
		Data: map[string]any{"taskId": "task-xadd-fallback"},
	}, errors.New("send failed"))
	require.NoError(t, err)
}

func TestPersistTaskSubmissionDeadLetterNilRedis(t *testing.T) {
	withUnavailableRedis(t, nil)

	err := persistTaskSubmissionDeadLetter(context.Background(), "task-nil-redis", inngestgo.GenericEvent[map[string]any]{
		Name: "task.execute",
	}, errors.New("failed"))
	require.Error(t, err)
}

func TestSendTaskEventWithResilienceSuccess(t *testing.T) {
	sender := &captureInngest{id: "evt-resilience"}
	err := sendTaskEventWithResilience(context.Background(), sender, inngestgoEvent("task-resilience"))
	require.NoError(t, err)
	assert.True(t, sender.called)
}
