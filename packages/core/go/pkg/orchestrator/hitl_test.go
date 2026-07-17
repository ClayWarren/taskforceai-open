package orchestrator

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/permission"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// MockPermissionChecker
type MockPermissionChecker struct {
	mock.Mock
}

func (m *MockPermissionChecker) Ask(req protocol.PermissionRequest) error {
	args := m.Called(req)
	return args.Error(0)
}

// MockApprovalRegistry
type MockApprovalRegistry struct {
	mock.Mock
}

func (m *MockApprovalRegistry) RequestApproval(ctx context.Context, req ApprovalRequest) error {
	args := m.Called(ctx, req)
	return args.Error(0)
}

func (m *MockApprovalRegistry) WaitForDecision(ctx context.Context, approvalID string) (bool, error) {
	args := m.Called(ctx, approvalID)
	return args.Bool(0), args.Error(1)
}

func (m *MockApprovalRegistry) WaitForExecutionDecision(ctx context.Context, approvalID string) (map[string]any, error) {
	args := m.Called(ctx, approvalID)
	result, _ := args.Get(0).(map[string]any)
	return result, args.Error(1)
}

func (m *MockApprovalRegistry) ClearApproval(ctx context.Context, approvalID string) error {
	args := m.Called(ctx, approvalID)
	return args.Error(0)
}

func TestHITLPermissionChecker_Ask(t *testing.T) {
	ctx := context.Background()
	req := protocol.PermissionRequest{Permission: "read"}

	t.Run("Base Allow", func(t *testing.T) {
		base := new(MockPermissionChecker)
		reg := new(MockApprovalRegistry)
		checker := NewHITLPermissionChecker(ctx, base, reg, "t1", "agent1")

		base.On("Ask", req).Return(nil)

		err := checker.Ask(req)
		require.NoError(t, err)
		base.AssertExpectations(t)
		reg.AssertNotCalled(t, "RequestApproval")
	})

	t.Run("Base Deny", func(t *testing.T) {
		base := new(MockPermissionChecker)
		reg := new(MockApprovalRegistry)
		checker := NewHITLPermissionChecker(ctx, base, reg, "t1", "agent1")

		base.On("Ask", req).Return(errors.New("denied"))

		err := checker.Ask(req)
		require.Error(t, err)
		assert.Equal(t, "denied", err.Error())
		base.AssertExpectations(t)
		reg.AssertNotCalled(t, "RequestApproval")
	})

	t.Run("Base Ask - Approved", func(t *testing.T) {
		base := new(MockPermissionChecker)
		reg := new(MockApprovalRegistry)
		checker := NewHITLPermissionChecker(ctx, base, reg, "t1", "agent1")
		var approvalID string

		base.On("Ask", req).Return(permission.ErrPermissionAsk)
		reg.On("RequestApproval", ctx, mock.MatchedBy(func(req ApprovalRequest) bool {
			approvalID = req.ApprovalID
			return strings.HasPrefix(req.ApprovalID, "t1:agent1:")
		})).Return(nil)
		reg.On("WaitForDecision", ctx, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "t1:agent1:")
		})).Return(true, nil)
		reg.On("ClearApproval", ctx, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "t1:agent1:")
		})).Return(nil)

		err := checker.Ask(req)
		require.NoError(t, err)
		base.AssertExpectations(t)
		reg.AssertExpectations(t)
	})

	t.Run("Base Ask - Denied", func(t *testing.T) {
		base := new(MockPermissionChecker)
		reg := new(MockApprovalRegistry)
		checker := NewHITLPermissionChecker(ctx, base, reg, "t1", "agent1")
		var approvalID string

		base.On("Ask", req).Return(permission.ErrPermissionAsk)
		reg.On("RequestApproval", ctx, mock.MatchedBy(func(req ApprovalRequest) bool {
			approvalID = req.ApprovalID
			return strings.HasPrefix(req.ApprovalID, "t1:agent1:")
		})).Return(nil)
		reg.On("WaitForDecision", ctx, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "t1:agent1:")
		})).Return(false, nil)
		reg.On("ClearApproval", ctx, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "t1:agent1:")
		})).Return(nil)

		err := checker.Ask(req)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "user denied")
		base.AssertExpectations(t)
		reg.AssertExpectations(t)
	})

	t.Run("Base Ask - Registry Error", func(t *testing.T) {
		base := new(MockPermissionChecker)
		reg := new(MockApprovalRegistry)
		checker := NewHITLPermissionChecker(ctx, base, reg, "t1", "agent1")

		base.On("Ask", req).Return(permission.ErrPermissionAsk)
		reg.On("RequestApproval", ctx, mock.Anything).Return(errors.New("reg error"))

		err := checker.Ask(req)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to request approval")
	})

	t.Run("Base Ask - Decision Error Clears Approval", func(t *testing.T) {
		base := new(MockPermissionChecker)
		reg := new(MockApprovalRegistry)
		checker := NewHITLPermissionChecker(ctx, base, reg, "t1", "agent1")
		var approvalID string

		base.On("Ask", req).Return(permission.ErrPermissionAsk)
		reg.On("RequestApproval", ctx, mock.MatchedBy(func(req ApprovalRequest) bool {
			approvalID = req.ApprovalID
			return strings.HasPrefix(req.ApprovalID, "t1:agent1:")
		})).Return(nil)
		reg.On("WaitForDecision", ctx, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "t1:agent1:")
		})).Return(false, errors.New("decision error"))
		reg.On("ClearApproval", ctx, mock.MatchedBy(func(id string) bool {
			return id == approvalID && strings.HasPrefix(id, "t1:agent1:")
		})).Return(nil)

		err := checker.Ask(req)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "decision wait failed")
		base.AssertExpectations(t)
		reg.AssertExpectations(t)
	})

	t.Run("Base Ask - No Registry", func(t *testing.T) {
		base := new(MockPermissionChecker)
		checker := NewHITLPermissionChecker(ctx, base, nil, "t1", "agent1")

		base.On("Ask", req).Return(permission.ErrPermissionAsk)

		err := checker.Ask(req)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no registry available")
	})
}
