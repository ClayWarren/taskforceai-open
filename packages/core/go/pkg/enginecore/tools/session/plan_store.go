package session

import (
	"sync"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

// memoryPlanStore mirrors memoryTodoStore's shape: a mutex-guarded value
// behind a reference type, so plan-mode state set by plan_enter survives
// across tool calls even though ToolContext is passed by value.
type memoryPlanStore struct {
	mu     sync.Mutex
	active bool
}

func NewPlanStore() protocol.PlanStore {
	return &memoryPlanStore{}
}

func ClonePlanStore(store protocol.PlanStore) protocol.PlanStore {
	clone := &memoryPlanStore{}
	if store != nil && store.IsActive() {
		clone.active = true
	}
	return clone
}

func (s *memoryPlanStore) IsActive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.active
}

func (s *memoryPlanStore) Enter() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.active = true
}

func (s *memoryPlanStore) Exit() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.active = false
}
