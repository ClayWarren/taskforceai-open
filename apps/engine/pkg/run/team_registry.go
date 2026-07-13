package run

import (
	"context"
	"log/slog"
	"sync"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/TaskForceAI/go-engine/pkg/teaminbox"
)

var (
	teamService *orchestrator.TeamService
	teamInbox   orchestrator.TeamInboxStore
	teamStore   *orchestrator.InMemTeamStore
	teamOnce    sync.Once
)

func GetTeamService() *orchestrator.TeamService {
	teamOnce.Do(func() {
		teamInbox = teaminbox.NewFilesystemTeamInbox("/tmp/taskforceai/inbox")
		teamStore = orchestrator.NewInMemTeamStore()
		service := orchestrator.NewTeamService(
			teamStore,
			teamInbox,
			&orchestrator.TeamSessionManager{}, // Will need a real orchestrator ref later if we want full features
			&orchestrator.TeamModelProvider{},
			orchestrator.NewInMemBus(),
		)
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

type teamRecoverer interface {
	Recover(context.Context) (int, error)
}

func recoverTeamService(ctx context.Context, service teamRecoverer) {
	if _, err := service.Recover(ctx); err != nil {
		slog.Error("Failed to recover team service", "error", err)
	}
}

var SetTeamService = func(svc *orchestrator.TeamService) {
	teamService = svc
	// Ensure teamOnce is marked as done so GetTeamService doesnt overwrite
	teamOnce.Do(func() {})
}

func GetTeamInbox() orchestrator.TeamInboxStore {
	GetTeamService()
	return teamInbox
}
