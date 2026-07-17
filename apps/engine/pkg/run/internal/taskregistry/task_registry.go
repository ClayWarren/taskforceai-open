package taskregistry

import (
	"errors"
	"strings"
	"sync/atomic"
	"time"

	taskcontract "github.com/TaskForceAI/go-engine/pkg/run/task"
)

type TaskStatus = taskcontract.Status

const (
	StatusProcessing = taskcontract.StatusProcessing
	StatusCompleted  = taskcontract.StatusCompleted
	StatusFailed     = taskcontract.StatusFailed
	StatusCanceled   = taskcontract.StatusCanceled
	StatusAwaiting   = taskcontract.StatusAwaiting
)

type TaskState = taskcontract.State
type BudgetUsage = taskcontract.BudgetUsage
type PendingApproval = taskcontract.PendingApproval
type TaskRegistrar = taskcontract.Registrar
type OrchestrateTaskOptions = taskcontract.OrchestrateOptions

type TaskRegistry struct {
}

type TaskListOptions = taskcontract.ListOptions

const TaskTTL = taskcontract.TTL

const markStartedMaxWatchRetries = 3

// persistenceTimeout is the maximum time any single persistence operation
// (save/update-progress) is allowed to block, keeping goroutines from hanging
// indefinitely if Redis is unreachable at shutdown time.
const persistenceTimeout = 3 * time.Second

// activeTaskIndexTimeout keeps the optional active-task index from delaying task
// submission. The primary task state has already been persisted before this runs.
const activeTaskIndexTimeout = 750 * time.Millisecond

var (
	errTaskNotProcessing  = errors.New("task not processing")
	errTaskAlreadyStarted = errors.New("task already started")
	errTaskUnchanged      = errors.New("task unchanged")
	updateProgressVersion atomic.Int64
)

func isExpectedUpdateProgressNoopError(message string) bool {
	return message == "task not found" ||
		message == "task not processing" ||
		message == "stale updatedAt" ||
		message == "stale progressVersion"
}

func isUpdateProgressValidationError(message string) bool {
	if strings.HasPrefix(message, "invalid agentStatuses json") ||
		strings.HasPrefix(message, "invalid toolEvents json") ||
		strings.HasPrefix(message, "invalid budgetUsage json") {
		return true
	}

	switch message {
	case "invalid args",
		"invalid agentStatuses shape",
		"invalid toolEvents shape",
		"invalid budgetUsage shape",
		"invalid updatedAt",
		"invalid progressVersion",
		"invalid ttl",
		"corrupt task data":
		return true
	default:
		return false
	}
}

func isTerminalTaskStatus(status TaskStatus) bool {
	return status == StatusCompleted || status == StatusFailed || status == StatusCanceled
}

func nextProgressVersion(now time.Time) int64 {
	candidate := now.UnixMicro()
	// CAS loop ensures monotonically increasing versions even under concurrent callers.
	// We prefer this over atomic.AddInt64 because the time-base (UnixMicro) gives ordering
	// semantics that a plain counter would lose. Contention is expected to be very low
	// (only concurrent progress updates for the same task) so the loop is bounded in practice.
	for {
		current := updateProgressVersion.Load()
		if candidate <= current {
			candidate = current + 1
		}
		if updateProgressVersion.CompareAndSwap(current, candidate) {
			return candidate
		}
	}
}
