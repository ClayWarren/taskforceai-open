package run

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

var taskCancellationRegistry sync.Map
var taskCancellationPollIntervalNanos = (time.Second).Nanoseconds()

func getTaskCancellationPollInterval() time.Duration {
	return time.Duration(atomic.LoadInt64(&taskCancellationPollIntervalNanos))
}

func registerTaskCancellation(taskID string, cancel context.CancelFunc) func() {
	if taskID == "" || cancel == nil {
		return func() {}
	}
	taskCancellationRegistry.Store(taskID, cancel)
	return func() {
		taskCancellationRegistry.Delete(taskID)
	}
}

func CancelTaskExecution(taskID string) bool {
	if taskID == "" {
		return false
	}
	value, ok := taskCancellationRegistry.Load(taskID)
	if !ok {
		return false
	}
	cancel, ok := value.(context.CancelFunc)
	if !ok || cancel == nil {
		taskCancellationRegistry.Delete(taskID)
		return false
	}
	cancel()
	return true
}
