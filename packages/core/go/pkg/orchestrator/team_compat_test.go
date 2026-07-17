package orchestrator

import "github.com/TaskForceAI/core/pkg/team"

// Test-only aliases keep legacy orchestrator fixtures concise while production
// callers use the dedicated team package directly.
type TeamService = team.Service
type TeamInboxStore = team.InboxStore
type TeamInfo = team.Team
type TeamMember = team.Member
type TeamTask = team.Task
type MemberStatus = team.MemberStatus
type ExecutionStatus = team.ExecutionStatus
type PlanApprovalStatus = team.PlanApprovalStatus
type TaskStatus = team.TaskStatus
type TaskPriority = team.TaskPriority
type Store = team.Store
type ModelInfo = team.ModelInfo
type ModelProvider = team.ModelProvider
type SessionManager = team.SessionManager
type Bus = team.Bus
type PermissionRule = team.PermissionRule
type SpawnInput = team.SpawnInput
type InMemTeamStore = team.InMemoryStore
type InMemoryTeamInbox = team.InMemoryInbox
type InMemBus = team.InMemoryBus

const (
	MemberStatusReady              = team.MemberStatusReady
	MemberStatusBusy               = team.MemberStatusBusy
	MemberStatusShutdownRequested  = team.MemberStatusShutdownRequested
	MemberStatusShutdown           = team.MemberStatusShutdown
	MemberStatusError              = team.MemberStatusError
	ExecutionStatusIdle            = team.ExecutionStatusIdle
	ExecutionStatusStarting        = team.ExecutionStatusStarting
	ExecutionStatusRunning         = team.ExecutionStatusRunning
	ExecutionStatusCancelRequested = team.ExecutionStatusCancelRequested
	ExecutionStatusCancelling      = team.ExecutionStatusCancelling
	ExecutionStatusCompleting      = team.ExecutionStatusCompleting
	ExecutionStatusCompleted       = team.ExecutionStatusCompleted
	ExecutionStatusCancelled       = team.ExecutionStatusCancelled
	ExecutionStatusFailed          = team.ExecutionStatusFailed
	ExecutionStatusTimedOut        = team.ExecutionStatusTimedOut
	PlanApprovalNone               = team.PlanApprovalNone
	PlanApprovalPending            = team.PlanApprovalPending
	PlanApprovalApproved           = team.PlanApprovalApproved
	PlanApprovalRejected           = team.PlanApprovalRejected
	TaskStatusPending              = team.TaskStatusPending
	TaskStatusInProgress           = team.TaskStatusInProgress
	TaskStatusCompleted            = team.TaskStatusCompleted
	TaskStatusCancelled            = team.TaskStatusCancelled
	TaskStatusBlocked              = team.TaskStatusBlocked
	TaskPriorityHigh               = team.TaskPriorityHigh
	TaskPriorityMedium             = team.TaskPriorityMedium
	TaskPriorityLow                = team.TaskPriorityLow
	MaxTeamMembers                 = team.MaxTeamMembers
	MaxInboxMessages               = team.MaxInboxMessages
	MaxHandlersPerEvent            = team.MaxHandlersPerEvent
	MAX_TEXT                       = team.MaxMessageTextBytes
)

var (
	ErrTeamNotFound          = team.ErrTeamNotFound
	ErrTeamAlreadyExists     = team.ErrTeamAlreadyExists
	ErrMemberNotFound        = team.ErrMemberNotFound
	ErrInvalidTransition     = team.ErrInvalidTransition
	NewTeamService           = team.NewService
	NewInMemTeamStore        = team.NewInMemoryStore
	NewInMemoryTeamInbox     = team.NewInMemoryInbox
	NewInMemBus              = team.NewInMemoryBus
	ValidateInboxName        = team.ValidateInboxName
	CanTransitionMember      = team.CanTransitionMember
	CanTransitionExecution   = team.CanTransitionExecution
	IsTerminalExecutionState = team.IsTerminalExecutionState
	NormalizeMember          = team.NormalizeMember
	NormalizeTeam            = team.NormalizeTeam
)
