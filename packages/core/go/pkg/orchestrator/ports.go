package orchestrator

import (
	"context"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/hitl"
	"github.com/TaskForceAI/core/pkg/shared"
)

type TokenUsageRecord struct {
	Stage            string `json:"stage"`
	Model            string `json:"model"`
	PromptTokens     int    `json:"promptTokens"`
	CompletionTokens int    `json:"completionTokens"`
	TotalTokens      int    `json:"totalTokens"`
	CachedTokens     int    `json:"cachedTokens,omitempty"`
}

type ITaskDecomposer interface {
	GenerateSubtasks(ctx context.Context, userInput string, numAgents int) ([]string, error)
}

type ITelemetry interface {
	StartSpan(ctx context.Context, name string, op string, attributes map[string]any, fn func(context.Context) error) error
}

type IErrorReporter interface {
	CaptureException(ctx context.Context, err error, tags map[string]string)
}

type IUsageTracker interface {
	RecordToolUsage(event agent.ToolEvent)
	RecordTokenUsage(stage string, usage *agent.ChatCompletionUsage, model string)
	GetToolUsage() []agent.ToolEvent
	GetTokenUsageSummary() ([]TokenUsageRecord, TokenUsageRecord)
	OnToolUsage(listener func(agent.ToolEvent, []agent.ToolEvent)) func()
	ResetToolUsage()
	ResetTokenUsage()
	ResetAll()
}

type IProgressTracker interface {
	GetAgentStatuses() []AgentStatusSnapshot
	UpdateAgentProgress(agentID int, status AgentStatus, result string) shared.Result[struct{}]
	UpdateAgentProgressDetailed(agentID int, status AgentStatus, result string, reasoning string) shared.Result[struct{}]
	SetAgentModel(agentID int, model string)
	Initialize(numAgents int)
	OnUpdate(listener func([]AgentStatusSnapshot)) func()
}

type ExecutionTrace struct {
	ID        string           `json:"id"`
	TaskID    string           `json:"task_id"`
	UserID    *int32           `json:"user_id"`
	Goal      string           `json:"goal"`
	Plan      any              `json:"plan"`      // Json
	Steps     any              `json:"steps"`     // Json
	SelfEval  any              `json:"self_eval"` // Json
	Report    *ExecutionReport `json:"report,omitempty"`
	Artifacts any              `json:"artifacts"` // Json
}

type IExecutionTraceRepository interface {
	SaveExecutionTrace(ctx context.Context, trace *ExecutionTrace) error
	GetExecutionTrace(ctx context.Context, taskID string) (*ExecutionTrace, error)
}

type ExecutionReport struct {
	Summary   string           `json:"summary"`
	KeySteps  []ReportStep     `json:"key_steps"`
	Decisions []ReportDecision `json:"decisions"`
	Rubric    ExecutionRubric  `json:"rubric"`
}

type ExecutionRubric struct {
	Accuracy     int    `json:"accuracy"`     // 0-5
	Completeness int    `json:"completeness"` // 0-5
	Confidence   int    `json:"confidence"`   // 0-5
	Risk         string `json:"risk"`         // low/med/high
	HumanReview  bool   `json:"human_review"` // should a human review this?
}

type ReportStep struct {
	Agent       string `json:"agent"`
	Action      string `json:"action"`
	Observation string `json:"observation"`
}

type ReportDecision struct {
	Agent     string `json:"agent"`
	Rationale string `json:"rationale"`
	Outcome   string `json:"outcome"`
}

type IReportGenerator interface {
	GenerateReport(ctx context.Context, trace *ExecutionTrace) (*ExecutionReport, error)
}

type ApprovalRequest = hitl.ApprovalRequest
type IApprovalRegistry = hitl.ApprovalRegistry
