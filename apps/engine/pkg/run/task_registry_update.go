package run

import (
	"context"
	"log/slog"
	"time"
)

func (r *TaskRegistry) Heartbeat(ctx context.Context, taskID string) error {
	return r.watchUpdate(ctx, taskID, func(task *TaskState) error {
		if task.Status != StatusProcessing {
			return errTaskUnchanged // Don't heartbeat if not processing
		}
		task.UpdatedAt = time.Now().Unix()
		return nil
	})
}

func (r *TaskRegistry) Update(ctx context.Context, taskID string, status TaskStatus, result, errStr string) error {
	return r.UpdateWithConversation(ctx, taskID, status, result, errStr, 0, "")
}

func (r *TaskRegistry) UpdateWithConversation(ctx context.Context, taskID string, status TaskStatus, result, errStr string, conversationID int32, traceID string) error {
	err := r.watchUpdate(ctx, taskID, func(task *TaskState) error {
		if isTerminalTaskStatus(task.Status) {
			changed := false
			if conversationID != 0 && task.ConversationID == 0 {
				task.ConversationID = conversationID
				changed = true
			}
			if traceID != "" && task.TraceID == "" {
				task.TraceID = traceID
				changed = true
			}
			if errStr != "" && task.Error == "" {
				task.Error = errStr
				changed = true
			}
			if changed {
				markTaskUpdated(task, time.Now())
				return nil
			}
			return errTaskUnchanged
		}
		task.Status = status
		task.Result = result
		task.Error = errStr
		markTaskUpdated(task, time.Now())
		if conversationID != 0 {
			task.ConversationID = conversationID
		}
		if traceID != "" {
			task.TraceID = traceID
		}
		return nil
	})
	if err != nil {
		return err
	}
	if isTerminalTaskStatus(status) {
		task := r.getWithContext(ctx, taskID)
		if task != nil {
			if indexErr := updateActiveTaskIndex(ctx, task.UserID, taskID, false); indexErr != nil {
				slog.Warn("Failed to remove terminal task from active index", "taskId", taskID, "error", indexErr)
			}
		}
	}
	return nil
}

func (r *TaskRegistry) UpdateWithApproval(ctx context.Context, taskID string, approval *PendingApproval) error {
	return r.watchUpdate(ctx, taskID, func(task *TaskState) error {
		if task.Status != StatusProcessing {
			return errTaskNotProcessing
		}
		task.Status = StatusAwaiting
		task.PendingApproval = approval
		markTaskUpdated(task, time.Now())
		return nil
	})
}

func (r *TaskRegistry) ClearApproval(ctx context.Context, taskID string) error {
	return r.watchUpdate(ctx, taskID, func(task *TaskState) error {
		if task.Status != StatusAwaiting {
			return errTaskUnchanged // Already cleared or terminal
		}
		task.Status = StatusProcessing
		task.PendingApproval = nil
		markTaskUpdated(task, time.Now())
		return nil
	})
}

func markTaskUpdated(task *TaskState, now time.Time) {
	task.UpdatedAt = now.Unix()
	task.ProgressVersion = nextProgressVersion(now)
}
