package sync

import (
	"github.com/TaskForceAI/adapters/pkg/types"
	"github.com/TaskForceAI/adapters/pkg/utils"
)

type MessageRole string

const (
	RoleUser      MessageRole = "user"
	RoleAssistant MessageRole = "assistant"
	RoleSystem    MessageRole = "system"
)

// StorageConversation represents a conversation record in local storage.
type StorageConversation struct {
	ID                 *int    `json:"id,omitempty"`
	ConversationID     string  `json:"conversationId"`
	Title              string  `json:"title"`
	CreatedAt          int64   `json:"createdAt"`
	UpdatedAt          int64   `json:"updatedAt"`
	LastMessagePreview *string `json:"lastMessagePreview,omitempty"`
	SyncVersion        int     `json:"syncVersion"`
	LastSyncedAt       int64   `json:"lastSyncedAt"`
	DeviceID           string  `json:"deviceId,omitempty"`
	IsDeleted          bool    `json:"isDeleted"`
}

// StorageMessage represents a message record in local storage.
type StorageMessage struct {
	ID             *int                        `json:"id,omitempty"`
	MessageID      string                      `json:"messageId"`
	ConversationID string                      `json:"conversationId"`
	Role           MessageRole                 `json:"role"`
	Content        string                      `json:"content"`
	IsStreaming    bool                        `json:"isStreaming"`
	IsAgentStatus  bool                        `json:"isAgentStatus,omitempty"`
	ElapsedSeconds *float64                    `json:"elapsedSeconds,omitempty"`
	CreatedAt      int64                       `json:"createdAt"`
	UpdatedAt      int64                       `json:"updatedAt"`
	Error          *string                     `json:"error,omitempty"`
	Sources        []types.SourceReference     `json:"sources,omitempty"`
	ToolEvents     []types.ToolUsageEvent      `json:"toolEvents,omitempty"`
	AgentStatuses  []types.AgentStatusSnapshot `json:"agentStatuses,omitempty"`
	SyncVersion    int                         `json:"syncVersion"`
	LastSyncedAt   int64                       `json:"lastSyncedAt"`
	DeviceID       string                      `json:"deviceId,omitempty"`
	IsDeleted      bool                        `json:"isDeleted"`
}

// PendingChange represents a local change that has not yet been synced to the server.
type PendingChange struct {
	ID        *int   `json:"id,omitempty"`
	Type      string `json:"type"` // conversation, message, deletion
	EntityID  string `json:"entityId"`
	Operation string `json:"operation"` // create, update, delete
	Data      any    `json:"data"`
	CreatedAt int64  `json:"createdAt"`
}

// SyncStorage defines the interface for local sync storage.
type SyncStorage interface {
	GetConversations(limit int) ([]StorageConversation, error)
	GetConversation(conversationID string) utils.Result[StorageConversation]
	UpsertConversation(conversation StorageConversation) error
	DeleteConversation(conversationID string) error

	GetMessages(conversationID string) ([]StorageMessage, error)
	GetMessage(messageID string) utils.Result[StorageMessage]
	UpsertMessage(message StorageMessage) error
	DeleteMessage(messageID string) error

	GetPendingChanges() ([]PendingChange, error)
	AddPendingChange(change PendingChange) error
	UpdatePendingChange(id int, data map[string]any) error
	RemovePendingChange(id int) error
	ClearPendingChanges() error
	UpdatePendingChangeData(id int, data any) error

	GetLastSyncVersion() (int, error)
	SetLastSyncVersion(version int) error
	GetDeviceID() (string, error)
	SetDeviceID(deviceID string) error
}
