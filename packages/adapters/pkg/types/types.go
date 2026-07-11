package types

type AgentStatus struct {
	AgentID  string  `json:"agentId"`
	Status   string  `json:"status"` // idle, running, completed, failed
	Progress float64 `json:"progress"`
	Message  string  `json:"message,omitempty"`
	Result   string  `json:"result,omitempty"`
	Error    string  `json:"error,omitempty"`
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
	ArtifactID  string `json:"artifactId,omitempty"`
	Filename    string `json:"filename"`
	Filepath    string `json:"filepath,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
	Bytes       int64  `json:"bytes,omitempty"`
	FileID      string `json:"fileId,omitempty"`
	DownloadURL string `json:"downloadUrl,omitempty"`
}

type AgentStatusSnapshot struct {
	Status   string   `json:"status"`
	AgentID  *int     `json:"agent_id,omitempty"`
	Progress *float64 `json:"progress,omitempty"`
	Result   string   `json:"result,omitempty"`
}

type ServerSentEvent[T any] struct {
	Type  string `json:"type"`
	Data  T      `json:"data"`
	ID    string `json:"id,omitempty"`
	Retry int    `json:"retry,omitempty"`
}
