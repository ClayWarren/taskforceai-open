package orchestrator

type MemberStatus string

const (
	MemberStatusReady             MemberStatus = "ready"
	MemberStatusBusy              MemberStatus = "busy"
	MemberStatusShutdownRequested MemberStatus = "shutdown_requested"
	MemberStatusShutdown          MemberStatus = "shutdown"
	MemberStatusError             MemberStatus = "error"
)

type ExecutionStatus string

const (
	ExecutionStatusIdle            ExecutionStatus = "idle"
	ExecutionStatusStarting        ExecutionStatus = "starting"
	ExecutionStatusRunning         ExecutionStatus = "running"
	ExecutionStatusCancelRequested ExecutionStatus = "cancel_requested"
	ExecutionStatusCancelling      ExecutionStatus = "cancelling"
	ExecutionStatusCancelled       ExecutionStatus = "cancelled"
	ExecutionStatusCompleting      ExecutionStatus = "completing"
	ExecutionStatusCompleted       ExecutionStatus = "completed"
	ExecutionStatusFailed          ExecutionStatus = "failed"
	ExecutionStatusTimedOut        ExecutionStatus = "timed_out"
)

type PlanApprovalStatus string

const (
	PlanApprovalNone     PlanApprovalStatus = "none"
	PlanApprovalPending  PlanApprovalStatus = "pending"
	PlanApprovalApproved PlanApprovalStatus = "approved"
	PlanApprovalRejected PlanApprovalStatus = "rejected"
)

type TeamMember struct {
	Name            string             `json:"name"`
	SessionID       string             `json:"session_id"`
	Agent           string             `json:"agent"`
	Status          MemberStatus       `json:"status"`
	ExecutionStatus ExecutionStatus    `json:"execution_status,omitempty"`
	Prompt          string             `json:"prompt,omitempty"`
	Model           string             `json:"model,omitempty"`
	PlanApproval    PlanApprovalStatus `json:"plan_approval,omitempty"`
}

type TeamInfo struct {
	Name          string       `json:"name"`
	LeadSessionID string       `json:"lead_session_id"`
	Members       []TeamMember `json:"members"`
	Created       int64        `json:"created"` // Unix timestamp in ms to match TS
	Delegate      bool         `json:"delegate,omitempty"`
}

type TaskStatus string

const (
	TaskStatusPending    TaskStatus = "pending"
	TaskStatusInProgress TaskStatus = "in_progress"
	TaskStatusCompleted  TaskStatus = "completed"
	TaskStatusCancelled  TaskStatus = "cancelled"
	TaskStatusBlocked    TaskStatus = "blocked"
)

type TaskPriority string

const (
	TaskPriorityHigh   TaskPriority = "high"
	TaskPriorityMedium TaskPriority = "medium"
	TaskPriorityLow    TaskPriority = "low"
)

type TeamTask struct {
	ID        string       `json:"id"`
	Content   string       `json:"content"`
	Status    TaskStatus   `json:"status"`
	Priority  TaskPriority `json:"priority"`
	Assignee  string       `json:"assignee,omitempty"`
	DependsOn []string     `json:"depends_on,omitempty"`
}
