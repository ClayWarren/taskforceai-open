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
	ID            *int    `json:"id,omitempty"`
	LocalID       string  `json:"localId,omitempty"`
	Timestamp     string  `json:"timestamp"`
	UserID        string  `json:"userId,omitempty"`
	UserInput     string  `json:"userInput"`
	Result        string  `json:"result,omitempty"`
	ExecutionTime float64 `json:"executionTime,omitempty"`
	Model         string  `json:"model,omitempty"`
	AgentCount    int     `json:"agentCount,omitempty"`
	SyncVersion   int     `json:"syncVersion"`
	LastSyncedAt  string  `json:"lastSyncedAt"`
	DeviceID      string  `json:"deviceId,omitempty"`
	IsDeleted     bool    `json:"isDeleted"`
	UpdatedAt     string  `json:"updatedAt"`
}

type MessageSyncPayload struct {
	MessageID           string  `json:"messageId"`
	ConversationID      int     `json:"conversationId"`
	ConversationLocalID string  `json:"conversationLocalId,omitempty"`
	Role                string  `json:"role"`
	Content             string  `json:"content"`
	IsStreaming         bool    `json:"isStreaming"`
	IsAgentStatus       bool    `json:"isAgentStatus"`
	ElapsedSeconds      float64 `json:"elapsedSeconds,omitempty"`
	CreatedAt           string  `json:"createdAt"`
	Error               string  `json:"error,omitempty"`
	Sources             any     `json:"sources,omitempty"`
	ToolEvents          any     `json:"toolEvents,omitempty"`
	AgentStatuses       any     `json:"agentStatuses,omitempty"`
	SyncVersion         int     `json:"syncVersion"`
	LastSyncedAt        string  `json:"lastSyncedAt"`
	DeviceID            string  `json:"deviceId,omitempty"`
	IsDeleted           bool    `json:"isDeleted"`
	UpdatedAt           string  `json:"updatedAt"`
}

type DeletionRecord struct {
	Type      string `json:"type"` // conversation, message
	ID        string `json:"id"`
	DeletedAt string `json:"deletedAt"`
}

type SyncPullRequest struct {
	LastSyncVersion int    `json:"lastSyncVersion"`
	DeviceID        string `json:"deviceId"`
	Limit           int    `json:"limit,omitempty"`
}

type SyncPullResponse struct {
	Conversations []ConversationSyncPayload `json:"conversations"`
	Messages      []MessageSyncPayload      `json:"messages"`
	Deletions     []DeletionRecord          `json:"deletions"`
	LatestVersion int                       `json:"latestVersion"`
	HasMore       bool                      `json:"hasMore"`
}

type SyncPushRequest struct {
	Conversations []ConversationSyncPayload `json:"conversations"`
	Messages      []MessageSyncPayload      `json:"messages"`
	Deletions     []DeletionRecord          `json:"deletions"`
	DeviceID      string                    `json:"deviceId"`
}

type SyncPushResponse struct {
	Accepted               []string         `json:"accepted"`
	Conflicts              []ConflictRecord `json:"conflicts"`
	NewVersion             int              `json:"newVersion"`
	ConversationIDMappings map[string]int   `json:"conversationIdMappings"`
}

type ConflictRecord struct {
	Type          string `json:"type"`
	ID            string `json:"id"`
	Reason        string `json:"reason"`
	ServerVersion int    `json:"serverVersion"`
	ClientVersion int    `json:"clientVersion"`
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
