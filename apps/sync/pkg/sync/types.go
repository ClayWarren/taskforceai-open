package sync

import "time"

// Timestamp is the sync domain's database-neutral representation of an optional
// timestamp. Persistence adapters translate driver-specific timestamp types at
// the boundary.
type Timestamp struct {
	Time  time.Time
	Valid bool
}

// ConversationRecord is the persisted conversation shape required by sync use
// cases. It deliberately contains no sqlc or database-driver types.
type ConversationRecord struct {
	ID             int32
	Timestamp      Timestamp
	UserID         *string
	OrganizationID *int32
	UserInput      string
	Result         *string
	ExecutionTime  *float64
	Model          *string
	AgentCount     int32
	ProjectID      *int32
	IsPublic       bool
	ShareID        *string
	VectorClock    []byte
	SyncVersion    int32
	LastSyncedAt   Timestamp
	DeviceID       *string
	IsDeleted      bool
	UpdatedAt      Timestamp
}

type MessageRecord struct {
	ID             int32
	MessageID      string
	ConversationID int32
	Role           string
	Content        string
	IsStreaming    bool
	IsAgentStatus  bool
	ElapsedSeconds *float64
	CreatedAt      Timestamp
	Error          *string
	Sources        []byte
	ToolEvents     []byte
	AgentStatuses  []byte
	VectorClock    []byte
	SyncVersion    int32
	LastSyncedAt   Timestamp
	DeviceID       *string
	IsDeleted      bool
	UpdatedAt      Timestamp
	Rating         int32
	Trace          []byte
}

type ConversationVersion struct {
	ID          int32
	SyncVersion int32
	VectorClock []byte
}

type MessageVersion struct {
	MessageID   string
	SyncVersion int32
	VectorClock []byte
}

type CreateConversationInput struct {
	UserID         *string
	OrganizationID *int32
	UserInput      string
	Result         *string
	ExecutionTime  *float64
	Model          *string
	AgentCount     int32
	SyncVersion    int32
	DeviceID       *string
	IsDeleted      bool
	Timestamp      Timestamp
	VectorClock    []byte
}

type UpdateConversationInput struct {
	ID                  int32
	UserInput           string
	OrganizationID      *int32
	Result              *string
	ExecutionTime       *float64
	Model               *string
	AgentCount          int32
	SyncVersion         int32
	DeviceID            *string
	IsDeleted           bool
	VectorClock         []byte
	ScopeOrganizationID *int32
	UserID              *string
}

type CreateMessageInput struct {
	MessageID      string
	ConversationID int32
	Role           string
	Content        string
	IsStreaming    bool
	IsAgentStatus  bool
	ElapsedSeconds *float64
	Error          *string
	Sources        []byte
	ToolEvents     []byte
	AgentStatuses  []byte
	SyncVersion    int32
	DeviceID       *string
	IsDeleted      bool
	CreatedAt      Timestamp
	VectorClock    []byte
	Trace          []byte
}

type UpdateMessageInput struct {
	MessageID      string
	Content        string
	IsStreaming    bool
	IsAgentStatus  bool
	ElapsedSeconds *float64
	Error          *string
	Sources        []byte
	ToolEvents     []byte
	AgentStatuses  []byte
	SyncVersion    int32
	DeviceID       *string
	IsDeleted      bool
	VectorClock    []byte
	Trace          []byte
	OrganizationID *int32
	UserID         *string
}

type SyncAuditInput struct {
	UserID         string
	DeviceID       string
	Action         string
	VersionStart   int32
	VersionEnd     int32
	ItemsCount     int32
	ConflictsCount int32
	DurationMs     int32
	Success        bool
	ErrorMessage   *string
	Details        []byte
}

type SyncAuditRecord struct {
	ID             int32
	Timestamp      Timestamp
	UserID         string
	DeviceID       string
	Action         string
	VersionStart   int32
	VersionEnd     int32
	ItemsCount     int32
	ConflictsCount int32
	DurationMs     int32
	Success        bool
	ErrorMessage   *string
	Details        []byte
}

type UpsertSyncDeviceInput struct {
	UserID     string
	DeviceID   string
	DeviceName *string
	UserAgent  *string
}

type SyncDeviceRecord struct {
	ID         int32
	UserID     string
	DeviceID   string
	DeviceName *string
	UserAgent  *string
	LastSeenAt Timestamp
	CreatedAt  Timestamp
	IsRevoked  bool
}

type ConversationSyncPayload struct {
	ID               int32     `json:"id"`
	LocalID          *string   `json:"local_id,omitempty"`
	UserID           *string   `json:"user_id,omitempty"`
	OrganizationID   *int32    `json:"organization_id,omitempty"`
	Timestamp        time.Time `json:"timestamp"`
	UserInput        string    `json:"user_input"`
	Result           *string   `json:"result,omitempty"`
	ExecutionTime    *float64  `json:"execution_time,omitempty"`
	Model            *string   `json:"model,omitempty"`
	AgentCount       int32     `json:"agent_count"`
	SyncVersion      int32     `json:"sync_version"`
	VectorClock      []byte    `json:"vector_clock,omitempty"`
	LastSyncedAt     time.Time `json:"last_synced_at"`
	DeviceID         *string   `json:"device_id,omitempty"`
	IsDeleted        bool      `json:"is_deleted"`
	ContentTruncated bool      `json:"content_truncated,omitempty"`
	Patches          []byte    `json:"patches,omitempty" doc:"RFC 6902 JSON Patch"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type MessageSyncPayload struct {
	MessageID           string    `json:"message_id"`
	ConversationID      int32     `json:"conversation_id"`
	ConversationLocalID *string   `json:"conversation_local_id,omitempty"`
	Role                string    `json:"role"`
	Content             string    `json:"content"`
	IsStreaming         bool      `json:"is_streaming"`
	IsAgentStatus       bool      `json:"is_agent_status"`
	ElapsedSeconds      *float64  `json:"elapsed_seconds,omitempty"`
	CreatedAt           time.Time `json:"created_at"`
	Error               *string   `json:"error,omitempty"`
	Sources             any       `json:"sources"`
	ToolEvents          any       `json:"tool_events"`
	AgentStatuses       any       `json:"agent_statuses"`
	Trace               any       `json:"trace,omitempty"`
	SyncVersion         int32     `json:"sync_version"`
	VectorClock         []byte    `json:"vector_clock,omitempty"`
	LastSyncedAt        time.Time `json:"last_synced_at"`
	DeviceID            *string   `json:"device_id,omitempty"`
	IsDeleted           bool      `json:"is_deleted"`
	ContentTruncated    bool      `json:"content_truncated,omitempty"`
	Patches             []byte    `json:"patches,omitempty" doc:"RFC 6902 JSON Patch"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type DeletionRecord struct {
	Type      string    `json:"type"`
	ID        string    `json:"id"`
	DeletedAt time.Time `json:"deleted_at"`
}

type SyncPullRequest struct {
	LastSyncVersion int32  `json:"last_sync_version"`
	Limit           int32  `json:"limit,omitempty"`
	OrganizationID  *int32 `json:"organization_id,omitempty"`
}

type SyncPullResponse struct {
	Conversations []ConversationSyncPayload `json:"conversations"`
	Messages      []MessageSyncPayload      `json:"messages"`
	Deletions     []DeletionRecord          `json:"deletions"`
	LatestVersion int32                     `json:"latest_version"`
	HasMore       bool                      `json:"has_more"`
	StateHash     string                    `json:"state_hash,omitempty" doc:"Consistency check hash (format: conv_count:msg_count)"`
}

type SyncPushRequest struct {
	Conversations      []ConversationSyncPayload `json:"conversations"`
	Messages           []MessageSyncPayload      `json:"messages"`
	Deletions          []DeletionRecord          `json:"deletions"`
	ResolutionStrategy ResolutionStrategy        `json:"resolution_strategy,omitempty"`
	OrganizationID     *int32                    `json:"organization_id,omitempty"`
}

type ConflictRecord struct {
	Type          string `json:"type"`
	ID            string `json:"id"`
	Reason        string `json:"reason"`
	ServerVersion int32  `json:"server_version"`
	ClientVersion int32  `json:"client_version"`
}

type SyncPushResponse struct {
	Success                bool             `json:"success"`
	Conflicts              []ConflictRecord `json:"conflicts"`
	Version                int32            `json:"version"`
	Accepted               []string         `json:"accepted"`
	NewVersion             int32            `json:"new_version"`
	ConversationIDMappings map[string]int32 `json:"conversation_id_mappings"`
}

// DeviceRecord for management API
type DeviceRecord struct {
	DeviceID   string    `json:"device_id"`
	DeviceName *string   `json:"device_name"`
	UserAgent  *string   `json:"user_agent"`
	LastSeenAt time.Time `json:"last_seen_at"`
	CreatedAt  time.Time `json:"created_at"`
	IsRevoked  bool      `json:"is_revoked"`
}

func MapDevice(d SyncDeviceRecord) DeviceRecord {
	return DeviceRecord{
		DeviceID:   d.DeviceID,
		DeviceName: d.DeviceName,
		UserAgent:  d.UserAgent,
		LastSeenAt: d.LastSeenAt.Time,
		CreatedAt:  d.CreatedAt.Time,
		IsRevoked:  d.IsRevoked,
	}
}
