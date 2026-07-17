package taskregistry

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/TaskForceAI/infrastructure/resilience/pkg/retry"
)

//go:embed lua/update_progress.lua
var updateProgressScript string

var progressNullJSON = []byte("null")

func (r *TaskRegistry) UpdateProgress(taskID string, agentStatuses, toolEvents any, budgetUsage *BudgetUsage) error {
	ctx, upCancel := context.WithTimeout(context.Background(), persistenceTimeout)
	defer upCancel()
	client, err := getRedisClientWithRetry(ctx)
	if err != nil {
		return err
	}

	asJSON := progressNullJSON
	if agentStatuses != nil {
		asJSON, err = json.Marshal(agentStatuses)
		if err != nil {
			return fmt.Errorf("marshal agentStatuses: %w", err)
		}
	}
	teJSON := progressNullJSON
	if toolEvents != nil {
		teJSON, err = json.Marshal(toolEvents)
		if err != nil {
			return fmt.Errorf("marshal toolEvents: %w", err)
		}
	}
	buJSON := progressNullJSON
	if budgetUsage != nil {
		buJSON, err = json.Marshal(budgetUsage)
		if err != nil {
			return fmt.Errorf("marshal budgetUsage: %w", err)
		}
	}
	now := time.Now()
	updatedAt := now.Unix()
	progressVersion := nextProgressVersion(now)
	ttlSeconds := int(TaskTTL.Seconds())

	if evalSupport, ok := client.(interface{ SupportsEval() bool }); ok && !evalSupport.SupportsEval() {
		return r.updateProgressLegacy(taskID, agentStatuses, toolEvents, budgetUsage)
	}

	err = retry.Do(ctx, retry.Config{
		MaxAttempts:     3,
		InitialInterval: 50 * time.Millisecond,
		Retryable:       isRetryableRegistryError,
	}, func(ctx context.Context) error {
		_, err := client.Eval(ctx, updateProgressScript, []string{taskStateKey(taskID)},
			asJSON,
			teJSON,
			buJSON,
			updatedAt,
			ttlSeconds,
			progressVersion,
		).Result()

		if err != nil {
			return err
		}

		return nil
	})

	if err != nil {
		msg := err.Error()
		// go-redis surfaces Lua {err=...} returns as Go errors directly.
		if isExpectedUpdateProgressNoopError(msg) {
			return nil
		}
		if isUpdateProgressValidationError(msg) {
			return fmt.Errorf("update_progress validation failed: %w", err)
		}
		if strings.Contains(msg, "redis eval operations require REDIS_URL") {
			return r.updateProgressLegacy(taskID, agentStatuses, toolEvents, budgetUsage)
		}
		slog.Error("[Registry] Atomic UpdateProgress failed", "taskId", taskID, "error", err)
		// Log the Lua error explicitly so the root cause is visible before the fallback masks it.
		slog.Warn("[Registry] Falling back to legacy progress update due to Lua script failure", "taskId", taskID, "luaError", err)
		// Fallback to non-atomic if Lua fails (e.g. mock or old Redis version)
		return r.updateProgressLegacy(taskID, agentStatuses, toolEvents, budgetUsage)
	}

	return nil
}

func (r *TaskRegistry) updateProgressLegacy(taskID string, agentStatuses, toolEvents any, budgetUsage *BudgetUsage) error {
	task := r.Get(taskID)
	// Crucial: Don't allow progress updates to overwrite a finished task
	if task == nil || task.Status != StatusProcessing {
		return nil
	}
	now := time.Now()
	if agentStatuses != nil {
		task.AgentStatuses = agentStatuses
	}
	if toolEvents != nil {
		task.ToolEvents = toolEvents
	}
	task.BudgetUsage = budgetUsage
	markTaskUpdated(task, now)

	return r.saveWithContext(task, "update_progress_legacy")
}
