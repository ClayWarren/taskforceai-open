package stream

import (
	"bytes"
	"log/slog"
	"time"

	"github.com/TaskForceAI/go-engine/pkg/run"
)

const progressRepeatHeartbeatInterval = 25 * time.Second

func (h *streamHandler) sendStartEvent(task *run.TaskState) {
	normalizedStatuses := normalizeAgentStatuses(task.AgentStatuses)
	agentCount := 0
	if statuses, ok := normalizedStatuses.([]any); ok {
		agentCount = len(statuses)
	}
	startEvent, _ := h.marshalToPooledBuffer(map[string]any{
		"type":        "start",
		"model_id":    task.ModelID,
		"agent_count": agentCount,
	})
	if err := h.sendSSE(startEvent); err != nil {
		slog.Debug("[Stream] Client disconnected while sending start", "taskId", h.taskID, "error", err)
	}
	h.hasStarted = true
}

func (h *streamHandler) sendCompleteEvent(task *run.TaskState) bool {
	normalizedStatuses := normalizeAgentStatuses(task.AgentStatuses)
	completeData := map[string]any{
		"type":           "complete",
		"message":        task.Result,
		"agent_statuses": normalizedStatuses,
	}
	if toolEvents := compactCompleteToolEvents(task.ToolEvents); toolEvents != nil {
		completeData["tool_usage"] = toolEvents
	}
	if task.ConversationID > 0 {
		completeData["conversation_id"] = task.ConversationID
	}
	if task.TraceID != "" {
		completeData["trace_id"] = task.TraceID
	}
	completeEvent, err := h.marshalToPooledBuffer(completeData)
	if err != nil {
		slog.Warn("[Stream] Failed to marshal complete event", "taskId", h.taskID, "error", err)
		return false
	}
	if err := h.sendSSE(completeEvent); err != nil {
		slog.Debug("[Stream] Client disconnected while sending complete", "taskId", h.taskID, "error", err)
	}
	return false
}

func (h *streamHandler) sendFailedEvent(task *run.TaskState) bool {
	errorEvent, _ := h.marshalToPooledBuffer(map[string]string{"type": "error", "error": task.Error})
	if err := h.sendSSE(errorEvent); err != nil {
		slog.Debug("[Stream] Client disconnected while sending failed event", "taskId", h.taskID, "error", err)
	}
	return false
}

func (h *streamHandler) sendKeepAlivePulse(reason string) bool {
	pulseEvent, err := streamMarshalEvent(h, map[string]string{"type": "pulse", "reason": reason})
	if err != nil {
		slog.Warn("[Stream] Failed to marshal keep-alive pulse event", "taskId", h.taskID, "error", err)
		return true
	}
	if err := h.sendSSE(pulseEvent); err != nil {
		slog.Debug("[Stream] Client disconnected while sending keep-alive", "taskId", h.taskID, "error", err)
		return false
	}
	return true
}

func (h *streamHandler) sendProgressPulse(task *run.TaskState) bool {
	now := time.Now()
	if h.lastProgressEvent != nil &&
		(task.ProgressVersion != 0 || task.UpdatedAt != 0) &&
		task.ProgressVersion == h.lastProgressVersion &&
		task.UpdatedAt == h.lastProgressUpdatedAt {
		if h.lastProgressSentAt.IsZero() || now.Sub(h.lastProgressSentAt) >= progressRepeatHeartbeatInterval {
			h.lastProgressSentAt = now
			return h.sendKeepAlivePulse("unchanged-progress")
		}
		return true
	}

	normalizedStatuses := normalizeAgentStatuses(task.AgentStatuses)
	progressStatuses := compactProgressAgentStatuses(normalizedStatuses)
	agentCount, firstAgentStatus := extractAgentInfo(normalizedStatuses)
	slog.Debug("[Stream] Sending progress pulse", "taskId", h.taskID, "agentCount", agentCount, "firstAgentStatus", firstAgentStatus, "taskStarted", task.Started)
	pulseData := map[string]any{
		"type":             "progress",
		"agent_statuses":   progressStatuses,
		"pending_approval": task.PendingApproval,
	}
	if toolEvents := compactProgressToolEvents(task.ToolEvents); toolEvents != nil {
		pulseData["tool_usage"] = toolEvents
	}
	if task.BudgetUsage != nil {
		pulseData["budget_usage"] = task.BudgetUsage
	}
	pulseEvent, err := h.marshalToPooledBuffer(pulseData)
	if err != nil {
		slog.Warn("[Stream] Failed to marshal progress pulse event", "taskId", h.taskID, "error", err)
		return true
	}
	if bytes.Equal(pulseEvent, h.lastProgressEvent) {
		if h.lastProgressSentAt.IsZero() || now.Sub(h.lastProgressSentAt) >= progressRepeatHeartbeatInterval {
			h.lastProgressSentAt = now
			return h.sendKeepAlivePulse("unchanged-progress")
		}
		return true
	}
	if err := h.sendSSE(pulseEvent); err != nil {
		slog.Debug("[Stream] Client disconnected while sending progress", "taskId", h.taskID, "error", err)
		return false
	}
	h.lastProgressEvent = pulseEvent
	h.lastProgressVersion = task.ProgressVersion
	h.lastProgressUpdatedAt = task.UpdatedAt
	h.lastProgressSentAt = now
	return true
}

func (h *streamHandler) sendState() bool {
	task := run.GetRegistry().Get(h.taskID)
	if task == nil {
		slog.Warn("[Stream] Task not found", "taskId", h.taskID, "userId", h.userID)
		return h.sendError("Task not found")
	}

	if task.UserID != h.userID {
		slog.Warn("[Stream] Unauthorized task stream request", "taskId", h.taskID, "userId", h.userID, "taskUserId", task.UserID)
		return h.sendError("Unauthorized")
	}

	if !h.hasStarted && task.Status == run.StatusProcessing {
		h.sendStartEvent(task)
	}

	switch task.Status {
	case run.StatusCompleted:
		slog.Info("[Stream] Sending terminal complete event", "taskId", h.taskID, "userId", h.userID)
		return h.sendCompleteEvent(task)
	case run.StatusFailed:
		slog.Info("[Stream] Sending terminal failed event", "taskId", h.taskID, "userId", h.userID, "errorPresent", task.Error != "")
		return h.sendFailedEvent(task)
	case run.StatusCanceled:
		slog.Info("[Stream] Sending terminal canceled event", "taskId", h.taskID, "userId", h.userID)
		return h.sendFailedEvent(task)
	case run.StatusProcessing, run.StatusAwaiting:
		if task.Status == run.StatusProcessing && time.Since(time.Unix(task.UpdatedAt, 0)) > staleRecoveryThreshold {
			h.triggerRecovery(task)
		}
		return h.sendProgressPulse(task)
	default:
		return h.sendProgressPulse(task)
	}
}
