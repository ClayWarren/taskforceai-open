package types

import corechat "github.com/TaskForceAI/core/pkg/chat"

type SourceReference = corechat.SourceReference
type ToolUsageEvent = corechat.ToolUsageEvent
type GeneratedFileArtifact = corechat.GeneratedFileArtifact
type AgentStatusSnapshot = corechat.AgentStatusSnapshot

type AgentStatus struct {
	AgentID  string  `json:"agentId"`
	Status   string  `json:"status"` // idle, running, completed, failed
	Progress float64 `json:"progress"`
	Message  string  `json:"message,omitempty"`
	Result   string  `json:"result,omitempty"`
	Error    string  `json:"error,omitempty"`
}

type ServerSentEvent[T any] struct {
	Type  string `json:"type"`
	Data  T      `json:"data"`
	ID    string `json:"id,omitempty"`
	Retry int    `json:"retry,omitempty"`
}
