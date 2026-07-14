package run

import (
	"context"
	"encoding/json"
	"time"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	coreengine "github.com/TaskForceAI/core/pkg/engine"
	submissionservice "github.com/TaskForceAI/go-engine/pkg/run/internal/submission"
	submissioncontract "github.com/TaskForceAI/go-engine/pkg/run/submission"
)

const (
	MaxAttachments          = coreengine.MaxAttachments
	MaxAttachmentBytes      = coreengine.MaxAttachmentBytes
	MaxVideoBytes           = coreengine.MaxVideoAttachmentBytes
	MaxTotalAttachmentBytes = coreengine.MaxTotalAttachmentBytes
	videoGenerationModelID  = coreengine.VideoGenerationModelID

	attachmentTTL = 10 * time.Minute
)

type SubmissionTaskRegistrar = submissioncontract.TaskRegistrar
type StoreAttachmentsFunc = submissioncontract.AttachmentStore
type TaskSubmissionRequest = submissioncontract.Request
type TaskSubmissionDeps = submissioncontract.Dependencies
type TaskSubmissionResult = submissioncontract.Result
type TaskSubmissionErrorCode = submissioncontract.ErrorCode
type TaskSubmissionError = submissioncontract.Error

const (
	TaskSubmissionValidation  = submissioncontract.Validation
	TaskSubmissionEntitlement = submissioncontract.Entitlement
	TaskSubmissionStorage     = submissioncontract.Storage
	TaskSubmissionQueue       = submissioncontract.Queue
	TaskSubmissionCapacity    = submissioncontract.Capacity
	TaskSubmissionInternal    = submissioncontract.Internal
)

var (
	executeSubmittedTaskInline     = OrchestrateTask
	executeSubmittedTaskBackground = func(ctx context.Context, taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) {
		adapterhandler.Go("executeSubmittedTask_"+taskID, func() {
			executeSubmittedTaskInline(context.WithoutCancel(ctx), taskID, userID, prompt, modelID, opts)
		})
	}
	marshalTaskSubmissionIdempotency = json.Marshal
)

func newSubmissionService() *submissionservice.Service {
	return submissionservice.New(submissionservice.Runtime{
		RedisClient:            RedisClientGetter,
		AcquireExecutionSlot:   AcquireTaskExecutionSlot,
		CapacityError:          ErrTaskExecutionCapacity,
		DefaultAttachmentStore: StoreAttachments,
		ExecuteInline:          executeSubmittedTaskInline,
		ExecuteBackground:      executeSubmittedTaskBackground,
		StartObservation: func(ctx context.Context, req submissioncontract.Request) (context.Context, submissionservice.ObservationFinisher) {
			observedCtx, span := startSubmissionSpan(ctx, req)
			return observedCtx, func(startedAt time.Time, err error) {
				finishSubmissionObservation(observedCtx, span, startedAt, err)
			}
		},
		RecordQueueLatency: recordQueueLatency,
		MarshalReservation: marshalTaskSubmissionIdempotency,
	})
}

func SubmitTask(ctx context.Context, req TaskSubmissionRequest, deps TaskSubmissionDeps) (TaskSubmissionResult, error) {
	return newSubmissionService().Submit(ctx, req, deps)
}
