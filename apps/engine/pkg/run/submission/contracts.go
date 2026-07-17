package submission

import (
	"context"

	attachmentcontract "github.com/TaskForceAI/go-engine/pkg/run/attachment"
	taskcontract "github.com/TaskForceAI/go-engine/pkg/run/task"
)

type TaskRegistrar interface {
	Register(taskID string, userID int, prompt, modelID string, opts taskcontract.OrchestrateOptions) error
	Get(taskID string) *taskcontract.State
}

type AttachmentStore func(ctx context.Context, attachments attachmentcontract.Collection, taskID string) error

type Request struct {
	UserID         int
	Prompt         string
	ModelID        string
	Options        taskcontract.OrchestrateOptions
	Source         string
	IsEval         bool
	Attachments    attachmentcontract.Collection
	TaskIDPrefix   string
	IdempotencyKey string
}

type Sender interface {
	Send(ctx context.Context, event any) (string, error)
}

type Dependencies struct {
	Registry         TaskRegistrar
	Inngest          Sender
	StoreAttachments AttachmentStore
	NewTaskID        func(prefix string) string
}

type Result struct {
	TaskID string
	Status taskcontract.Status
}

type ErrorCode string

const (
	Validation  ErrorCode = "validation"
	Entitlement ErrorCode = "entitlement"
	Storage     ErrorCode = "storage"
	Queue       ErrorCode = "queue"
	Capacity    ErrorCode = "capacity"
	Internal    ErrorCode = "internal"
)

type Error struct {
	Code ErrorCode
	Err  error
}

func (e *Error) Error() string {
	if e == nil || e.Err == nil {
		return "task submission failed"
	}
	return e.Err.Error()
}

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}
