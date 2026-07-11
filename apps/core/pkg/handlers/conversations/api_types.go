package conversations

import "github.com/TaskForceAI/core/pkg/conversations"

// ConversationResponse represents a single conversation in API responses.
type ConversationResponse struct {
	ID            int                                  `json:"id" doc:"Unique identifier for the conversation" example:"123"`
	Timestamp     string                               `json:"timestamp" doc:"Creation timestamp in ISO 8601 format"`
	UserInput     string                               `json:"user_input" doc:"User's initial prompt or title"`
	Result        string                               `json:"result" doc:"Final result or answer"`
	ExecutionTime int                                  `json:"execution_time" doc:"Time taken to execute in milliseconds"`
	Model         string                               `json:"model" doc:"AI model used"`
	AgentCount    int                                  `json:"agent_count" doc:"Number of agents involved"`
	ProjectID     *int                                 `json:"projectId,omitempty" doc:"Associated project ID"`
	Sources       []conversations.SourceReference      `json:"sources" doc:"List of sources cited"`
	AgentStatuses []conversations.AgentStatusRecord    `json:"agentStatuses" doc:"Status of agents"`
	ToolEvents    []conversations.ToolUsageEventRecord `json:"toolEvents" doc:"Tool calls made during execution"`
}

// ConversationsListResponse represents the paginated list response.
type ConversationsListResponse struct {
	Conversations []ConversationResponse `json:"conversations" doc:"List of conversations"`
	Total         int                    `json:"total" doc:"Total number of conversations available"`
	Limit         int                    `json:"limit" doc:"Current page limit"`
	Offset        int                    `json:"offset" doc:"Current page offset"`
	HasMore       bool                   `json:"has_more" doc:"Whether there are more conversations to fetch"`
}

// CreateConversationRequest represents the request body for creating a conversation.
type CreateConversationRequest struct {
	Title         string  `json:"title" minLength:"1" maxLength:"500" doc:"Title or user input for the conversation"`
	Result        *string `json:"result,omitempty" maxLength:"10000" doc:"Initial result content"`
	ExecutionTime *int    `json:"executionTime,omitempty" doc:"Execution time in ms"`
	Model         *string `json:"model,omitempty" maxLength:"100" doc:"AI model identifier"`
	AgentCount    *int    `json:"agentCount,omitempty" minimum:"1" maximum:"100" doc:"Number of agents to use"`
}

// UpdateConversationRequest represents the request body for updating a conversation.
type UpdateConversationRequest struct {
	Title         *string `json:"title,omitempty" minLength:"1" maxLength:"500"`
	Result        *string `json:"result,omitempty" maxLength:"10000"`
	ExecutionTime *int    `json:"executionTime,omitempty"`
	Model         *string `json:"model,omitempty" maxLength:"100"`
	AgentCount    *int    `json:"agentCount,omitempty" minimum:"1" maximum:"100"`
}
