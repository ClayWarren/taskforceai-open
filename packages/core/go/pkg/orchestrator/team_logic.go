package orchestrator

import (
	"errors"
	"slices"
)

var memberTransitions = map[MemberStatus][]MemberStatus{
	MemberStatusReady:             {MemberStatusBusy, MemberStatusShutdownRequested, MemberStatusShutdown, MemberStatusError},
	MemberStatusBusy:              {MemberStatusReady, MemberStatusShutdownRequested, MemberStatusError},
	MemberStatusShutdownRequested: {MemberStatusShutdown, MemberStatusError},
	MemberStatusShutdown:          {},
	MemberStatusError:             {MemberStatusReady, MemberStatusShutdownRequested, MemberStatusShutdown},
}

var executionTransitions = map[ExecutionStatus][]ExecutionStatus{
	ExecutionStatusIdle:            {ExecutionStatusStarting},
	ExecutionStatusStarting:        {ExecutionStatusRunning, ExecutionStatusCancelRequested, ExecutionStatusCancelling, ExecutionStatusFailed, ExecutionStatusTimedOut},
	ExecutionStatusRunning:         {ExecutionStatusCancelRequested, ExecutionStatusCancelling, ExecutionStatusCompleting, ExecutionStatusFailed, ExecutionStatusTimedOut},
	ExecutionStatusCancelRequested: {ExecutionStatusCancelling, ExecutionStatusCancelled, ExecutionStatusFailed, ExecutionStatusTimedOut},
	ExecutionStatusCancelling:      {ExecutionStatusCancelled, ExecutionStatusFailed, ExecutionStatusTimedOut},
	ExecutionStatusCancelled:       {ExecutionStatusIdle},
	ExecutionStatusCompleting:      {ExecutionStatusCompleted, ExecutionStatusFailed, ExecutionStatusTimedOut},
	ExecutionStatusCompleted:       {ExecutionStatusIdle},
	ExecutionStatusFailed:          {ExecutionStatusIdle},
	ExecutionStatusTimedOut:        {ExecutionStatusIdle},
}

func CanTransitionMember(current, next MemberStatus) bool {
	if current == next {
		return true
	}
	allowed, ok := memberTransitions[current]
	if !ok {
		return false
	}
	return slices.Contains(allowed, next)
}

func CanTransitionExecution(current, next ExecutionStatus) bool {
	if current == next {
		return true
	}
	allowed, ok := executionTransitions[current]
	if !ok {
		return false
	}
	return slices.Contains(allowed, next)
}

func IsTerminalExecutionState(status ExecutionStatus) bool {
	switch status {
	case ExecutionStatusIdle, ExecutionStatusCancelled, ExecutionStatusCompleted, ExecutionStatusFailed, ExecutionStatusTimedOut:
		return true
	case ExecutionStatusStarting, ExecutionStatusRunning, ExecutionStatusCancelRequested, ExecutionStatusCancelling, ExecutionStatusCompleting:
		return false
	}
	return false
}

// NormalizeMember ensures execution_status is consistent with status
func NormalizeMember(member TeamMember) TeamMember {
	if member.ExecutionStatus == "" {
		if member.Status == MemberStatusBusy {
			member.ExecutionStatus = ExecutionStatusRunning
		} else {
			member.ExecutionStatus = ExecutionStatusIdle
		}
	}
	return member
}

// NormalizeTeam normalizes all members in a team
func NormalizeTeam(team TeamInfo) TeamInfo {
	for i, m := range team.Members {
		team.Members[i] = NormalizeMember(m)
	}
	return team
}

// Errors
var (
	ErrTeamNotFound      = errors.New("team not found")
	ErrTeamAlreadyExists = errors.New("team already exists")
	ErrMemberNotFound    = errors.New("teammate not found")
	ErrInvalidTransition = errors.New("invalid status transition")
)
