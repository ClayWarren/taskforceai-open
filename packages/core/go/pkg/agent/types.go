package agent

type ToolCallFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type ToolCall struct {
	Index    *int             `json:"index,omitempty"`
	ID       string           `json:"id"`
	Type     string           `json:"type"`
	Function ToolCallFunction `json:"function"`
}

type ToolEvent struct {
	InvocationID  string            `json:"invocationId,omitempty"`
	AgentID       *int              `json:"agentId,omitempty"`
	AgentLabel    string            `json:"agentLabel"`
	ToolName      string            `json:"toolName"`
	Arguments     any               `json:"arguments"`
	Status        string            `json:"status,omitempty"`
	Success       bool              `json:"success"`
	DurationMs    int64             `json:"durationMs"`
	ResultPreview string            `json:"resultPreview,omitempty"`
	Error         string            `json:"error,omitempty"`
	ImageBase64   string            `json:"image_base64,omitempty"`
	Sources       []SourceReference `json:"sources,omitempty"`
	GeneratedFile *GeneratedFile    `json:"generatedFile,omitempty"`
}

type GeneratedFile struct {
	Filename    string `json:"filename"`
	Filepath    string `json:"filepath,omitempty"`
	MimeType    string `json:"mimeType,omitempty"`
	Bytes       int64  `json:"bytes,omitempty"`
	FileID      string `json:"fileId,omitempty"`
	ArtifactID  string `json:"artifactId,omitempty"`
	DownloadURL string `json:"downloadUrl,omitempty"`
	ToolName    string `json:"toolName,omitempty"`
	LocalPath   string `json:"-"`
}

type SourceReference struct {
	URL     string `json:"url"`
	Title   string `json:"title,omitempty"`
	Snippet string `json:"snippet,omitempty"`
}

type ToolLogger func(event ToolEvent)

type UsagePayload struct {
	Usage *ChatCompletionUsage `json:"usage,omitempty"`
	Model string               `json:"model"`
	Stage string               `json:"stage"`
}

type UsageLogger func(payload UsagePayload)
