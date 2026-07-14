package taskregistry

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/TaskForceAI/go-engine/pkg/run/internal/redisutil"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/retry"
	goredis "github.com/redis/go-redis/v9"
)

//go:embed lua/mark_started.lua
var markStartedScript string

var registryRedisClientGetterWithRetry = redis.GetClient

func (r *TaskRegistry) MarkStarted(taskID string) bool {
	started, err := r.MarkStartedWithError(taskID)
	if err != nil {
		slog.Error("[Registry] Failed to mark task started", "taskId", taskID, "error", err)
	}
	return started
}

func (r *TaskRegistry) MarkStartedWithError(taskID string) (bool, error) {
	msCtx, msCancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer msCancel()

	client, err := getRedisClientWithRetry(msCtx)
	if err != nil {
		return false, fmt.Errorf("redis unavailable for mark started: %w", err)
	}

	key := taskStateKey(taskID)
	ctx := msCtx

	if redisutil.SupportsEval(client) {
		started, err := r.markStartedWithScript(ctx, client, key)
		if err == nil {
			return started, nil
		}
		if !isEvalUnavailableError(err) {
			return false, err
		}
		slog.Warn("[Registry] Falling back to WATCH for mark started", "taskId", taskID, "error", err)
	}

	return r.markStartedWithWatch(ctx, client, taskID, key)
}

func (r *TaskRegistry) markStartedWithScript(ctx context.Context, client redis.Cmdable, key string) (bool, error) {
	updatedAt := time.Now().Unix()
	ttlSeconds := int(TaskTTL.Seconds())
	err := retry.Do(ctx, retry.Config{
		MaxAttempts:     markStartedMaxWatchRetries,
		InitialInterval: 50 * time.Millisecond,
		MaxInterval:     1 * time.Second,
		Multiplier:      2,
		MaxJitter:       100 * time.Millisecond,
		Retryable:       isRetryableRegistryError,
	}, func(ctx context.Context) error {
		_, err := client.Eval(ctx, markStartedScript, []string{key}, updatedAt, ttlSeconds).Result()
		return err
	})
	if err == nil {
		return true, nil
	}

	msg := err.Error()
	if isExpectedMarkStartedNoopError(msg) {
		return false, nil
	}
	if isMarkStartedValidationError(msg) {
		return false, fmt.Errorf("mark_started validation failed: %w", err)
	}
	return false, err
}

func isExpectedMarkStartedNoopError(message string) bool {
	switch message {
	case "task not found", "task not processing", "task already started":
		return true
	default:
		return false
	}
}

func isMarkStartedValidationError(message string) bool {
	switch message {
	case "invalid args", "corrupt task data", "invalid updatedAt", "invalid ttl":
		return true
	default:
		return false
	}
}

func isEvalUnavailableError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "redis eval operations require REDIS_URL") ||
		strings.Contains(message, "mock does not support eval")
}

func (r *TaskRegistry) markStartedWithWatch(ctx context.Context, client redis.Cmdable, taskID, key string) (bool, error) {
	markStartedWithWatch := func() error {
		// Use Watch for optimistic locking
		return client.Watch(ctx, func(tx *goredis.Tx) error {
			val, err := tx.Get(ctx, key).Result()
			if err != nil {
				return err
			}

			var task TaskState
			if err := json.Unmarshal([]byte(val), &task); err != nil {
				return err
			}

			now := time.Now().Unix()
			if task.Status != StatusProcessing {
				return errTaskNotProcessing
			}
			if task.Started && now-task.UpdatedAt < 30 {
				return errTaskAlreadyStarted
			}

			task.Started = true
			task.UpdatedAt = now
			data, _ := json.Marshal(task)

			_, err = tx.TxPipelined(ctx, func(pipe goredis.Pipeliner) error {
				pipe.Set(ctx, key, data, TaskTTL)
				return nil
			})
			return err
		}, key)
	}

	for attempt := 1; ; attempt++ {
		err := markStartedWithWatch()
		if err == nil {
			return true, nil
		}
		if isWatchUnavailableError(err) {
			// Fallback when the Redis connection does not support WATCH.
			started, fallbackErr := r.markStartedWithSetNXLock(ctx, taskID)
			return started, fallbackErr
		}
		if errors.Is(err, errTaskNotProcessing) || errors.Is(err, errTaskAlreadyStarted) {
			return false, nil
		}
		if errors.Is(err, goredis.TxFailedErr) {
			if attempt >= markStartedMaxWatchRetries {
				slog.Warn(
					"Task takeover conflict detected after retries",
					"taskId",
					taskID,
					"attempts",
					attempt,
				)
				return false, nil
			}
			backoff := time.Duration(attempt*attempt) * 10 * time.Millisecond
			slog.Warn("Task takeover conflict detected, retrying", "taskId", taskID, "attempt", attempt, "backoffMs", backoff.Milliseconds())
			time.Sleep(backoff)
			continue
		}
		if isRetryableRegistryError(err) && attempt < markStartedMaxWatchRetries {
			backoff := time.Duration(attempt*attempt) * 20 * time.Millisecond
			time.Sleep(backoff)
			continue
		}
		return false, err
	}
}

func isWatchUnavailableError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "watch operations require REDIS_URL") ||
		strings.Contains(message, "mock does not support watch")
}

func isRetryableRegistryError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, goredis.TxFailedErr) {
		return true
	}
	message := strings.ToLower(err.Error())
	retryableTokens := []string{
		"timeout",
		"temporarily unavailable",
		"connection reset",
		"connection refused",
		"broken pipe",
		"eof",
		"i/o timeout",
	}
	for _, token := range retryableTokens {
		if strings.Contains(message, token) {
			return true
		}
	}
	return false
}

func (r *TaskRegistry) watchUpdate(parentCtx context.Context, taskID string, updateFn func(*TaskState) error) error {
	client, err := redis.GetClient()
	if err != nil || client == nil {
		if err != nil {
			return fmt.Errorf("redis unavailable: %w", err)
		}
		return errors.New("redis unavailable: client is nil")
	}

	key := taskStateKey(taskID)
	// context.WithTimeout inherits the parent's deadline: if the parent context has
	// less than persistenceTimeout remaining, the child will expire sooner.
	ctx, cancel := context.WithTimeout(parentCtx, persistenceTimeout)
	defer cancel()

	updateWithWatch := func() error {
		err := client.Watch(ctx, func(tx *goredis.Tx) error {
			val, err := tx.Get(ctx, key).Result()
			if err != nil {
				return err
			}

			var task TaskState
			if err := json.Unmarshal([]byte(val), &task); err != nil {
				return err
			}

			if err := updateFn(&task); err != nil {
				if errors.Is(err, errTaskUnchanged) {
					return nil
				}
				return err
			}

			data, _ := json.Marshal(task)

			_, err = tx.TxPipelined(ctx, func(pipe goredis.Pipeliner) error {
				pipe.Set(ctx, key, data, TaskTTL)
				return nil
			})
			return err
		}, key)

		if isWatchUnavailableError(err) {
			return r.updateWithFallbackLock(ctx, client, taskID, updateFn)
		}
		return err
	}

	return retry.Do(ctx, retry.Config{
		MaxAttempts:     markStartedMaxWatchRetries,
		InitialInterval: 50 * time.Millisecond,
		MaxInterval:     1 * time.Second,
		Multiplier:      2,
		MaxJitter:       100 * time.Millisecond,
		Retryable: func(err error) bool {
			return errors.Is(err, goredis.TxFailedErr) || isRetryableRegistryError(err)
		},
	}, func(ctx context.Context) error {
		return updateWithWatch()
	})
}

func (r *TaskRegistry) updateWithFallbackLock(
	ctx context.Context,
	client redis.Cmdable,
	taskID string,
	updateFn func(*TaskState) error,
) error {
	// Fallback for mocks/REST-only clients (atomicity via SETNX lock)
	lockKey := taskUpdateLockKey(taskID)
	acquired, lockErr := client.SetNX(ctx, lockKey, []byte("1"), 5*time.Second)
	if lockErr != nil {
		return lockErr
	}
	if !acquired {
		return fmt.Errorf("failed to acquire update lock")
	}
	defer func() {
		if _, delErr := client.Del(ctx, lockKey); delErr != nil {
			slog.Warn("Failed to release fallback update lock", "taskId", taskID, "error", delErr)
		}
	}()

	task := r.getWithContext(ctx, taskID)
	if task == nil {
		return fmt.Errorf("task not found: %s", taskID)
	}
	if err := updateFn(task); err != nil {
		if errors.Is(err, errTaskUnchanged) {
			return nil
		}
		return err
	}
	return r.saveWithParentContext(ctx, task)
}

func getRedisClientWithRetry(ctx context.Context) (redis.Cmdable, error) {
	var client redis.Cmdable
	err := retry.Do(ctx, retry.Config{
		MaxAttempts:     3,
		InitialInterval: 100 * time.Millisecond,
		MaxInterval:     1 * time.Second,
		Multiplier:      2,
		MaxJitter:       100 * time.Millisecond,
		Retryable:       isRetryableRegistryError,
	}, func(_ context.Context) error {
		redisClient, clientErr := registryRedisClientGetterWithRetry()
		if clientErr != nil {
			return clientErr
		}
		client = redisClient
		return nil
	})
	if err != nil {
		return nil, err
	}
	if client == nil {
		return nil, errors.New("redis client is nil")
	}
	return client, nil
}

func (r *TaskRegistry) markStartedWithSetNXLock(parentCtx context.Context, taskID string) (bool, error) {
	lockCtx, lockCancel := context.WithTimeout(parentCtx, persistenceTimeout)
	defer lockCancel()

	client, err := getRedisClientWithRetry(lockCtx)
	if err != nil {
		return false, fmt.Errorf("failed to get redis client for fallback lock: %w", err)
	}

	ctx := lockCtx
	lockKey := taskStartLockKey(taskID)
	acquired, err := client.SetNX(ctx, lockKey, []byte("1"), 5*time.Second)
	if err != nil {
		slog.Warn("Failed to acquire fallback start lock", "taskId", taskID, "error", err)
		return false, err
	}
	if !acquired {
		return false, nil
	}
	defer func() {
		if _, delErr := client.Del(ctx, lockKey); delErr != nil {
			slog.Warn("Failed to release fallback start lock", "taskId", taskID, "error", delErr)
		}
	}()

	task := r.getWithContext(ctx, taskID)
	if task == nil || task.Status != StatusProcessing {
		return false, nil
	}
	if task.Started && time.Now().Unix()-task.UpdatedAt < 30 {
		return false, nil
	}

	task.Started = true
	task.UpdatedAt = time.Now().Unix()
	if err := r.saveWithParentContext(ctx, task); err != nil {
		err = fmt.Errorf("mark_started task %s: %w", task.TaskID, err)
		slog.Error("[Registry] Failed to persist task state", "taskId", task.TaskID, "operation", "mark_started", "error", err)
		return false, err
	}
	return true, nil
}
