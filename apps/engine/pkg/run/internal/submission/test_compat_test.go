package submission

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	attachmentcontract "github.com/TaskForceAI/go-engine/pkg/run/attachment"
	attachmentservice "github.com/TaskForceAI/go-engine/pkg/run/internal/attachments"
	taskcontract "github.com/TaskForceAI/go-engine/pkg/run/task"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/inngest/inngestgo"
	goredis "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

type Attachments = attachmentcontract.Collection
type FileAttachment = attachmentcontract.File
type AttachmentInfo = attachmentcontract.Info
type genericEvent = inngestgo.GenericEvent[map[string]any]

const (
	AttachmentKeyPrefix     = attachmentcontract.CollectionKeyPrefix
	AttachmentMetaKeyPrefix = attachmentcontract.BlobKeyPrefix
	AttachmentInfoKeyPrefix = attachmentcontract.InfoKeyPrefix
	StatusCompleted         = taskcontract.StatusCompleted
	StatusFailed            = taskcontract.StatusFailed
)

var (
	RedisClientGetter                             = redis.GetClient
	marshalTaskSubmissionIdempotency              = json.Marshal
	marshalAttachments                            = json.Marshal
	marshalAttachmentInfo                         = json.Marshal
	executeSubmittedTaskInline       TaskExecutor = func(context.Context, string, int, string, string, OrchestrateTaskOptions) {}
	executeSubmittedTaskBackground   TaskExecutor = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
		adapterhandler.Go("executeSubmittedTask_"+taskID, func() {
			executeSubmittedTaskInline(context.WithoutCancel(ctx), taskID, userID, prompt, modelID, opts)
		})
	}
)

func attachmentDepsForTest() attachmentservice.Dependencies {
	return attachmentservice.Dependencies{
		RedisClient: RedisClientGetter, MarshalCollection: marshalAttachments, MarshalInfo: marshalAttachmentInfo,
	}
}

var StoreAttachments = func(ctx context.Context, attachments Attachments, taskID string) error {
	return attachmentservice.StoreCollection(ctx, attachments, taskID, attachmentTTL, attachmentDepsForTest())
}

var StoreAttachment = func(ctx context.Context, fileID string, data []byte, ttl time.Duration) error {
	return attachmentservice.StoreFile(ctx, fileID, data, ttl, attachmentDepsForTest())
}

var GetAttachment = func(ctx context.Context, fileID string) ([]byte, error) {
	return attachmentservice.GetFile(ctx, fileID, attachmentDepsForTest())
}

func ValidateTaskAttachments(attachments Attachments) error {
	return attachmentservice.ValidateTaskAttachments(attachments)
}

func testSubmissionService() *Service {
	return New(Runtime{
		RedisClient:            RedisClientGetter,
		AcquireExecutionSlot:   acquireTaskExecutionSlot,
		CapacityError:          ErrTaskExecutionCapacity,
		DefaultAttachmentStore: StoreAttachments,
		ExecuteInline:          executeSubmittedTaskInline,
		ExecuteBackground:      executeSubmittedTaskBackground,
		MarshalReservation:     marshalTaskSubmissionIdempotency,
	})
}

func SubmitTask(ctx context.Context, req TaskSubmissionRequest, deps TaskSubmissionDeps) (TaskSubmissionResult, error) {
	return testSubmissionService().Submit(ctx, req, deps)
}

func persistTaskSubmissionDeadLetter(ctx context.Context, taskID string, event genericEvent, cause error) error {
	return testSubmissionService().persistTaskSubmissionDeadLetter(ctx, taskID, event, cause)
}

func reserveTaskSubmissionIdempotency(ctx context.Context, userID int, key, taskID string) (string, bool, error) {
	return testSubmissionService().reserveTaskSubmissionIdempotency(ctx, userID, key, taskID)
}

func releaseTaskSubmissionIdempotency(ctx context.Context, userID int, key string, expectedTaskIDs ...string) error {
	return testSubmissionService().releaseTaskSubmissionIdempotency(ctx, userID, key, expectedTaskIDs...)
}

func taskSubmissionIdempotencyReservationPending(ctx context.Context, userID int, key, taskID string) bool {
	return testSubmissionService().taskSubmissionIdempotencyReservationPending(ctx, userID, key, taskID)
}

func handleTaskSubmissionIdempotency(ctx context.Context, userID int, key, taskID string, registry SubmissionTaskRegistrar) (*TaskSubmissionResult, bool, error) {
	return testSubmissionService().handleTaskSubmissionIdempotency(ctx, userID, key, taskID, registry)
}

func drainTaskSubmissionDeadLetterAsync(ctx context.Context, sender InngestSender) {
	testSubmissionService().drainTaskSubmissionDeadLetterAsync(ctx, sender)
}

func withMockRedis(t *testing.T) *redis.MockClient {
	t.Helper()
	client := redis.NewMockClient()
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return client, nil })
	return client
}

func withUnavailableRedis(t *testing.T, unavailable error) {
	t.Helper()
	setRedisClientGetterForTest(t, func() (redis.Cmdable, error) { return nil, unavailable })
}

func setRedisClientGetterForTest(t *testing.T, getter func() (redis.Cmdable, error)) {
	t.Helper()
	original := RedisClientGetter
	RedisClientGetter = getter
	t.Cleanup(func() { RedisClientGetter = original })
}

func restore[T any](t *testing.T, target *T) {
	t.Helper()
	original := *target
	t.Cleanup(func() { *target = original })
}

type captureRegistry struct {
	called bool
	taskID string
	userID int
	prompt string
	model  string
	opts   OrchestrateTaskOptions
	err    error
	tasks  map[string]*TaskState
}

func (r *captureRegistry) Register(taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) error {
	r.called = true
	r.taskID = taskID
	r.userID = userID
	r.prompt = prompt
	r.model = modelID
	r.opts = opts
	if r.tasks == nil {
		r.tasks = map[string]*TaskState{}
	}
	r.tasks[taskID] = &TaskState{
		TaskID: taskID, Status: StatusProcessing, UserID: userID,
		Prompt: prompt, ModelID: modelID, Options: opts,
	}
	return r.err
}

func (r *captureRegistry) Get(taskID string) *TaskState {
	if r.tasks == nil {
		return nil
	}
	return r.tasks[taskID]
}

type captureInngest struct {
	id     string
	err    error
	called bool
	event  any
}

func (i *captureInngest) Send(_ context.Context, event any) (string, error) {
	i.called = true
	i.event = event
	if i.err != nil {
		return "", i.err
	}
	if i.id == "" {
		return "evt-1", nil
	}
	return i.id, nil
}

type redisGetFailClient struct{ *redis.MockClient }

func (c *redisGetFailClient) Get(context.Context, string) (string, error) {
	return "", errors.New("redis get failed")
}

type releaseFailRedis struct{ *redis.MockClient }

func (c *releaseFailRedis) Del(ctx context.Context, key string) (bool, error) {
	if strings.HasPrefix(key, "run:submit:idempotency:") {
		return false, errors.New("release failed")
	}
	return c.MockClient.Del(ctx, key)
}

type dlqDelFailClient struct{ *redis.MockClient }

func (c *dlqDelFailClient) Del(ctx context.Context, key string) (bool, error) {
	if strings.HasPrefix(key, dlqFallbackPrefix) {
		return false, errors.New("del failed")
	}
	return c.MockClient.Del(ctx, key)
}

type dlqStreamRedisClient struct {
	*redis.MockClient
	messages []goredis.XMessage
}

type cursorAwareDLQStreamRedisClient struct {
	*redis.MockClient
	messages []goredis.XMessage
}

func (c *cursorAwareDLQStreamRedisClient) XRead(_ context.Context, _ string, cursor string, count int64) ([]goredis.XMessage, error) {
	cursorSeq, _ := strconv.Atoi(strings.SplitN(cursor, "-", 2)[0])
	result := make([]goredis.XMessage, 0, count)
	for _, message := range c.messages {
		seq, _ := strconv.Atoi(strings.SplitN(message.ID, "-", 2)[0])
		if seq <= cursorSeq {
			continue
		}
		result = append(result, message)
		if int64(len(result)) == count {
			break
		}
	}
	if len(result) == 0 {
		return nil, errors.New("stream unavailable")
	}
	return result, nil
}

func (c *dlqStreamRedisClient) XRead(context.Context, string, string, int64) ([]goredis.XMessage, error) {
	if len(c.messages) == 0 {
		return nil, errors.New("stream unavailable")
	}
	return c.messages, nil
}

type idempotencyDelFailRedis struct{ *redis.MockClient }

func (c *idempotencyDelFailRedis) Del(ctx context.Context, key string) (bool, error) {
	if strings.HasPrefix(key, "run:submit:idempotency:") {
		return false, errors.New("del failed")
	}
	return c.MockClient.Del(ctx, key)
}

type idempotencyRebindRedis struct {
	*redis.MockClient
	released bool
}

func (c *idempotencyRebindRedis) Del(ctx context.Context, key string) (bool, error) {
	deleted, err := c.MockClient.Del(ctx, key)
	if err == nil && strings.HasPrefix(key, "run:submit:idempotency:") {
		c.released = true
		_ = c.Set(ctx, key, []byte("still-gone"), time.Minute)
	}
	return deleted, err
}

type dlqCursorSetFailRedis struct{ *dlqStreamRedisClient }

func (c *dlqCursorSetFailRedis) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if key == dlqCursorKey {
		return errors.New("cursor persist failed")
	}
	return c.MockClient.Set(ctx, key, value, ttl)
}

type xAddFailRedis struct{ *redis.MockClient }

func (c *xAddFailRedis) XAdd(context.Context, string, map[string]any) (string, error) {
	return "", errors.New("xadd failed")
}

func (c *xAddFailRedis) Incr(ctx context.Context, key string) (int, error) {
	return c.MockClient.Incr(ctx, key)
}

func inngestgoEvent(taskID string) inngestgo.GenericEvent[map[string]any] {
	return inngestgo.GenericEvent[map[string]any]{
		Name: "task.execute",
		Data: map[string]any{"taskId": taskID},
	}
}

func seedStaleTaskSubmissionIdempotency(t *testing.T, client redis.Cmdable, key, taskID string) {
	t.Helper()
	encoded, err := json.Marshal(taskSubmissionIdempotencyReservation{
		TaskID: taskID, CreatedAt: time.Now().Add(-idempotencyPendingWindow - time.Minute).UnixMilli(),
	})
	require.NoError(t, err)
	require.NoError(t, client.Set(context.Background(), taskSubmissionIdempotencyKey(7, key), encoded, idempotencyTTL))
}
