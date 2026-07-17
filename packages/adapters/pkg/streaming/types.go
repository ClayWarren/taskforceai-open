package streaming

import (
	"github.com/TaskForceAI/adapters/pkg/types"
)

type ToolUsageEventPayload struct {
	Timestamp     string `json:"timestamp,omitempty"`
	AgentID       *int   `json:"agent_id,omitempty"`
	AgentLabel    string `json:"agent_label,omitempty"`
	ToolName      string `json:"tool_name,omitempty"`
	ToolInput     any    `json:"tool_input,omitempty"`
	ToolOutput    any    `json:"tool_output,omitempty"`
	DurationMs    int64  `json:"duration_ms,omitempty"`
	Status        string `json:"status,omitempty"`
	ResultPreview string `json:"result_preview,omitempty"`
	Error         string `json:"error,omitempty"`
}

type StreamingPayload struct {
	Type          string                      `json:"type"`
	AgentStatuses []types.AgentStatusSnapshot `json:"agent_statuses,omitempty"`
	Error         string                      `json:"error,omitempty"`
	Message       string                      `json:"message,omitempty"`
	TaskID        string                      `json:"task_id,omitempty"`
	Prompt        string                      `json:"prompt,omitempty"`
	Chunk         string                      `json:"chunk,omitempty"`
	Reasoning     string                      `json:"reasoning,omitempty"`
	ToolEvent     *ToolUsageEventPayload      `json:"tool_event,omitempty"`
	ToolEvents    []ToolUsageEventPayload     `json:"tool_events,omitempty"`
	ToolUsage     []ToolUsageEventPayload     `json:"tool_usage,omitempty"`
	ModelID       string                      `json:"model_id,omitempty"`
	ModelLabel    string                      `json:"model_label,omitempty"`
	ModelBadge    string                      `json:"model_badge,omitempty"`
	AgentCount    int                         `json:"agent_count,omitempty"`
}
