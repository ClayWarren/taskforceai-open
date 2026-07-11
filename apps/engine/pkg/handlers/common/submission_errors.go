package common

import (
	"errors"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/go-engine/pkg/run"
)

type StorageFailureLogger func(message string, args ...any)

func MapTaskSubmissionError(err error, logStorageFailure StorageFailureLogger) error {
	if submitErr, ok := errors.AsType[*run.TaskSubmissionError](err); ok {
		switch submitErr.Code {
		case run.TaskSubmissionValidation:
			return huma.Error422UnprocessableEntity(submitErr.Error())
		case run.TaskSubmissionStorage:
			if logStorageFailure != nil {
				logStorageFailure("Failed to store task attachments", "error", submitErr.Error())
			}
			return huma.Error500InternalServerError("Failed to process attachments")
		case run.TaskSubmissionQueue:
			return huma.Error500InternalServerError("Failed to queue task")
		case run.TaskSubmissionCapacity:
			return huma.Error429TooManyRequests("Task execution capacity reached, retry later")
		case run.TaskSubmissionInternal:
			return huma.Error500InternalServerError("Failed to start task")
		default:
			return huma.Error500InternalServerError("Failed to start task")
		}
	}

	return huma.Error500InternalServerError("Failed to start task")
}
