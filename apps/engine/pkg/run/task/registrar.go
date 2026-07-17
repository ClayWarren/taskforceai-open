package task

import (
	"context"
	"time"
)

type Registrar interface {
	Register(taskID string, userID int, prompt, modelID string, opts OrchestrateOptions) error
	Get(taskID string) *State
	MarkStarted(taskID string) bool
	MarkStartedWithError(taskID string) (bool, error)
	Heartbeat(ctx context.Context, taskID string) error
	Update(ctx context.Context, taskID string, status Status, result, errStr string) error
	UpdateWithConversation(ctx context.Context, taskID string, status Status, result, errStr string, conversationID int32, traceID string) error
	UpdateWithApproval(ctx context.Context, taskID string, approval *PendingApproval) error
	ClearApproval(ctx context.Context, taskID string) error
	UpdateProgress(taskID string, agentStatuses, toolEvents any, budgetUsage *BudgetUsage) error
}

type ListOptions struct {
	Limit int
}

const TTL = 1 * time.Hour
