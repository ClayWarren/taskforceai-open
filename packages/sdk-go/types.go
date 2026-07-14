package taskforceai

import (
	"time"

	"github.com/go-playground/validator/v10"
)

var submitTaskRequestValidator = validator.New()

// TaskForceAIOptions defines configuration for the TaskForceAI client.
type TaskForceAIOptions struct {
	APIKey       string
	BaseURL      string
	Timeout      time.Duration
	ResponseHook func(statusCode int, header map[string][]string)
	MockMode     bool
}

// ImageAttachment represents a base64-encoded image to include with a task prompt.
type ImageAttachment struct {
	Data     string `json:"data"`             // Base64-encoded image data
	MimeType string `json:"mime_type"`        // Image MIME type (e.g. "image/jpeg")
	Name     string `json:"name,omitempty"`   // Optional filename
	Detail   string `json:"detail,omitempty"` // Vision detail level: "auto", "low", or "high" (default: auto)
}

// TaskSubmissionOptions defines parameters for submitting a task.
type TaskSubmissionOptions struct {
	ModelID       string            `json:"modelId,omitempty"`
	Silent        bool              `json:"silent,omitempty"`
	Mock          bool              `json:"mock,omitempty"`
	Metadata      map[string]any    `json:"metadata,omitempty"`
	AttachmentIDs []string          `json:"-"`
	Images        []ImageAttachment `json:"-"` // Deprecated: uploaded first and sent as attachment_ids.
}

// TaskStatus represents the current state of a task.
type TaskStatus struct {
	TaskID   string         `json:"taskId"`
	Status   string         `json:"status"` // "processing", "completed", "failed", "canceled", "awaiting_approval"
	Result   *string        `json:"result,omitempty"`
	Error    *string        `json:"error,omitempty"`
	Warnings []string       `json:"warnings,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// TaskResult is a completed TaskStatus.
type TaskResult struct {
	TaskStatus
}

// TaskStatusCallback is called during polling or streaming.
type TaskStatusCallback func(status TaskStatus)

// SubmitTaskRequest represents the body of a task submission request.
type SubmitTaskRequest struct {
	Prompt        string                 `json:"prompt" validate:"required"`
	ModelID       string                 `json:"modelId,omitempty"`
	Options       *TaskSubmissionOptions `json:"options,omitempty"`
	AttachmentIDs []string               `json:"attachment_ids,omitempty"`
}

// Validate validates the SubmitTaskRequest struct.
func (r SubmitTaskRequest) Validate() error {
	return submitTaskRequestValidator.Struct(r)
}

// TaskStatusStream provides an interface for consuming task events.
type TaskStatusStream interface {
	Next() (TaskStatus, error)
	Close() error
	TaskID() string
}
