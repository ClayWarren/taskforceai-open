package sync

import (
	"errors"
)

var (
	ErrInvalidJSON    = errors.New("INVALID_JSON")
	ErrInvalidSchema  = errors.New("INVALID_SCHEMA")
	ErrInvalidPayload = errors.New("INVALID_PAYLOAD")
)

type ConversationSyncPayload struct {
	ID               *int    `json:"id,omitempty"`
	LocalID          string  `json:"local_id,omitempty"`
	Timestamp        string  `json:"timestamp"`
	UserID           string  `json:"user_id,omitempty"`
	OrganizationID   *int    `json:"organization_id,omitempty"`
	ProjectID        *int    `json:"project_id,omitempty"`
	UserInput        string  `json:"user_input"`
	Result           string  `json:"result,omitempty"`
	ExecutionTime    float64 `json:"execution_time,omitempty"`
	Model            string  `json:"model,omitempty"`
	AgentCount       int     `json:"agent_count"`
	SyncVersion      int     `json:"sync_version"`
	VectorClock      []byte  `json:"vector_clock,omitempty"`
	LastSyncedAt     string  `json:"last_synced_at"`
	DeviceID         string  `json:"device_id,omitempty"`
	IsDeleted        bool    `json:"is_deleted"`
	ContentTruncated bool    `json:"content_truncated,omitempty"`
	Patches          []byte  `json:"patches,omitempty"`
	UpdatedAt        string  `json:"updated_at"`
}

type MessageSyncPayload struct {
	MessageID           string  `json:"message_id"`
	ConversationID      int     `json:"conversation_id"`
	ConversationLocalID string  `json:"conversation_local_id,omitempty"`
	Role                string  `json:"role"`
	Content             string  `json:"content"`
	IsStreaming         bool    `json:"is_streaming"`
	IsAgentStatus       bool    `json:"is_agent_status"`
	ElapsedSeconds      float64 `json:"elapsed_seconds,omitempty"`
	CreatedAt           string  `json:"created_at"`
	Error               string  `json:"error,omitempty"`
	Sources             any     `json:"sources,omitempty"`
	ToolEvents          any     `json:"tool_events,omitempty"`
	AgentStatuses       any     `json:"agent_statuses,omitempty"`
	Trace               any     `json:"trace,omitempty"`
	SyncVersion         int     `json:"sync_version"`
	VectorClock         []byte  `json:"vector_clock,omitempty"`
	LastSyncedAt        string  `json:"last_synced_at"`
	DeviceID            string  `json:"device_id,omitempty"`
	IsDeleted           bool    `json:"is_deleted"`
	ContentTruncated    bool    `json:"content_truncated,omitempty"`
	Patches             []byte  `json:"patches,omitempty"`
	UpdatedAt           string  `json:"updated_at"`
}

type DeletionRecord struct {
	Type      string `json:"type"` // conversation, message
	ID        string `json:"id"`
	DeletedAt string `json:"deleted_at"`
}

type SyncPullRequest struct {
	LastSyncVersion int    `json:"last_sync_version"`
	DeviceID        string `json:"device_id,omitempty"`
	Limit           int    `json:"limit,omitempty"`
	OrganizationID  *int   `json:"organization_id,omitempty"`
}

type SyncPullResponse struct {
	Conversations []ConversationSyncPayload `json:"conversations"`
	Messages      []MessageSyncPayload      `json:"messages"`
	Deletions     []DeletionRecord          `json:"deletions"`
	LatestVersion int                       `json:"latest_version"`
	HasMore       bool                      `json:"has_more"`
	StateHash     string                    `json:"state_hash,omitempty"`
}

type SyncPushRequest struct {
	Conversations      []ConversationSyncPayload `json:"conversations"`
	Messages           []MessageSyncPayload      `json:"messages"`
	Deletions          []DeletionRecord          `json:"deletions"`
	DeviceID           string                    `json:"device_id,omitempty"`
	ResolutionStrategy string                    `json:"resolution_strategy,omitempty"`
	OrganizationID     *int                      `json:"organization_id,omitempty"`
}

type SyncPushResponse struct {
	Success                bool             `json:"success"`
	Version                int              `json:"version"`
	Accepted               []string         `json:"accepted"`
	Conflicts              []ConflictRecord `json:"conflicts"`
	NewVersion             int              `json:"new_version"`
	ConversationIDMappings map[string]int   `json:"conversation_id_mappings"`
}

type ConflictRecord struct {
	Type          string `json:"type"`
	ID            string `json:"id"`
	Reason        string `json:"reason"`
	ServerVersion int    `json:"server_version"`
	ClientVersion int    `json:"client_version"`
}

type ConflictInfo struct {
	Type          string
	ID            string
	LocalVersion  int
	ServerVersion int
	Reason        string
}

type BroadcastEvent struct {
	Type           string `json:"type"`
	ConnectionID   string `json:"connectionId,omitempty"`
	UserID         string `json:"userId,omitempty"`
	ConversationID int    `json:"conversationId,omitempty"`
	MessageID      string `json:"messageId,omitempty"`
}
