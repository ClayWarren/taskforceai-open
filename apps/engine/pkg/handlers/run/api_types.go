package run

import (
	contractspkg "github.com/TaskForceAI/contracts/pkg"
)

// RunRequest represents a request to run a task/prompt.
type RunRequest struct {
	contractspkg.RunRequest
	Budget        *float64          `json:"budget,omitempty" doc:"Mission budget in USD"`
	RoleModels    map[string]string `json:"role_models,omitempty" doc:"Optional mapping of roles to specific models"`
	AttachmentIDs []string          `json:"attachment_ids,omitempty" doc:"List of attachment IDs from /api/v1/attachments/upload"`
}

type AttachmentUploadResponse struct {
	ID       string `json:"id" doc:"Unique identifier for the uploaded attachment"`
	MimeType string `json:"mime_type" doc:"Detected MIME type"`
	Size     int64  `json:"size" doc:"Size in bytes"`
}

type RunResponse struct {
	TaskID         string  `json:"task_id" doc:"Unique identifier for the task"`
	Status         string  `json:"status" doc:"Current task status"`
	Result         *string `json:"result,omitempty" doc:"Final result when inline execution already completed"`
	ConversationID *int32  `json:"conversation_id,omitempty" doc:"Conversation ID created by inline execution"`
	TraceID        string  `json:"trace_id,omitempty" doc:"Execution trace ID when available"`
}

type TaskListResponse struct {
	Tasks []TaskSummary `json:"tasks"`
}

type TaskSummary struct {
	TaskID          string               `json:"task_id"`
	Status          string               `json:"status"`
	Prompt          string               `json:"prompt,omitempty"`
	ModelID         string               `json:"model_id,omitempty"`
	Source          string               `json:"source,omitempty"`
	ComputerUse     bool                 `json:"computer_use"`
	ClientMCPTools  []TaskMCPToolSummary `json:"client_mcp_tools,omitempty"`
	UpdatedAt       int64                `json:"updated_at,omitempty"`
	ConversationID  int32                `json:"conversation_id,omitempty"`
	TraceID         string               `json:"trace_id,omitempty"`
	PendingApproval *TaskApprovalSummary `json:"pending_approval,omitempty"`
	BudgetUsage     any                  `json:"budget_usage,omitempty"`
}

type TaskApprovalSummary struct {
	ApprovalID string         `json:"approval_id,omitempty"`
	Permission string         `json:"permission"`
	AgentName  string         `json:"agent_name"`
	Patterns   []string       `json:"patterns"`
	Metadata   map[string]any `json:"metadata"`
}

type TaskMCPToolSummary struct {
	ServerName string `json:"server_name"`
	ToolName   string `json:"tool_name"`
	Title      string `json:"title,omitempty"`
}

// PulseRequest defines the data sent by the pulse trigger.
type PulseRequest struct {
	AgentID string `json:"agentId" doc:"ID of the agent to wake up"`
	Reason  string `json:"reason" doc:"Reason for waking up (e.g. heartbeat)"`
	TS      int64  `json:"ts" doc:"Timestamp of the pulse event"`
}

type ExecutionTrace struct {
	ID        string `json:"id"`
	TaskID    string `json:"task_id"`
	UserID    *int32 `json:"user_id,omitempty"`
	Goal      string `json:"goal"`
	Plan      any    `json:"plan"`
	Steps     any    `json:"steps"`
	SelfEval  any    `json:"self_eval"`
	Report    any    `json:"report,omitempty"`
	Artifacts any    `json:"artifacts"`
	CreatedAt string `json:"created_at"`
}

type ExecutionTraceResponse struct {
	Trace *ExecutionTrace `json:"trace"`
}

type ApproveTaskRequest struct {
	Approved bool           `json:"approved" doc:"Whether to approve or deny the pending action"`
	Result   map[string]any `json:"result,omitempty" doc:"Optional tool result payload returned by the client"`
	Error    string         `json:"error,omitempty" doc:"Optional execution error returned by the client"`
}
