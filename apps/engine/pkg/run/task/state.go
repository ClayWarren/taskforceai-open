package task

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
)

type Status string

const (
	StatusProcessing Status = "processing"
	StatusCompleted  Status = "completed"
	StatusFailed     Status = "failed"
	StatusCanceled   Status = "canceled"
	StatusAwaiting   Status = "awaiting_approval"
)

type State struct {
	TaskID          string             `json:"taskId"`
	Status          Status             `json:"status"`
	UserID          int                `json:"userId"`
	Prompt          string             `json:"prompt,omitempty"`
	ModelID         string             `json:"modelId,omitempty"`
	Options         OrchestrateOptions `json:"options"`
	Started         bool               `json:"started,omitempty"`
	UpdatedAt       int64              `json:"updatedAt,omitempty"`
	ProgressVersion int64              `json:"progressVersion,omitempty"`
	Result          string             `json:"result,omitempty"`
	Error           string             `json:"error,omitempty"`
	AgentStatuses   any                `json:"agentStatuses,omitempty"`
	ToolEvents      any                `json:"toolEvents,omitempty"`
	ConversationID  int32              `json:"conversationId,omitempty"`
	TraceID         string             `json:"traceId,omitempty"`
	PendingApproval *PendingApproval   `json:"pendingApproval,omitempty"`
	BudgetUsage     *BudgetUsage       `json:"budgetUsage,omitempty"`
}

func (t *State) UnmarshalJSON(data []byte) error {
	type stateAlias State
	aux := struct {
		ProgressVersion json.RawMessage `json:"progressVersion"`
		*stateAlias
	}{
		stateAlias: (*stateAlias)(t),
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
