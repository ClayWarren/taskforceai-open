package run

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	coreengine "github.com/TaskForceAI/core/pkg/engine"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/inngest/inngestgo"
)

const (
	MaxAttachments          = coreengine.MaxAttachments
	MaxAttachmentBytes      = coreengine.MaxAttachmentBytes
	MaxVideoBytes           = coreengine.MaxVideoAttachmentBytes
	MaxTotalAttachmentBytes = coreengine.MaxTotalAttachmentBytes
	videoGenerationModelID  = coreengine.VideoGenerationModelID

	attachmentTTL          = 10 * time.Minute
	idempotencyTTL         = 24 * time.Hour
	submissionQueueTimeout = 3 * time.Second
	submissionDLQTimeout   = 750 * time.Millisecond
	dlqTTL                 = 24 * time.Hour
	dlqStreamName          = "engine:task_submission:dead_letter"
	dlqCursorKey           = "engine:task_submission:dead_letter:cursor"
	dlqStreamMaxLen        = 2000
	dlqFallbackSeqKey      = "engine:task_submission:dead_letter:fallback:seq"
	dlqFallbackCursor      = "engine:task_submission:dead_letter:fallback:cursor"
	dlqFallbackPrefix      = "engine:task_submission:dead_letter:fallback:entry:"
)

type SubmissionTaskRegistrar interface {
	Register(taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) error
	Get(taskID string) *TaskState
}

type StoreAttachmentsFunc func(ctx context.Context, attachments Attachments, taskID string) error

type TaskSubmissionRequest struct {
	UserID         int
	Prompt         string
	ModelID        string
	Options        OrchestrateTaskOptions
	Source         string
	IsEval         bool
	Attachments    Attachments
	TaskIDPrefix   string
	IdempotencyKey string
}

type TaskSubmissionDeps struct {
	Registry         SubmissionTaskRegistrar
	Inngest          InngestSender
	StoreAttachments StoreAttachmentsFunc
	NewTaskID        func(prefix string) string
}

type TaskSubmissionResult struct {
	TaskID string
	Status TaskStatus
}

type TaskSubmissionErrorCode string

const (
	TaskSubmissionValidation TaskSubmissionErrorCode = "validation"
	TaskSubmissionStorage    TaskSubmissionErrorCode = "storage"
	TaskSubmissionQueue      TaskSubmissionErrorCode = "queue"
	TaskSubmissionCapacity   TaskSubmissionErrorCode = "capacity"
	TaskSubmissionInternal   TaskSubmissionErrorCode = "internal"
)

type TaskSubmissionError struct {
	Code TaskSubmissionErrorCode
	Err  error
}

var (
	submissionCircuitBreakerOnce   sync.Once
	submissionCircuitBreaker       *circuitbreaker.CircuitBreaker
	executeSubmittedTaskInline     = OrchestrateTask
	executeSubmittedTaskBackground = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
		adapterhandler.Go("executeSubmittedTask_"+taskID, func() {
			executeSubmittedTaskInline(context.WithoutCancel(ctx), taskID, userID, prompt, modelID, opts)
		})
	}
)

func init() {
	submissionCircuitBreakerOnce.Do(func() {
		submissionCircuitBreaker = circuitbreaker.New(circuitbreaker.Config{
			Name:                "engine_inngest_submission",
			FailureThreshold:    5,
			ResetTimeout:        30 * time.Second,
			SuccessThreshold:    2,
			MaxHalfOpenRequests: 1,
			IsTransient:         isRetryableInngestError,
		})
	})
}

func (e *TaskSubmissionError) Error() string {
	if e == nil || e.Err == nil {
		return "task submission failed"
	}
	return e.Err.Error()
}

func (e *TaskSubmissionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func SubmitTask(ctx context.Context, req TaskSubmissionRequest, deps TaskSubmissionDeps) (TaskSubmissionResult, error) {
	ctx, submissionSpan := startSubmissionSpan(ctx, req)
	startedAt := time.Now()
	var submissionErr error
	reservedIdempotencyKey := ""
	reservedIdempotencyTaskID := ""
	submissionLogAttrs := []any{
		"userId", req.UserID,
		"source", req.Source,
		"modelId", req.ModelID,
		"quickMode", req.Options.QuickModeEnabled,
		"attachmentCount", len(req.Attachments.Files),
		"hasIdempotencyKey", strings.TrimSpace(req.IdempotencyKey) != "",
	}
	slog.Info("[RunSubmission] Task submission started", submissionLogAttrs...)
	submissionStatus := "queued"
	defer func() {
		status := submissionStatus
		if submissionErr != nil {
			status = "failed"
		}
		slog.Info(
			"[RunSubmission] Task submission finished",
			append(submissionLogAttrs, "status", status, "durationMs", time.Since(startedAt).Milliseconds())...,
		)
		finishSubmissionObservation(ctx, submissionSpan, startedAt, submissionErr)
	}()

	fail := func(code TaskSubmissionErrorCode, err error) error {
		if reservedIdempotencyKey != "" {
			if releaseErr := releaseTaskSubmissionIdempotency(ctx, req.UserID, reservedIdempotencyKey, reservedIdempotencyTaskID); releaseErr != nil {
				slog.Warn("[RunSubmission] Failed to release idempotency reservation", "key", reservedIdempotencyKey, "error", releaseErr)
			}
			reservedIdempotencyKey = ""
			reservedIdempotencyTaskID = ""
		}
		submissionErr = &TaskSubmissionError{Code: code, Err: err}
		return submissionErr
	}

	if code, err := validateSubmissionRequest(req, deps); err != nil {
		return TaskSubmissionResult{}, fail(code, err)
	}

	prefix := req.TaskIDPrefix
	if prefix == "" {
		prefix = "task_"
	}
	taskID := makeTaskID(prefix, deps.NewTaskID)

	idempotencyKey := strings.TrimSpace(req.IdempotencyKey)
	if idempotencyKey != "" {
		idempotentResult, reserved := handleTaskSubmissionIdempotency(ctx, req.UserID, idempotencyKey, taskID, deps.Registry)
		if idempotentResult != nil {
			drainTaskSubmissionDeadLetterAsync(ctx, deps.Inngest)
			return *idempotentResult, nil
		}
		if reserved {
			reservedIdempotencyKey = idempotencyKey
			reservedIdempotencyTaskID = taskID
		}
	}

	executeQuickModeInline := !shouldExecuteQuickModeInBackground(req) && shouldExecuteQuickModeInline(req)
	var releaseTaskSlot func()
	if executeQuickModeInline {
		var acquired bool
		releaseTaskSlot, acquired = AcquireTaskExecutionSlot()
		if !acquired {
			return TaskSubmissionResult{}, fail(TaskSubmissionCapacity, ErrTaskExecutionCapacity)
		}
		defer releaseTaskSlot()
	}

	req.Options.AttachmentCount = len(req.Attachments.Files)
	if err := storeSubmissionAttachments(ctx, req, deps, taskID); err != nil {
		return TaskSubmissionResult{}, fail(TaskSubmissionStorage, err)
	}
	if len(req.Attachments.Files) > 0 {
		slog.Info("[RunSubmission] Attachments stored", "taskId", taskID, "attachmentCount", len(req.Attachments.Files), "userId", req.UserID)
	}

	if err := deps.Registry.Register(taskID, req.UserID, req.Prompt, req.ModelID, req.Options); err != nil {
		return TaskSubmissionResult{}, fail(TaskSubmissionInternal, fmt.Errorf("failed to register task: %w", err))
	}
	slog.Info("[RunSubmission] Task registered", "taskId", taskID, "userId", req.UserID, "modelId", req.ModelID, "quickMode", req.Options.QuickModeEnabled)
	if result, handled := executeSubmittedTaskLocally(ctx, req, deps, taskID, executeQuickModeInline, &submissionStatus); handled {
		return result, nil
	}
	drainTaskSubmissionDeadLetterAsync(ctx, deps.Inngest)

	queueStartedAt := time.Now()
	event := inngestgo.GenericEvent[map[string]any]{
		Name: "task.execute",
		Data: map[string]any{
			"taskId":  taskID,
			"userId":  req.UserID,
			"prompt":  req.Prompt,
			"modelId": req.ModelID,
			"options": req.Options,
			"source":  req.Source,
			"isEval":  req.IsEval,
		},
	}
	queueCtx, queueCancel := context.WithTimeout(ctx, submissionQueueTimeout)
	err := sendTaskEventWithResilience(queueCtx, deps.Inngest, event)
	queueCancel()
	recordQueueLatency(ctx, time.Since(queueStartedAt))
	if err != nil {
		// The dead letter must survive a canceled request, while retaining trace values.
		dlqCtx, dlqCancel := context.WithTimeout(context.WithoutCancel(ctx), submissionDLQTimeout)
		persistErr := persistTaskSubmissionDeadLetter(dlqCtx, taskID, event, err)
		dlqCancel()
		if persistErr != nil {
			slog.Warn("[RunSubmission] Failed to persist task dead-letter event", "taskId", taskID, "error", persistErr)
			return TaskSubmissionResult{}, fail(TaskSubmissionQueue, err)
		}
		reservedIdempotencyKey = ""
		reservedIdempotencyTaskID = ""
		submissionStatus = "dead_lettered"
		slog.Warn("[RunSubmission] Task execution event persisted for retry", "taskId", taskID, "queueError", err)
		drainTaskSubmissionDeadLetterAsync(ctx, deps.Inngest)
		return TaskSubmissionResult{TaskID: taskID, Status: StatusProcessing}, nil
	}
	reservedIdempotencyKey = ""
	reservedIdempotencyTaskID = ""
	slog.Info("[RunSubmission] Task execution event queued", "taskId", taskID, "userId", req.UserID, "queueDurationMs", time.Since(queueStartedAt).Milliseconds())

	return TaskSubmissionResult{
		TaskID: taskID,
		Status: StatusProcessing,
	}, nil
}

func validateSubmissionRequest(req TaskSubmissionRequest, deps TaskSubmissionDeps) (TaskSubmissionErrorCode, error) {
	if deps.Registry == nil {
		return TaskSubmissionInternal, fmt.Errorf("task registry is required")
	}
	if deps.Inngest == nil {
		return TaskSubmissionInternal, fmt.Errorf("inngest sender is required")
	}
	if err := ValidateTaskAttachments(req.Attachments); err != nil {
		return TaskSubmissionValidation, err
	}
	for _, file := range req.Attachments.Files {
		if coreengine.IsVideoAttachmentMIME(file.MimeType) && !coreengine.ModelSupportsVideoAttachments(req.ModelID) {
			return TaskSubmissionValidation, fmt.Errorf("video attachments are only supported with video-capable models")
		}
	}
	return TaskSubmissionErrorCode(""), nil
}

func storeSubmissionAttachments(ctx context.Context, req TaskSubmissionRequest, deps TaskSubmissionDeps, taskID string) error {
	if len(req.Attachments.Files) == 0 {
		return nil
	}
	store := deps.StoreAttachments
	if store == nil {
		store = StoreAttachments
	}
	return store(ctx, req.Attachments, taskID)
}

func executeSubmittedTaskLocally(ctx context.Context, req TaskSubmissionRequest, deps TaskSubmissionDeps, taskID string, quickModeInline bool, submissionStatus *string) (TaskSubmissionResult, bool) {
	if shouldExecuteQuickModeInBackground(req) {
		slog.Info("[RunSubmission] Executing computer-use quick-mode task in background", "taskId", taskID, "userId", req.UserID, "modelId", req.ModelID)
		executeSubmittedTaskBackground(ctx, taskID, req.UserID, req.Prompt, req.ModelID, req.Options)
		*submissionStatus = "background_processing"
		return TaskSubmissionResult{TaskID: taskID, Status: StatusProcessing}, true
	}
	if quickModeInline {
		startedAt := time.Now()
		slog.Info("[RunSubmission] Executing quick-mode task inline", "taskId", taskID, "userId", req.UserID, "modelId", req.ModelID)
		executeSubmittedTaskInline(ctx, taskID, req.UserID, req.Prompt, req.ModelID, req.Options)
		status := StatusProcessing
		if task := deps.Registry.Get(taskID); task != nil {
			status = task.Status
		}
		*submissionStatus = "inline_" + string(status)
		slog.Info("[RunSubmission] Quick-mode inline execution finished", "taskId", taskID, "userId", req.UserID, "status", status, "durationMs", time.Since(startedAt).Milliseconds())
		return TaskSubmissionResult{TaskID: taskID, Status: status}, true
	}
	if shouldExecuteLocalTaskInBackground(req) {
		slog.Info("[RunSubmission] Executing local task in background", "taskId", taskID, "userId", req.UserID, "modelId", req.ModelID, "quickMode", req.Options.QuickModeEnabled)
		executeSubmittedTaskBackground(ctx, taskID, req.UserID, req.Prompt, req.ModelID, req.Options)
		*submissionStatus = "background_processing"
		return TaskSubmissionResult{TaskID: taskID, Status: StatusProcessing}, true
	}
	return TaskSubmissionResult{}, false
}
