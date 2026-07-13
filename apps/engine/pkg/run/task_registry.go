package run

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

type TaskStatus string

const (
	StatusProcessing TaskStatus = "processing"
	StatusCompleted  TaskStatus = "completed"
	StatusFailed     TaskStatus = "failed"
	StatusCanceled   TaskStatus = "canceled"
	StatusAwaiting   TaskStatus = "awaiting_approval"
)

type TaskState struct {
	TaskID          string                 `json:"taskId"`
	Status          TaskStatus             `json:"status"`
	UserID          int                    `json:"userId"`
	Prompt          string                 `json:"prompt,omitempty"`
	ModelID         string                 `json:"modelId,omitempty"`
	Options         OrchestrateTaskOptions `json:"options"`
	Started         bool                   `json:"started,omitempty"`
	UpdatedAt       int64                  `json:"updatedAt,omitempty"`
	ProgressVersion int64                  `json:"progressVersion,omitempty"`
	Result          string                 `json:"result,omitempty"`
	Error           string                 `json:"error,omitempty"`
	AgentStatuses   any                    `json:"agentStatuses,omitempty"`
	ToolEvents      any                    `json:"toolEvents,omitempty"`
	ConversationID  int32                  `json:"conversationId,omitempty"`
	TraceID         string                 `json:"traceId,omitempty"`
	PendingApproval *PendingApproval       `json:"pendingApproval,omitempty"`
	BudgetUsage     *BudgetUsage           `json:"budgetUsage,omitempty"`
}

func (t *TaskState) UnmarshalJSON(data []byte) error {
	type taskStateAlias TaskState
	aux := struct {
		ProgressVersion json.RawMessage `json:"progressVersion"`
		*taskStateAlias
	}{
		taskStateAlias: (*taskStateAlias)(t),
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if len(aux.ProgressVersion) == 0 || string(aux.ProgressVersion) == "null" {
		return nil
	}
	progressVersion, err := parseJSONInt64(aux.ProgressVersion)
	if err != nil {
		return fmt.Errorf("progressVersion: %w", err)
	}
	t.ProgressVersion = progressVersion
	return nil
}

func parseJSONInt64(raw json.RawMessage) (int64, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return 0, errors.New("empty integer")
	}
	if value, ok, err := parsePlainJSONInt64Bytes(trimmed); ok || err != nil {
		return value, err
	}

	text := string(trimmed)
	for len(text) >= 2 && text[0] == '"' {
		unquoted, err := strconv.Unquote(text)
		if err != nil {
			break
		}
		text = strings.TrimSpace(unquoted)
	}
	if text == "" {
		return 0, errors.New("empty integer")
	}
	if isPlainJSONInteger(text) {
		value, err := strconv.ParseInt(text, 10, 64)
		if err == nil {
			return value, nil
		}
		if errors.Is(err, strconv.ErrRange) {
			return 0, errors.New("integer out of range")
		}
	}

	number, _, err := big.ParseFloat(text, 10, 128, big.ToNearestEven)
	if err != nil {
		return 0, err
	}
	integer, accuracy := number.Int(nil)
	if accuracy != big.Exact {
		return 0, errors.New("not an integer")
	}
	if !integer.IsInt64() {
		return 0, errors.New("integer out of range")
	}
	return integer.Int64(), nil
}

func parsePlainJSONInt64Bytes(text []byte) (int64, bool, error) {
	if len(text) == 0 {
		return 0, false, nil
	}
	negative := false
	start := 0
	if text[0] == '-' || text[0] == '+' {
		if len(text) == 1 {
			return 0, false, nil
		}
		negative = text[0] == '-'
		start = 1
	}
	limit := uint64(1<<63 - 1)
	if negative {
		limit = 1 << 63
	}
	var value uint64
	for i := start; i < len(text); i++ {
		c := text[i]
		if c < '0' || c > '9' {
			return 0, false, nil
		}
		digit := uint64(c - '0')
		if value > (limit-digit)/10 {
			return 0, true, errors.New("integer out of range")
		}
		value = value*10 + digit
	}
	if negative {
		if value == 1<<63 {
			return -1 << 63, true, nil
		}
		return -int64(value), true, nil
	}
	return int64(value), true, nil
}

func isPlainJSONInteger(text string) bool {
	if text == "" {
		return false
	}
	start := 0
	if text[0] == '-' || text[0] == '+' {
		if len(text) == 1 {
			return false
		}
		start = 1
	}
	for i := start; i < len(text); i++ {
		if text[i] < '0' || text[i] > '9' {
			return false
		}
	}
	return true
}

type BudgetUsage struct {
	InitialUSD   *float64 `json:"initialUsd,omitempty"`
	ConsumedUSD  float64  `json:"consumedUsd"`
	RemainingUSD *float64 `json:"remainingUsd,omitempty"`
}

type PendingApproval struct {
	ApprovalID string         `json:"approvalId,omitempty"`
	Permission string         `json:"permission"`
	AgentName  string         `json:"agentName"`
	Patterns   []string       `json:"patterns"`
	Metadata   map[string]any `json:"metadata"`
}

type TaskRegistrar interface {
	Register(taskID string, userID int, prompt, modelID string, opts OrchestrateTaskOptions) error
	Get(taskID string) *TaskState
	MarkStarted(taskID string) bool
	MarkStartedWithError(taskID string) (bool, error)
	Heartbeat(ctx context.Context, taskID string) error
	Update(ctx context.Context, taskID string, status TaskStatus, result, errStr string) error
	UpdateWithConversation(ctx context.Context, taskID string, status TaskStatus, result, errStr string, conversationID int32, traceID string) error
	UpdateWithApproval(ctx context.Context, taskID string, approval *PendingApproval) error
	ClearApproval(ctx context.Context, taskID string) error
	UpdateProgress(taskID string, agentStatuses, toolEvents any, budgetUsage *BudgetUsage) error
}

type TaskRegistry struct {
}

type TaskListOptions struct {
	Limit int
}

var defaultRegistry TaskRegistrar = &TaskRegistry{}

func GetRegistry() TaskRegistrar {
	return defaultRegistry
}

var SetRegistry = func(r TaskRegistrar) {
	defaultRegistry = r
}

const TaskTTL = 1 * time.Hour

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
