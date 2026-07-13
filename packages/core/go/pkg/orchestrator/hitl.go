package orchestrator

import (
	"context"

	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/TaskForceAI/core/pkg/hitl"
)

type HITLPermissionChecker = hitl.PermissionChecker

func NewHITLPermissionChecker(ctx context.Context, base protocol.PermissionChecker, registry IApprovalRegistry, taskID string, agentName string) *HITLPermissionChecker {
	return hitl.NewPermissionChecker(ctx, base, registry, taskID, agentName)
}
