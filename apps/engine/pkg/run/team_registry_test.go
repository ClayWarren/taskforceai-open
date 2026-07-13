package run

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/TaskForceAI/core/pkg/orchestrator"
	"github.com/TaskForceAI/go-engine/pkg/teaminbox"
)

func resetTeamRegistryGlobals() {
	teamService = nil
	teamInbox = nil
	teamStore = nil
	teamOnce = sync.Once{}
}

func TestGetTeamService_ConcurrentReturnsSingleton(t *testing.T) {
	resetTeamRegistryGlobals()
	t.Cleanup(resetTeamRegistryGlobals)

	inbox := teaminbox.NewFilesystemTeamInbox(t.TempDir())
	store := orchestrator.NewInMemTeamStore()
	singleton := orchestrator.NewTeamService(
		store,
		inbox,
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		orchestrator.NewInMemBus(),
	)
	SetTeamService(singleton)

	const workers = 8
	results := make(chan *orchestrator.TeamService, workers)

	var wg sync.WaitGroup
	wg.Add(workers)
	for range workers {
		go func() {
			defer wg.Done()
			results <- GetTeamService()
		}()
	}
	wg.Wait()
	close(results)

	var first *orchestrator.TeamService
	for svc := range results {
		if svc == nil {
			t.Fatal("expected team service to be initialized")
		}
		if first == nil {
			first = svc
			continue
		}
		if first != svc {
			t.Fatal("expected all callers to receive the same singleton pointer")
		}
	}
}

func TestSetTeamService_OverridesSingleton(t *testing.T) {
	resetTeamRegistryGlobals()
	t.Cleanup(resetTeamRegistryGlobals)

	inbox := teaminbox.NewFilesystemTeamInbox(t.TempDir())
	store := orchestrator.NewInMemTeamStore()
	first := orchestrator.NewTeamService(
		store,
		inbox,
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		orchestrator.NewInMemBus(),
	)
	SetTeamService(first)

	second := orchestrator.NewTeamService(
		store,
		inbox,
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		orchestrator.NewInMemBus(),
	)
	SetTeamService(second)

	got := GetTeamService()
	if got != second {
		t.Fatal("expected SetTeamService to override the current service pointer")
	}
}

func TestGetTeamInbox_InitializedWithService(t *testing.T) {
	resetTeamRegistryGlobals()
	t.Cleanup(resetTeamRegistryGlobals)

	teamInbox = teaminbox.NewFilesystemTeamInbox(t.TempDir())
	teamStore = orchestrator.NewInMemTeamStore()
	teamService = orchestrator.NewTeamService(
		teamStore,
		teamInbox,
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		orchestrator.NewInMemBus(),
	)
	teamOnce.Do(func() {})

	inbox := GetTeamInbox()
	if inbox == nil {
		t.Fatal("expected team inbox to be initialized")
	}
}

func TestGetTeamService_DefaultInitializerStartsRecovery(t *testing.T) {
	resetTeamRegistryGlobals()
	t.Cleanup(resetTeamRegistryGlobals)

	svc := GetTeamService()
	if svc == nil {
		t.Fatal("expected default team service")
	}
	recoverTeamService(context.Background(), svc)
}

type failingTeamRecoverer struct{}

func (failingTeamRecoverer) Recover(context.Context) (int, error) {
	return 0, errors.New("recover failed")
}

func TestRecoverTeamServiceLogsError(t *testing.T) {
	recoverTeamService(context.Background(), failingTeamRecoverer{})
}
