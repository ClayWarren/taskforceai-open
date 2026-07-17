package team

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
	return canTransition(memberTransitions, current, next)
}

func CanTransitionExecution(current, next ExecutionStatus) bool {
	return canTransition(executionTransitions, current, next)
}

func canTransition[T comparable](transitions map[T][]T, current, next T) bool {
	if current == next {
		return true
	}
	return slices.Contains(transitions[current], next)
}

func IsTerminalExecutionState(status ExecutionStatus) bool {
	switch status {
	case ExecutionStatusIdle, ExecutionStatusCancelled, ExecutionStatusCompleted, ExecutionStatusFailed, ExecutionStatusTimedOut:
		return true
	case ExecutionStatusStarting, ExecutionStatusRunning, ExecutionStatusCancelRequested, ExecutionStatusCancelling, ExecutionStatusCompleting:
		return false
	default:
		return false
	}
}

// NormalizeMember ensures execution_status is consistent with status
func NormalizeMember(member Member) Member {
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
func NormalizeTeam(team Team) Team {
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
