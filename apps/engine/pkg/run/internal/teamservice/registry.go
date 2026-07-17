package teamservice

import (
	"context"
	"log/slog"
	"sync"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	coreteam "github.com/TaskForceAI/core/pkg/team"
	"github.com/TaskForceAI/go-engine/pkg/teaminbox"
)

var (
	teamService        *coreteam.Service
	teamInbox          coreteam.InboxStore
	teamStore          *coreteam.InMemoryStore
	teamSessionManager *orchestrator.TeamSessionManager
	teamOnce           sync.Once
)

func GetTeamService() *coreteam.Service {
	teamOnce.Do(func() {
		teamInbox = teaminbox.NewFilesystemTeamInbox("/tmp/taskforceai/inbox")
		teamStore = coreteam.NewInMemoryStore()
		teamSessionManager = &orchestrator.TeamSessionManager{}
		service := coreteam.NewService(
			teamStore,
			teamInbox,
			teamSessionManager,
			&orchestrator.TeamModelProvider{},
			coreteam.NewInMemoryBus(),
		)
		teamSessionManager.SetTeamService(service)
		teamService = service

		ctx := context.Background()
		// Init subscribes to bus events; failures are non-fatal and logged internally as Warn.
		service.Init(ctx)
		// Recover replays unread inbox messages for every previously-active team member.
		// It must run in a goroutine so it does not block sync.Once — callers blocked
		// inside Once (e.g. live HTTP handlers) would deadlock if Recover is slow or
		// waits on a downstream service during startup.
		handler.Go("teamServiceRecover", func() {
			recoverTeamService(ctx, service)
		})
	})
	return teamService
}

// GetTeamSessionManager returns the process-wide TeamSessionManager so a
// per-request orchestrator can refresh the client/config/registry new
// teammate spawns should use (see TeamRunnerDeps' doc comment for the
// last-request-wins tradeoff this makes).
func GetTeamSessionManager() *orchestrator.TeamSessionManager {
	GetTeamService()
	return teamSessionManager
}

type teamRecoverer interface {
	Recover(context.Context) (int, error)
}

func recoverTeamService(ctx context.Context, service teamRecoverer) {
	if _, err := service.Recover(ctx); err != nil {
		slog.Error("Failed to recover team service", "error", err)
	}
}

var SetTeamService = func(svc *coreteam.Service) {
	teamService = svc
	// Ensure teamOnce is marked as done so GetTeamService doesnt overwrite
	teamOnce.Do(func() {})
}

func GetTeamInbox() coreteam.InboxStore {
	GetTeamService()
	return teamInbox
}
