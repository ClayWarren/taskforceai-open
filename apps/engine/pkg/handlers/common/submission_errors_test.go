package common

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/go-engine/pkg/run"
)

func TestMapTaskSubmissionError_Validation(t *testing.T) {
	submissionErr := &run.TaskSubmissionError{
		Code: run.TaskSubmissionValidation,
		Err:  errors.New("validation failed"),
	}

	err := MapTaskSubmissionError(submissionErr, nil)
	require.Error(t, err)
}

func TestMapTaskSubmissionError_Storage(t *testing.T) {
	submissionErr := &run.TaskSubmissionError{
		Code: run.TaskSubmissionStorage,
		Err:  errors.New("storage failed"),
	}

	logCalled := false
	logger := func(message string, args ...any) {
		logCalled = true
		assert.Equal(t, "Failed to store task attachments", message)
	}

	err := MapTaskSubmissionError(submissionErr, logger)
	require.Error(t, err)
	assert.True(t, logCalled)
}

func TestMapTaskSubmissionError_Queue(t *testing.T) {
	submissionErr := &run.TaskSubmissionError{
		Code: run.TaskSubmissionQueue,
		Err:  errors.New("queue failed"),
	}

	err := MapTaskSubmissionError(submissionErr, nil)
	require.Error(t, err)
}

func TestMapTaskSubmissionError_Internal(t *testing.T) {
	submissionErr := &run.TaskSubmissionError{
		Code: run.TaskSubmissionInternal,
		Err:  errors.New("internal error"),
	}

	err := MapTaskSubmissionError(submissionErr, nil)
	assert.Error(t, err)
}

func TestMapTaskSubmissionError_Capacity(t *testing.T) {
	submissionErr := &run.TaskSubmissionError{
		Code: run.TaskSubmissionCapacity,
		Err:  errors.New("capacity reached"),
	}

	err := MapTaskSubmissionError(submissionErr, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "capacity")
}

func TestMapTaskSubmissionError_Unknown(t *testing.T) {
	err := MapTaskSubmissionError(errors.New("unknown error"), nil)
	assert.Error(t, err)
}

func TestMapTaskSubmissionError_UnknownCode(t *testing.T) {
	submissionErr := &run.TaskSubmissionError{
		Code: run.TaskSubmissionErrorCode("unexpected"),
		Err:  errors.New("unexpected failure"),
	}

	err := MapTaskSubmissionError(submissionErr, nil)
	assert.Error(t, err)
}

func TestStorageFailureLogger_Type(t *testing.T) {
	var logger StorageFailureLogger = func(message string, args ...any) {
		assert.Equal(t, "test message", message)
	}
	logger("test message", "key", "value")
}
