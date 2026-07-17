package team

import (
	"context"
)

type Store interface {
	GetTeam(ctx context.Context, name string) (*Team, error)
	SaveTeam(ctx context.Context, team *Team) error
	ListTeams(ctx context.Context) ([]Team, error)
	GetTasks(ctx context.Context, teamName string) ([]Task, error)
	SaveTasks(ctx context.Context, teamName string, tasks []Task) error
	DeleteTeam(ctx context.Context, name string) error
	FindBySession(ctx context.Context, sessionID string) (*Team, string, string, error)
}

type ModelProvider interface {
	ParseModel(model string) (ModelInfo, error)
	GetModel(ctx context.Context, providerID, modelID string) (any, error)
	DefaultModel(ctx context.Context) (ModelInfo, error)
}

type SessionManager interface {
	InjectMessage(ctx context.Context, sessionID, fromName, text, inboxMessageID string) error
	AutoWake(ctx context.Context, sessionID string) error
	GetSessionInfo(ctx context.Context, sessionID string) (agentName string, modelProvider string, modelID string, err error)
	UpdatePermissions(ctx context.Context, sessionID string, removePattern string) error
	RestoreLeadPermissions(ctx context.Context, sessionID string, writeTools []string) error
	CancelPrompt(ctx context.Context, sessionID string) error
	RemoveSession(ctx context.Context, sessionID string) error
	CreateSession(ctx context.Context, parentID, agentName, title string, permissions []PermissionRule) (string, error)
	StartPromptLoop(ctx context.Context, sessionID string) error
	GetLastUserMessageModel(ctx context.Context, sessionID string) (*ModelInfo, error)
}

type Bus interface {
	Publish(ctx context.Context, event string, properties any) error
	Subscribe(ctx context.Context, event string, handler func(context.Context, map[string]any) error) error
}

type InboxStore interface {
	Write(teamName, to string, msg InboxMessage) error
	ReadAll(teamName, agentName string) ([]InboxMessage, error)
	Unread(teamName, agentName string) ([]InboxMessage, error)
	MarkRead(teamName, agentName string) ([]InboxMessage, error)
	Remove(teamName, agentName string) error
}

// SpawnBudget owns the policy decision for whether another team member may be
// started. The team domain depends on this narrow capability instead of an
// orchestrator budget implementation.
type SpawnBudget interface {
	CheckSpawnAvailable() error
}
