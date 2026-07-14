package taskcontrol

import (
	"context"
	"sync"
)

type CancellationRegistry struct {
	cancellations sync.Map
}

func (r *CancellationRegistry) Register(taskID string, cancel context.CancelFunc) func() {
	if taskID == "" || cancel == nil {
		return func() {}
	}
	r.cancellations.Store(taskID, cancel)
	return func() {
		r.cancellations.Delete(taskID)
	}
}

func (r *CancellationRegistry) Cancel(taskID string) bool {
	if taskID == "" {
		return false
	}
	value, ok := r.cancellations.Load(taskID)
	if !ok {
		return false
	}
	cancel, ok := value.(context.CancelFunc)
	if !ok || cancel == nil {
		r.cancellations.Delete(taskID)
		return false
	}
	cancel()
	return true
}
