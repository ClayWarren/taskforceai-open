package run

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"sync"

	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

var activeTaskIndexLocks sync.Map

const activeTaskIndexMaxIDs = 200

//go:embed lua/update_active_task_index.lua
var updateActiveTaskIndexScript string

func activeTaskIndexKey(userID int) string {
	return "task:user:" + strconv.Itoa(userID) + ":active"
}

func taskStateKey(taskID string) string {
	return "task:" + taskID
}

func taskStartLockKey(taskID string) string {
	return "task:start_lock:" + taskID
}

func taskUpdateLockKey(taskID string) string {
	return "task:update_lock:" + taskID
}

func activeTaskIndexLock(userID int) *sync.Mutex {
	lock, _ := activeTaskIndexLocks.LoadOrStore(userID, &sync.Mutex{})
	mutex, ok := lock.(*sync.Mutex)
	if !ok {
		replacement := &sync.Mutex{}
		activeTaskIndexLocks.Store(userID, replacement)
		return replacement
	}
	return mutex
}

func updateActiveTaskIndex(ctx context.Context, userID int, taskID string, active bool) error {
	if userID == 0 || taskID == "" {
		return nil
	}

	lock := activeTaskIndexLock(userID)
	lock.Lock()
	defer lock.Unlock()

	client, err := getRedisClientWithRetry(ctx)
	if err != nil {
		return fmt.Errorf("redis unavailable for active task index: %w", err)
	}

	key := activeTaskIndexKey(userID)
	if supportsRedisEval(client) {
		if err := updateActiveTaskIndexWithScript(ctx, client, key, taskID, active); err == nil {
			return nil
		} else if !isEvalUnavailableError(err) {
			return fmt.Errorf("update active task index script: %w", err)
		}
	}

	taskIDs := make([]string, 0)
	rawIndex, getErr := client.Get(ctx, key)
	if getErr == nil && rawIndex != "" {
		if err := json.Unmarshal([]byte(rawIndex), &taskIDs); err != nil {
			return fmt.Errorf("decode active task index: %w", err)
		}
	} else if getErr != nil && !isRedisKeyNotFoundError(getErr) {
		return fmt.Errorf("get active task index: %w", getErr)
	}

	nextTaskIDs := make([]string, 0, len(taskIDs)+1)
	seen := false
	for _, existingTaskID := range taskIDs {
		if existingTaskID == taskID {
			seen = true
			if !active {
				continue
			}
		}
		nextTaskIDs = append(nextTaskIDs, existingTaskID)
	}
	if active && !seen {
		nextTaskIDs = append(nextTaskIDs, taskID)
	}
	if len(nextTaskIDs) > activeTaskIndexMaxIDs {
		nextTaskIDs = nextTaskIDs[len(nextTaskIDs)-activeTaskIndexMaxIDs:]
	}

	data, _ := json.Marshal(nextTaskIDs) //nolint:errchkjson // A string slice is always JSON-encodable.
	if err := client.Set(ctx, key, data, TaskTTL); err != nil {
		return fmt.Errorf("save active task index: %w", err)
	}
	return nil
}

func updateActiveTaskIndexWithScript(ctx context.Context, client redis.Cmdable, key, taskID string, active bool) error {
	activeArg := 0
	if active {
		activeArg = 1
	}
	_, err := client.Eval(
		ctx,
		updateActiveTaskIndexScript,
		[]string{key},
		taskID,
		activeArg,
		int(TaskTTL.Seconds()),
		activeTaskIndexMaxIDs,
	).Result()
	return err
}

func removeActiveTaskIDs(ctx context.Context, userID int, taskIDs []string) error {
	if userID == 0 || len(taskIDs) == 0 {
		return nil
	}

	remove := make(map[string]struct{}, len(taskIDs))
	for _, taskID := range taskIDs {
		if taskID != "" {
			remove[taskID] = struct{}{}
		}
	}
	if len(remove) == 0 {
		return nil
	}

	lock := activeTaskIndexLock(userID)
	lock.Lock()
	defer lock.Unlock()

	client, err := getRedisClientWithRetry(ctx)
	if err != nil {
		return fmt.Errorf("redis unavailable for active task index: %w", err)
	}

	key := activeTaskIndexKey(userID)
	rawIndex, getErr := client.Get(ctx, key)
	if getErr != nil {
		if isRedisKeyNotFoundError(getErr) {
			return nil
		}
		return fmt.Errorf("get active task index: %w", getErr)
	}

	var existingTaskIDs []string
	if rawIndex != "" {
		if err := json.Unmarshal([]byte(rawIndex), &existingTaskIDs); err != nil {
			return fmt.Errorf("decode active task index: %w", err)
		}
	}

	nextTaskIDs := existingTaskIDs[:0]
	for _, taskID := range existingTaskIDs {
		if _, shouldRemove := remove[taskID]; shouldRemove {
			continue
		}
		nextTaskIDs = append(nextTaskIDs, taskID)
	}
	if len(nextTaskIDs) == len(existingTaskIDs) {
		return nil
	}

	data, _ := json.Marshal(nextTaskIDs) //nolint:errchkjson // A string slice is always JSON-encodable.
	if err := client.Set(ctx, key, data, TaskTTL); err != nil {
		return fmt.Errorf("save active task index: %w", err)
	}
	return nil
}

func (r *TaskRegistry) ListByUser(ctx context.Context, userID int, opts TaskListOptions) ([]TaskState, error) {
	client, err := getRedisClientWithRetry(ctx)
	if err != nil {
		return nil, fmt.Errorf("redis unavailable for task list: %w", err)
	}

	limit := opts.Limit
	if limit <= 0 || limit > 100 {
		limit = 25
	}

	indexKey := activeTaskIndexKey(userID)
	rawIndex, getErr := client.Get(ctx, indexKey)
	if getErr != nil {
		if isRedisKeyNotFoundError(getErr) {
			return []TaskState{}, nil
		}
		return nil, fmt.Errorf("get active task index: %w", getErr)
	}

	var taskIDs []string
	if err := json.Unmarshal([]byte(rawIndex), &taskIDs); err != nil {
		return nil, fmt.Errorf("decode active task index: %w", err)
	}

	tasks := make([]TaskState, 0, limit)
	staleTaskIDs := make([]string, 0)
	for _, taskID := range taskIDs {
		key := taskStateKey(taskID)
		value, getErr := client.Get(ctx, key)
		if getErr != nil {
			if isRedisKeyNotFoundError(getErr) {
				staleTaskIDs = append(staleTaskIDs, taskID)
				continue
			}
			return nil, fmt.Errorf("get task state: %w", getErr)
		}

		var task TaskState
		if unmarshalErr := json.Unmarshal([]byte(value), &task); unmarshalErr != nil {
			slog.Warn("Skipping corrupt task state while listing tasks", "key", key, "error", unmarshalErr)
			continue
		}
		if task.UserID != userID {
			continue
		}
		if isTerminalTaskStatus(task.Status) {
			staleTaskIDs = append(staleTaskIDs, taskID)
			continue
		}
		tasks = append(tasks, task)
		if len(tasks) >= limit {
			return tasks, nil
		}
	}

	if len(staleTaskIDs) > 0 {
		if err := removeActiveTaskIDs(ctx, userID, staleTaskIDs); err != nil {
			slog.Warn("Failed to prune stale active task IDs", "userId", userID, "error", err)
		}
	}

	return tasks, nil
}
