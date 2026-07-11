package orchestrator

import (
	"testing"
)

func TestCanTransitionMember(t *testing.T) {
	tests := []struct {
		current MemberStatus
		next    MemberStatus
		want    bool
	}{
		{MemberStatusReady, MemberStatusBusy, true},
		{MemberStatusReady, MemberStatusShutdown, true},
		{MemberStatusShutdown, MemberStatusReady, false},
		{MemberStatusBusy, MemberStatusReady, true},
		{MemberStatusBusy, MemberStatusBusy, true},
		{MemberStatusError, MemberStatusReady, true},
		{MemberStatus("unknown"), MemberStatusReady, false},
		{MemberStatusShutdownRequested, MemberStatusReady, false},
	}

	for _, tt := range tests {
		got := CanTransitionMember(tt.current, tt.next)
		if got != tt.want {
			t.Errorf("CanTransitionMember(%v, %v) = %v; want %v", tt.current, tt.next, got, tt.want)
		}
	}
}

func TestCanTransitionExecution(t *testing.T) {
	tests := []struct {
		current ExecutionStatus
		next    ExecutionStatus
		want    bool
	}{
		{ExecutionStatusIdle, ExecutionStatusStarting, true},
		{ExecutionStatusStarting, ExecutionStatusRunning, true},
		{ExecutionStatusRunning, ExecutionStatusCompleting, true},
		{ExecutionStatusCompleting, ExecutionStatusCompleted, true},
		{ExecutionStatusCompleted, ExecutionStatusIdle, true},
		{ExecutionStatusRunning, ExecutionStatusCancelRequested, true},
		{ExecutionStatusCancelled, ExecutionStatusIdle, true},
		{ExecutionStatusCancelRequested, ExecutionStatusCancelled, true},
		{ExecutionStatusCancelling, ExecutionStatusFailed, true},
		{ExecutionStatusIdle, ExecutionStatusCompleted, false},
		{ExecutionStatus("unknown"), ExecutionStatusIdle, false},
		{ExecutionStatusRunning, ExecutionStatusRunning, true},
	}

	for _, tt := range tests {
		got := CanTransitionExecution(tt.current, tt.next)
		if got != tt.want {
			t.Errorf("CanTransitionExecution(%v, %v) = %v; want %v", tt.current, tt.next, got, tt.want)
		}
	}
}

func TestNormalizeMember(t *testing.T) {
	member := TeamMember{
		Name:   "test",
		Status: MemberStatusBusy,
	}
	normalized := NormalizeMember(member)
	if normalized.ExecutionStatus != ExecutionStatusRunning {
		t.Errorf("expected ExecutionStatusRunning, got %v", normalized.ExecutionStatus)
	}

	member2 := TeamMember{
		Name:   "test2",
		Status: MemberStatusReady,
	}
	normalized2 := NormalizeMember(member2)
	if normalized2.ExecutionStatus != ExecutionStatusIdle {
		t.Errorf("expected ExecutionStatusIdle, got %v", normalized2.ExecutionStatus)
	}
}

func TestIsTerminalExecutionState(t *testing.T) {
	tests := []struct {
		status ExecutionStatus
		want   bool
	}{
		{ExecutionStatusIdle, true},
		{ExecutionStatusCancelled, true},
		{ExecutionStatusCompleted, true},
		{ExecutionStatusFailed, true},
		{ExecutionStatusTimedOut, true},
		{ExecutionStatusRunning, false},
		{ExecutionStatusStarting, false},
		{ExecutionStatusCancelRequested, false},
		{ExecutionStatusCancelling, false},
		{ExecutionStatusCompleting, false},
		{ExecutionStatus("unknown"), false},
	}

	for _, tt := range tests {
		if got := IsTerminalExecutionState(tt.status); got != tt.want {
			t.Errorf("IsTerminalExecutionState(%v) = %v; want %v", tt.status, got, tt.want)
		}
	}
}
