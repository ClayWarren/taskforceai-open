package submission

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/TaskForceAI/go-engine/pkg/run/internal/redisutil"
)

const idempotencyPendingWindow = 2 * time.Minute

const releaseIdempotencyReservationScript = `
local value = redis.call("GET", KEYS[1])
if not value then
	return 0
end
if value == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
local ok, reservation = pcall(cjson.decode, value)
if ok and type(reservation) == "table" and reservation.taskId == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
return 0
`

type taskSubmissionIdempotencyReservation struct {
	TaskID    string `json:"taskId"`
	CreatedAt int64  `json:"createdAt"`
}

func (s *Service) handleTaskSubmissionIdempotency(
	ctx context.Context,
	userID int,
	idempotencyKey string,
	taskID string,
	registry SubmissionTaskRegistrar,
) (*TaskSubmissionResult, bool, error) {
	existingTaskID, reserved, reserveErr := s.reserveTaskSubmissionIdempotency(ctx, userID, idempotencyKey, taskID)
	if reserveErr != nil {
		return nil, false, fmt.Errorf("reserve idempotency key: %w", reserveErr)
	}
	if reserved {
		return nil, true, nil
	}

	if task := registry.Get(existingTaskID); task != nil {
		return &TaskSubmissionResult{TaskID: existingTaskID, Status: submissionResultStatus(task)}, false, nil
	}
	if s.taskSubmissionIdempotencyReservationPending(ctx, userID, idempotencyKey, existingTaskID) {
		return &TaskSubmissionResult{TaskID: existingTaskID, Status: StatusProcessing}, false, nil
	}

	// Stale key: the previous task record expired before idempotency TTL elapsed.
	// Clear and re-reserve so callers are not locked out for the remainder of TTL.
	if releaseErr := s.releaseTaskSubmissionIdempotency(ctx, userID, idempotencyKey, existingTaskID); releaseErr != nil {
		return nil, false, fmt.Errorf("clear stale idempotency key: %w", releaseErr)
	}

	recoveredTaskID, recovered, recoverErr := s.reserveTaskSubmissionIdempotency(ctx, userID, idempotencyKey, taskID)
	if recoverErr != nil {
		return nil, false, fmt.Errorf("re-reserve stale idempotency key: %w", recoverErr)
	}
	if recovered {
		return nil, true, nil
	}

	if task := registry.Get(recoveredTaskID); task != nil {
		return &TaskSubmissionResult{TaskID: recoveredTaskID, Status: submissionResultStatus(task)}, false, nil
	}

	return nil, false, errors.New("idempotency key still points to stale task")
}

func submissionResultStatus(task *TaskState) TaskStatus {
	if task == nil || task.Status == "" {
		return StatusProcessing
	}
	return task.Status
}

func taskSubmissionIdempotencyKey(userID int, key string) string {
	return fmt.Sprintf("run:submit:idempotency:%d:%s", userID, key)
}

func (s *Service) reserveTaskSubmissionIdempotency(
	ctx context.Context,
	userID int,
	key string,
	taskID string,
) (string, bool, error) {
	redisClient, err := s.runtime.RedisClient()
	if err != nil {
		return "", false, err
	}
	if redisClient == nil {
		return "", false, errors.New("redis unavailable")
	}
	redisKey := taskSubmissionIdempotencyKey(userID, key)
	encoded, err := s.runtime.MarshalReservation(taskSubmissionIdempotencyReservation{TaskID: taskID, CreatedAt: time.Now().UnixMilli()})
	if err != nil {
		return "", false, fmt.Errorf("encode idempotency reservation: %w", err)
	}
	acquired, err := redisClient.SetNX(ctx, redisKey, encoded, idempotencyTTL)
	if err != nil {
		return "", false, err
	}
	if acquired {
		return taskID, true, nil
	}
	rawReservation, err := redisClient.Get(ctx, redisKey)
	if err != nil || strings.TrimSpace(rawReservation) == "" {
		return "", false, fmt.Errorf("failed to resolve existing idempotent task: %w", err)
	}
	return decodeTaskSubmissionIdempotencyReservation(rawReservation).TaskID, false, nil
}

func (s *Service) releaseTaskSubmissionIdempotency(ctx context.Context, userID int, key string, expectedTaskIDs ...string) error {
	redisClient, err := s.runtime.RedisClient()
	if err != nil {
		return err
	}
	if redisClient == nil {
		return errors.New("redis unavailable")
	}
	redisKey := taskSubmissionIdempotencyKey(userID, key)
	if len(expectedTaskIDs) == 0 || strings.TrimSpace(expectedTaskIDs[0]) == "" {
		_, err = redisClient.Del(ctx, redisKey)
		return err
	}
	expectedTaskID := strings.TrimSpace(expectedTaskIDs[0])
	if redisutil.SupportsEval(redisClient) {
		_, err = redisClient.Eval(ctx, releaseIdempotencyReservationScript, []string{redisKey}, expectedTaskID).Result()
		return err
	}
	rawReservation, getErr := redisClient.Get(ctx, redisKey)
	if getErr != nil {
		if redisutil.IsKeyNotFoundError(getErr) {
			return nil
		}
		return getErr
	}
	if decodeTaskSubmissionIdempotencyReservation(rawReservation).TaskID != expectedTaskID {
		return nil
	}
	_, err = redisClient.Del(ctx, redisKey)
	return err
}

func decodeTaskSubmissionIdempotencyReservation(raw string) taskSubmissionIdempotencyReservation {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return taskSubmissionIdempotencyReservation{}
	}
	var reservation taskSubmissionIdempotencyReservation
	if json.Unmarshal([]byte(trimmed), &reservation) == nil && reservation.TaskID != "" {
		return reservation
	}
	return taskSubmissionIdempotencyReservation{TaskID: trimmed}
}

func (s *Service) taskSubmissionIdempotencyReservationPending(ctx context.Context, userID int, key, expectedTaskID string) bool {
	redisClient, err := s.runtime.RedisClient()
	if err != nil || redisClient == nil {
		return false
	}
	rawReservation, err := redisClient.Get(ctx, taskSubmissionIdempotencyKey(userID, key))
	if err != nil {
		return false
	}
	reservation := decodeTaskSubmissionIdempotencyReservation(rawReservation)
	if reservation.TaskID != expectedTaskID || reservation.CreatedAt <= 0 {
		return false
	}
	createdAt := time.UnixMilli(reservation.CreatedAt)
	age := time.Since(createdAt)
	return age >= 0 && age < idempotencyPendingWindow
}
