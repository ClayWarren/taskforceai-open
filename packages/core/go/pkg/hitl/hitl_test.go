package hitl

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/enginecore/permission"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
)

type testPermissionChecker struct {
	err error
}

func (c testPermissionChecker) Ask(protocol.PermissionRequest) error {
	return c.err
}

type testApprovalRegistry struct {
	request      ApprovalRequest
	requestErr   error
	waitApproved bool
	waitErr      error
	cleared      string
}

func (r *testApprovalRegistry) RequestApproval(ctx context.Context, req ApprovalRequest) error {
	r.request = req
	return r.requestErr
}

func (r *testApprovalRegistry) WaitForExecutionDecision(ctx context.Context, approvalID string) (map[string]any, error) {
	return nil, nil
}

func (r *testApprovalRegistry) WaitForDecision(ctx context.Context, approvalID string) (bool, error) {
	return r.waitApproved, r.waitErr
}

func (r *testApprovalRegistry) ClearApproval(ctx context.Context, approvalID string) error {
	r.cleared = approvalID
	return nil
}

func TestPermissionCheckerAskBranches(t *testing.T) {
	req := protocol.PermissionRequest{
		Permission: "shell.exec",
		Patterns:   []string{"go test"},
		Metadata:   map[string]any{"cwd": "/tmp"},
	}

	if err := NewPermissionChecker(context.Background(), nil, nil, "", "").Ask(req); err != nil {
		t.Fatalf("nil base should allow request, got %v", err)
	}

	baseErr := errors.New("base failed")
	if err := NewPermissionChecker(context.Background(), testPermissionChecker{err: baseErr}, nil, "", "").Ask(req); !errors.Is(err, baseErr) {
		t.Fatalf("expected base error, got %v", err)
	}

	err := NewPermissionChecker(context.Background(), testPermissionChecker{err: permission.ErrPermissionAsk}, nil, "", "").Ask(req)
	if err == nil || !strings.Contains(err.Error(), "no registry") {
		t.Fatalf("expected missing registry error, got %v", err)
	}

	reg := &testApprovalRegistry{requestErr: errors.New("request failed")}
	err = NewPermissionChecker(context.Background(), testPermissionChecker{err: permission.ErrPermissionAsk}, reg, "task-1", "agent-1").Ask(req)
	if err == nil || !strings.Contains(err.Error(), "failed to request approval") {
		t.Fatalf("expected request approval error, got %v", err)
	}

	reg = &testApprovalRegistry{waitErr: errors.New("wait failed")}
	err = NewPermissionChecker(context.Background(), testPermissionChecker{err: permission.ErrPermissionAsk}, reg, "task-1", "agent-1").Ask(req)
	if err == nil || !strings.Contains(err.Error(), "decision wait failed") {
		t.Fatalf("expected wait error, got %v", err)
	}
	if reg.cleared == "" {
		t.Fatal("expected approval to be cleared after wait error")
	}

	reg = &testApprovalRegistry{}
	err = NewPermissionChecker(context.Background(), testPermissionChecker{err: permission.ErrPermissionAsk}, reg, "task-1", "").Ask(req)
	if err == nil || !strings.Contains(err.Error(), "denied") {
		t.Fatalf("expected denial error, got %v", err)
	}
	if !strings.Contains(reg.request.ApprovalID, "task-1:agent:") {
		t.Fatalf("expected default agent approval id, got %q", reg.request.ApprovalID)
	}

	reg = &testApprovalRegistry{waitApproved: true}
	err = NewPermissionChecker(context.Background(), testPermissionChecker{err: permission.ErrPermissionAsk}, reg, "task-1", "agent-1").Ask(req)
	if err != nil {
		t.Fatalf("expected approval success, got %v", err)
	}
	if reg.request.Permission != req.Permission || reg.cleared == "" {
		t.Fatalf("approval request/clear not recorded: %#v cleared=%q", reg.request, reg.cleared)
	}
}
