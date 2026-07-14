package run

import submissionservice "github.com/TaskForceAI/go-engine/pkg/run/internal/submission"

const DefaultMaxConcurrentTaskExecutions = submissionservice.DefaultMaxConcurrentTaskExecutions

var (
	ErrTaskExecutionCapacity = submissionservice.ErrTaskExecutionCapacity
	acquireTaskExecutionSlot = submissionservice.AcquireTaskExecutionSlot
)

func AcquireTaskExecutionSlot() (func(), bool) {
	return acquireTaskExecutionSlot()
}

func TaskExecutionSlotCapacity() int {
	return submissionservice.TaskExecutionSlotCapacity()
}
