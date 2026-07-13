package orchestrator

import "github.com/TaskForceAI/core/pkg/agent"

type AgentResult struct {
	AgentID       int
	AgentName     string
	Status        string
	Response      string
	ExecutionTime int64
	ToolEvents    []agent.ToolEvent
}

type OrchestrationTrace struct {
	OriginalQuery  string             `json:"original_query"`
	SubQuestions   []string           `json:"sub_questions"`
	AgentResults   []AgentResult      `json:"agent_results"`
	FinalSynthesis string             `json:"final_synthesis"`
	ModelConfig    string             `json:"model_config"`
	Timestamp      int64              `json:"timestamp"`
	TokenUsage     []TokenUsageRecord `json:"token_usage,omitempty"`
	ToolUsage      []agent.ToolEvent  `json:"tool_usage,omitempty"`
}
