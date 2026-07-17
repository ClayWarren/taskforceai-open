package submission

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	coreengine "github.com/TaskForceAI/core/pkg/engine"
	attachmentservice "github.com/TaskForceAI/go-engine/pkg/run/internal/attachments"
	"github.com/TaskForceAI/go-engine/pkg/run/internal/entitlements"
	submissioncontract "github.com/TaskForceAI/go-engine/pkg/run/submission"
	taskcontract "github.com/TaskForceAI/go-engine/pkg/run/task"
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

type SubmissionTaskRegistrar = submissioncontract.TaskRegistrar
type StoreAttachmentsFunc = submissioncontract.AttachmentStore
type TaskSubmissionRequest = submissioncontract.Request
type TaskSubmissionDeps = submissioncontract.Dependencies
type TaskSubmissionResult = submissioncontract.Result
type TaskSubmissionErrorCode = submissioncontract.ErrorCode
type TaskSubmissionError = submissioncontract.Error
type TaskStatus = taskcontract.Status
type TaskState = taskcontract.State
type OrchestrateTaskOptions = taskcontract.OrchestrateOptions
type InngestSender = submissioncontract.Sender

const (
	TaskSubmissionValidation  = submissioncontract.Validation
	TaskSubmissionEntitlement = submissioncontract.Entitlement
	TaskSubmissionStorage     = submissioncontract.Storage
	TaskSubmissionQueue       = submissioncontract.Queue
	TaskSubmissionCapacity    = submissioncontract.Capacity
	TaskSubmissionInternal    = submissioncontract.Internal
	StatusProcessing          = taskcontract.StatusProcessing
)

var (
	submissionCircuitBreakerOnce sync.Once
	submissionCircuitBreaker     *circuitbreaker.CircuitBreaker
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

func (s *Service) Submit(ctx context.Context, req TaskSubmissionRequest, deps TaskSubmissionDeps) (TaskSubmissionResult, error) {
	ctx, finishObservation := s.runtime.StartObservation(ctx, req)
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
		finishObservation(startedAt, submissionErr)
	}()

	fail := func(code TaskSubmissionErrorCode, err error) error {
		if reservedIdempotencyKey != "" {
			if releaseErr := s.releaseTaskSubmissionIdempotency(ctx, req.UserID, reservedIdempotencyKey, reservedIdempotencyTaskID); releaseErr != nil {
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
		idempotentResult, reserved, idempotencyErr := s.handleTaskSubmissionIdempotency(ctx, req.UserID, idempotencyKey, taskID, deps.Registry)
		if idempotencyErr != nil {
			return TaskSubmissionResult{}, fail(TaskSubmissionStorage, idempotencyErr)
		}
		if idempotentResult != nil {
			s.drainTaskSubmissionDeadLetterAsync(ctx, deps.Inngest)
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
		releaseTaskSlot, acquired = s.runtime.AcquireExecutionSlot()
		if !acquired {
			return TaskSubmissionResult{}, fail(TaskSubmissionCapacity, s.runtime.CapacityError)
		}
		defer releaseTaskSlot()
	}

	req.Options.AttachmentCount = len(req.Attachments.Files)
	if err := s.storeSubmissionAttachments(ctx, req, deps, taskID); err != nil {
		return TaskSubmissionResult{}, fail(TaskSubmissionStorage, err)
	}
	if len(req.Attachments.Files) > 0 {
		slog.Info("[RunSubmission] Attachments stored", "taskId", taskID, "attachmentCount", len(req.Attachments.Files), "userId", req.UserID)
	}

	if err := deps.Registry.Register(taskID, req.UserID, req.Prompt, req.ModelID, req.Options); err != nil {
		return TaskSubmissionResult{}, fail(TaskSubmissionInternal, fmt.Errorf("failed to register task: %w", err))
	}
	slog.Info("[RunSubmission] Task registered", "taskId", taskID, "userId", req.UserID, "modelId", req.ModelID, "quickMode", req.Options.QuickModeEnabled)
	if result, handled := s.executeSubmittedTaskLocally(ctx, req, deps, taskID, executeQuickModeInline, &submissionStatus); handled {
		return result, nil
	}
	s.drainTaskSubmissionDeadLetterAsync(ctx, deps.Inngest)

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
	s.runtime.RecordQueueLatency(ctx, time.Since(queueStartedAt))
	if err != nil {
		// The dead letter must survive a canceled request, while retaining trace values.
		dlqCtx, dlqCancel := context.WithTimeout(context.WithoutCancel(ctx), submissionDLQTimeout)
		persistErr := s.persistTaskSubmissionDeadLetter(dlqCtx, taskID, event, err)
		dlqCancel()
		if persistErr != nil {
			slog.Warn("[RunSubmission] Failed to persist task dead-letter event", "taskId", taskID, "error", persistErr)
			return TaskSubmissionResult{}, fail(TaskSubmissionQueue, err)
		}
		reservedIdempotencyKey = ""
		reservedIdempotencyTaskID = ""
		submissionStatus = "dead_lettered"
		slog.Warn("[RunSubmission] Task execution event persisted for retry", "taskId", taskID, "queueError", err)
		s.drainTaskSubmissionDeadLetterAsync(ctx, deps.Inngest)
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
	if plan := strings.TrimSpace(req.Options.UserPlan); plan != "" {
		if err := entitlements.ValidateModels(plan, req.ModelID, req.Options.RoleModels); err != nil {
			return TaskSubmissionEntitlement, err
		}
	}
	if err := attachmentservice.ValidateTaskAttachments(req.Attachments); err != nil {
		return TaskSubmissionValidation, err
	}
	for _, file := range req.Attachments.Files {
		if coreengine.IsVideoAttachmentMIME(file.MimeType) && !coreengine.ModelSupportsVideoAttachments(req.ModelID) {
			return TaskSubmissionValidation, fmt.Errorf("video attachments are only supported with video-capable models")
		}
	}
	return TaskSubmissionErrorCode(""), nil
}

func (s *Service) storeSubmissionAttachments(ctx context.Context, req TaskSubmissionRequest, deps TaskSubmissionDeps, taskID string) error {
	if len(req.Attachments.Files) == 0 {
		return nil
	}
	store := deps.StoreAttachments
	if store == nil {
		store = s.runtime.DefaultAttachmentStore
	}
	if store == nil {
		return fmt.Errorf("attachment store is required")
	}
	return store(ctx, req.Attachments, taskID)
}

func (s *Service) executeSubmittedTaskLocally(ctx context.Context, req TaskSubmissionRequest, deps TaskSubmissionDeps, taskID string, quickModeInline bool, submissionStatus *string) (TaskSubmissionResult, bool) {
	if shouldExecuteQuickModeInBackground(req) {
		slog.Info("[RunSubmission] Executing computer-use quick-mode task in background", "taskId", taskID, "userId", req.UserID, "modelId", req.ModelID)
		s.runtime.ExecuteBackground(ctx, taskID, req.UserID, req.Prompt, req.ModelID, req.Options)
		*submissionStatus = "background_processing"
		return TaskSubmissionResult{TaskID: taskID, Status: StatusProcessing}, true
	}
	if quickModeInline {
		startedAt := time.Now()
		slog.Info("[RunSubmission] Executing quick-mode task inline", "taskId", taskID, "userId", req.UserID, "modelId", req.ModelID)
		s.runtime.ExecuteInline(ctx, taskID, req.UserID, req.Prompt, req.ModelID, req.Options)
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
		s.runtime.ExecuteBackground(ctx, taskID, req.UserID, req.Prompt, req.ModelID, req.Options)
		*submissionStatus = "background_processing"
		return TaskSubmissionResult{TaskID: taskID, Status: StatusProcessing}, true
	}
	return TaskSubmissionResult{}, false
}
