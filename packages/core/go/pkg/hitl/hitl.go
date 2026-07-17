package hitl

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/TaskForceAI/core/pkg/enginecore/permission"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

type ApprovalRequest struct {
	ApprovalID string         `json:"approvalId,omitempty"`
	TaskID     string         `json:"taskId"`
	AgentName  string         `json:"agentName"`
	Permission string         `json:"permission"`
	Patterns   []string       `json:"patterns"`
	Metadata   map[string]any `json:"metadata"`
}

type ApprovalRegistry interface {
	RequestApproval(ctx context.Context, req ApprovalRequest) error
	WaitForExecutionDecision(ctx context.Context, approvalID string) (map[string]any, error)
	WaitForDecision(ctx context.Context, approvalID string) (bool, error)
	ClearApproval(ctx context.Context, approvalID string) error
}

// PermissionChecker wraps a base permission checker and blocks PermissionAsk
// results until an approval registry returns a decision for the approval ID.
type PermissionChecker struct {
	ctx       context.Context //nolint:containedctx // The checker owns the approval request lifecycle context.
	base      protocol.PermissionChecker
	registry  ApprovalRegistry
	taskID    string
	agentName string
}

var approvalIDSequence atomic.Uint64

func NewPermissionChecker(ctx context.Context, base protocol.PermissionChecker, registry ApprovalRegistry, taskID string, agentName string) *PermissionChecker {
	return &PermissionChecker{
		ctx:       ctx,
		base:      base,
		registry:  registry,
		taskID:    taskID,
		agentName: agentName,
	}
}

func (c *PermissionChecker) Ask(req protocol.PermissionRequest) error {
	if c.base == nil {
		return nil
	}

	err := c.base.Ask(req)
	if err == nil || !errors.Is(err, permission.ErrPermissionAsk) {
		return err
	}
	if c.registry == nil || c.taskID == "" {
		return errors.New("approval required but no registry available")
	}

	approvalID := c.nextApprovalID()
	approvalReq := ApprovalRequest{
		ApprovalID: approvalID,
		TaskID:     c.taskID,
		AgentName:  c.agentName,
		Permission: req.Permission,
		Patterns:   req.Patterns,
		Metadata:   req.Metadata,
	}
	if err := c.registry.RequestApproval(c.ctx, approvalReq); err != nil {
		return fmt.Errorf("hitl: failed to request approval: %w", err)
	}
	defer func() { _ = c.registry.ClearApproval(c.ctx, approvalID) }()

	approved, err := c.registry.WaitForDecision(c.ctx, approvalID)
	if err != nil {
		return fmt.Errorf("hitl: decision wait failed: %w", err)
	}
	if !approved {
		return errors.New("user denied this action")
	}
	return nil
}

func (c *PermissionChecker) nextApprovalID() string {
	agentName := strings.TrimSpace(c.agentName)
	if agentName == "" {
		agentName = "agent"
	}
	return fmt.Sprintf("%s:%s:%d:%d", c.taskID, agentName, time.Now().UnixNano(), approvalIDSequence.Add(1))
}
