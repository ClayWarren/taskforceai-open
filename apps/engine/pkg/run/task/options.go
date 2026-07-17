package task

import (
	"strings"

	"github.com/TaskForceAI/core/pkg/workflows"
)

const (
	ClientToolSourceMCP      = "mcp"
	ClientToolActionToolCall = "tool_call"
)

type ClientMCPTool struct {
	ServerName  string `json:"serverName"`
	ToolName    string `json:"toolName"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
}

func (t ClientMCPTool) IsZero() bool {
	return strings.TrimSpace(t.ServerName) == "" || strings.TrimSpace(t.ToolName) == ""
}

type ApprovalDecision struct {
	Approved bool           `json:"approved"`
	Result   map[string]any `json:"result,omitempty"`
	Error    string         `json:"error,omitempty"`
}

type ResearchWorkflowOption = workflows.ResearchWorkflowOption

// Task modes mirror the frontend's Chat/Work/Code selector. Empty means the
// client didn't send one (older clients, API callers) - callers must treat
// that as "no signal", not as any particular mode.
const (
	TaskModeChat = "chat"
	TaskModeWork = "work"
	TaskModeCode = "code"
)

// NormalizeTaskMode maps a client-supplied mode string onto the known set,
// returning "" for anything unrecognized.
func NormalizeTaskMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case TaskModeChat:
		return TaskModeChat
	case TaskModeWork:
		return TaskModeWork
	case TaskModeCode:
		return TaskModeCode
	default:
		return ""
	}
}

// OrchestrateOptions is persisted in Redis and round-trips through Inngest.
// The historical field names are wire compatibility requirements.
type OrchestrateOptions struct {
	UserPlan            string                 `json:"UserPlan"`
	Mode                string                 `json:"Mode,omitempty"`
	ProjectID           *int32                 `json:"ProjectID"`
	OrgID               *int32                 `json:"OrgID"`
	NoTraining          bool                   `json:"NoTraining"`
	QuickModeEnabled    bool                   `json:"QuickModeEnabled"`
	ComputerUseEnabled  bool                   `json:"ComputerUseEnabled"`
	ComputerUseTarget   string                 `json:"ComputerUseTarget"`
	UseLoggedInServices bool                   `json:"UseLoggedInServices"`
	Source              string                 `json:"Source"`
	IsEval              bool                   `json:"IsEval"`
	RoleModels          map[string]string      `json:"RoleModels"`
	AutonomyEnabled     bool                   `json:"AutonomyEnabled"`
	Budget              *float64               `json:"Budget"`
	ReasoningEffort     string                 `json:"ReasoningEffort"`
	AttachmentCount     int                    `json:"AttachmentCount"`
	AgentCount          int                    `json:"AgentCount"`
	ClientMCPTools      []ClientMCPTool        `json:"ClientMCPTools"`
	ResearchWorkflow    ResearchWorkflowOption `json:"ResearchWorkflow"`
	ConversationID      *int32                 `json:"ConversationID,omitempty"`
	ThreadContext       string                 `json:"ThreadContext,omitempty"`
}
