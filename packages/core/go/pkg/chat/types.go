package chat

type MessageRole string

const (
	RoleUser      MessageRole = "user"
	RoleAssistant MessageRole = "assistant"
	RoleSystem    MessageRole = "system"
)

type Message struct {
	ID             string                `json:"id"`
	Role           MessageRole           `json:"role"`
	Content        string                `json:"content"`
	IsStreaming    bool                  `json:"isStreaming,omitempty"`
	IsAgentStatus  bool                  `json:"isAgentStatus,omitempty"`
	ElapsedSeconds float64               `json:"elapsedSeconds,omitempty"`
	Error          string                `json:"error,omitempty"`
	Sources        []SourceReference     `json:"sources,omitempty"`
	ToolEvents     []ToolUsageEvent      `json:"toolEvents,omitempty"`
	AgentStatuses  []AgentStatusSnapshot `json:"agentStatuses,omitempty"`
	CreatedAt      int64                 `json:"createdAt,omitempty"`
	UpdatedAt      int64                 `json:"updatedAt,omitempty"`
}

type SourceReference struct {
	URL     string `json:"url"`
	Title   string `json:"title,omitempty"`
	Snippet string `json:"snippet,omitempty"`
}

type ToolUsageEvent struct {
	Timestamp     string                 `json:"timestamp,omitempty"`
	AgentID       *int                   `json:"agentId,omitempty"`
	AgentLabel    string                 `json:"agentLabel"`
	ToolName      string                 `json:"toolName"`
	Arguments     any                    `json:"arguments"`
	Success       bool                   `json:"success"`
	DurationMs    int64                  `json:"durationMs"`
	ResultPreview string                 `json:"resultPreview,omitempty"`
	Error         string                 `json:"error,omitempty"`
	GeneratedFile *GeneratedFileArtifact `json:"generatedFile,omitempty"`
}

type GeneratedFileArtifact struct {
	Filename    string `json:"filename"`
	Filepath    string `json:"filepath,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
	Bytes       int64  `json:"bytes,omitempty"`
	FileID      string `json:"fileId,omitempty"`
	ArtifactID  string `json:"artifactId,omitempty"`
	DownloadURL string `json:"downloadUrl,omitempty"`
}

type AgentStatusSnapshot struct {
	Status   string   `json:"status"`
	AgentID  *int     `json:"agent_id,omitempty"`
	Progress *float64 `json:"progress,omitempty"`
	Result   string   `json:"result,omitempty"`
}
