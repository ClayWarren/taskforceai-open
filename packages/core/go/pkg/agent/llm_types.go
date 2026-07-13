package agent

import "strings"

type ChatCompletionRole string

const (
	RoleSystem    ChatCompletionRole = "system"
	RoleUser      ChatCompletionRole = "user"
	RoleAssistant ChatCompletionRole = "assistant"
	RoleTool      ChatCompletionRole = "tool"
)

// ContentPartType distinguishes text from image content in multimodal messages.
type ContentPartType string

const (
	ContentPartText       ContentPartType = "text"
	ContentPartImageURL   ContentPartType = "image_url"
	ContentPartInputAudio ContentPartType = "input_audio"
	ContentPartFileData   ContentPartType = "file_data"
)

// ContentPart represents one piece of a multimodal user message.
type ContentPart struct {
	Type       ContentPartType `json:"type"`
	Text       string          `json:"text,omitempty"`
	ImageURL   *ImageURLPart   `json:"image_url,omitempty"`
	InputAudio *InputAudioPart `json:"input_audio,omitempty"`
	FileData   *FileDataPart   `json:"file_data,omitempty"`
}

// ImageURLPart carries an image URL (or data-URI) for vision models.
type ImageURLPart struct {
	URL    string `json:"url"`
	Detail string `json:"detail,omitempty"` // "auto", "low", "high"
}

// InputAudioPart carries base64 encoded audio data and its format (e.g. "wav", "mp3").
type InputAudioPart struct {
	Data   string `json:"data"`   // Base64 encoded audio
	Format string `json:"format"` // "wav", "mp3", etc.
}

// FileDataPart carries a reference to an uploaded file (used by Gemini native video/file support).
type FileDataPart struct {
	MimeType string `json:"mime_type"`
	FileURI  string `json:"file_uri"`
}

// CacheControl enables prompt caching for supported providers (e.g., Anthropic).
// Use Type: "ephemeral" for standard 5-minute caching.
// System prompts must be >1024 tokens for caching to activate.
type CacheControl struct {
	Type string `json:"type"`          // "ephemeral"
	TTL  string `json:"ttl,omitempty"` // Optional: "1h" for 1-hour cache
}

type ChatCompletionMessage struct {
	Role         ChatCompletionRole `json:"role"`
	Content      string             `json:"content"`
	ContentParts []ContentPart      `json:"content_parts,omitempty"`
	Reasoning    string             `json:"reasoning,omitempty"`
	CacheControl *CacheControl      `json:"cache_control,omitempty"`
	ToolID       string             `json:"tool_call_id,omitempty"`
	ToolCalls    []ToolCall         `json:"tool_calls,omitempty"`
}

// HasImages returns true when the message contains at least one image content part.
func (m ChatCompletionMessage) HasImages() bool {
	for _, p := range m.ContentParts {
		if p.Type == ContentPartImageURL && p.ImageURL != nil {
			return true
		}
	}
	return false
}

// TextContent returns the text portion of the message. If ContentParts are
// present it concatenates all text parts; otherwise it returns Content.
func (m ChatCompletionMessage) TextContent() string {
	if len(m.ContentParts) == 0 {
		return m.Content
	}
	var parts []string
	for _, p := range m.ContentParts {
		if p.Type == ContentPartText && p.Text != "" {
			parts = append(parts, p.Text)
		}
	}
	return strings.Join(parts, "\n")
}

type ChatCompletionUsage struct {
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	TotalTokens      int64 `json:"total_tokens"`
	CachedTokens     int64 `json:"cached_tokens,omitempty"`
}

type ChatCompletion struct {
	ID      string                 `json:"id"`
	Choices []ChatCompletionChoice `json:"choices"`
	Usage   ChatCompletionUsage    `json:"usage"`
}

type ChatCompletionChoice struct {
	Message ChatCompletionMessage `json:"message"`
}

type ChatCompletionChunk struct {
	Choices []ChatCompletionChunkChoice `json:"choices"`
	Usage   *ChatCompletionUsage        `json:"usage,omitempty"`
}

type ChatCompletionChunkChoice struct {
	Delta ChatCompletionChunkDelta `json:"delta"`
}

type ChatCompletionChunkDelta struct {
	Content   string     `json:"content"`
	Reasoning string     `json:"reasoning,omitempty"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

type ChatCompletionCreateParams struct {
	Model           string                  `json:"model"`
	Messages        []ChatCompletionMessage `json:"messages"`
	Temperature     *float64                `json:"temperature,omitempty"`
	ReasoningEffort string                  `json:"reasoning_effort,omitempty"`
	Tools           []ToolDefinition        `json:"tools,omitempty"`
}

type ToolDefinition struct {
	Type     string             `json:"type"`
	Function FunctionDefinition `json:"function"`
}

type FunctionDefinition struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Parameters  any    `json:"parameters,omitempty"`
}
