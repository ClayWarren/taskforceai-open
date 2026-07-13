package run

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/retry"
)

var taskRegistryRedisClientGetter = redis.GetClient

func (r *TaskRegistry) save(task *TaskState) error {
	return r.saveWithParentContext(context.Background(), task)
}

func (r *TaskRegistry) saveWithParentContext(parentCtx context.Context, task *TaskState) error {
	data, err := json.Marshal(task)
	if err != nil {
		return fmt.Errorf("marshal task state: %w", err)
	}

	saveCtx, saveCancel := context.WithTimeout(parentCtx, persistenceTimeout)
	defer saveCancel()
	operationErr := retry.Do(saveCtx, retry.Config{
		MaxAttempts:     3,
		InitialInterval: 100 * time.Millisecond,
		MaxInterval:     1 * time.Second,
		Multiplier:      2,
		MaxJitter:       100 * time.Millisecond,
		Retryable:       isRetryableRegistryError,
	}, func(ctx context.Context) error {
		client, clientErr := taskRegistryRedisClientGetter()
		if clientErr != nil {
			return fmt.Errorf("get redis client: %w", clientErr)
		}
		if client == nil {
			return errors.New("redis client is nil")
		}
		if setErr := client.Set(ctx, "task:"+task.TaskID, data, TaskTTL); setErr != nil {
			return fmt.Errorf("save task to redis: %w", setErr)
		}
		return nil
	})
	if operationErr != nil {
		return operationErr
	}
	return nil
}

func (r *TaskRegistry) saveWithContext(task *TaskState, operation string) error {
	if err := r.save(task); err != nil {
		wrapped := fmt.Errorf("%s task %s: %w", operation, task.TaskID, err)
		slog.Error("[Registry] Failed to persist task state", "taskId", task.TaskID, "operation", operation, "error", wrapped)
		return wrapped
	}
	return nil
}

func (r *TaskRegistry) Register(taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) error {
	task := &TaskState{
		TaskID:          taskID,
		Status:          StatusProcessing,
		UserID:          userID,
		Prompt:          prompt,
		ModelID:         modelID,
		Options:         opts,
		Started:         false,
		UpdatedAt:       time.Now().Unix(),
		ProgressVersion: 0,
		Result:          "",
		Error:           "",
		AgentStatuses:   nil,
		ToolEvents:      nil,
		ConversationID:  0,
		TraceID:         "",
		PendingApproval: nil,
		BudgetUsage:     nil,
	}
	if err := r.saveWithContext(task, "register"); err != nil {
		return err
	}
	indexCtx, indexCancel := context.WithTimeout(context.Background(), activeTaskIndexTimeout)
	defer indexCancel()
	if err := updateActiveTaskIndex(indexCtx, userID, taskID, true); err != nil {
		slog.Warn("Failed to add task to active index", "taskId", taskID, "userId", userID, "error", err)
	}
	return nil
}

func (r *TaskRegistry) Get(taskID string) *TaskState {
	return r.getWithContext(context.Background(), taskID)
}

func (r *TaskRegistry) getWithContext(parentCtx context.Context, taskID string) *TaskState {
	client, err := taskRegistryRedisClientGetter()
	if err != nil {
		slog.Error("Failed to get redis client for Get", "error", err)
		return nil
	}
	if client == nil {
		slog.Error("Redis client is nil for Get")
		return nil
	}

	ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
	defer cancel()

	val, err := client.Get(ctx, taskStateKey(taskID))
	if err != nil {
		// Redis error or key doesn't exist
		return nil
	}

	var task TaskState
	if err := json.Unmarshal([]byte(val), &task); err != nil {
		slog.Error("Failed to unmarshal task state", "error", err)
		return nil
	}
	return &task
}
