package stream

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/go-engine/pkg/run"
)

const recoveryLeaseInterval = 15 * time.Second
const staleRecoveryThreshold = 30 * time.Second

var recoveryLease = newRecoveryLeaseMap(recoveryLeaseInterval)

// recoveryLeaseMap is a TTL-bounded replacement for a bare sync.Map.
// Entries are evicted inline on access and by a background sweep goroutine,
// so the map never accumulates entries for tasks that have long since finished.
type recoveryLeaseMap struct {
	mu       sync.Mutex
	entries  map[string]time.Time
	sweepTTL time.Duration // entries older than this are evicted by sweep()
}

func newRecoveryLeaseMap(sweepInterval time.Duration) *recoveryLeaseMap {
	m := &recoveryLeaseMap{entries: make(map[string]time.Time), sweepTTL: sweepInterval}
	handler.Go("recoveryLeaseMapSweep", func() {
		ticker := time.NewTicker(sweepInterval)
		defer ticker.Stop()
		for range ticker.C {
			m.sweep()
		}
	})
	return m
}

// acquire returns true and records the current time when the taskID either has
// no entry or its last-acquired time is older than ttl. Stale entries are
// evicted inline so they never accumulate.
func (m *recoveryLeaseMap) acquire(taskID string, ttl time.Duration) bool {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	if last, ok := m.entries[taskID]; ok && now.Sub(last) < ttl {
		return false
	}
	m.entries[taskID] = now
	return true
}

func (m *recoveryLeaseMap) sweep() {
	now := time.Now()
	tTL := m.sweepTTL
	if tTL <= 0 {
		tTL = recoveryLeaseInterval
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, last := range m.entries {
		if now.Sub(last) >= tTL {
			delete(m.entries, k)
		}
	}
}

func (h *streamHandler) triggerRecovery(task *run.TaskState) {
	if !acquireRecoveryLease(h.taskID) {
		return
	}
	slog.Info("[Stream] Task stale, triggering orchestration recovery", "taskId", h.taskID, "lastUpdate", task.UpdatedAt, "taskStarted", task.Started)
	handler.Go("orchestrateTaskRecovery", func() {
		recoveryCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		orchestrateTask(recoveryCtx, task.TaskID, task.UserID, task.Prompt, task.ModelID, task.Options)
	})
}

func acquireRecoveryLease(taskID string) bool {
	return recoveryLease.acquire(taskID, recoveryLeaseInterval)
}
