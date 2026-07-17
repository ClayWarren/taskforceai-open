package teamservice

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/TaskForceAI/core/pkg/orchestrator"
	coreteam "github.com/TaskForceAI/core/pkg/team"
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
	store := coreteam.NewInMemoryStore()
	singleton := coreteam.NewService(
		store,
		inbox,
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		coreteam.NewInMemoryBus(),
	)
	SetTeamService(singleton)

	const workers = 8
	results := make(chan *coreteam.Service, workers)

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

	var first *coreteam.Service
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
	store := coreteam.NewInMemoryStore()
	first := coreteam.NewService(
		store,
		inbox,
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		coreteam.NewInMemoryBus(),
	)
	SetTeamService(first)

	second := coreteam.NewService(
		store,
		inbox,
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		coreteam.NewInMemoryBus(),
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
	teamStore = coreteam.NewInMemoryStore()
	teamService = coreteam.NewService(
		teamStore,
		teamInbox,
		&orchestrator.TeamSessionManager{},
		&orchestrator.TeamModelProvider{},
		coreteam.NewInMemoryBus(),
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

func TestGetTeamSessionManagerInitializesSingleton(t *testing.T) {
	resetTeamRegistryGlobals()
	t.Cleanup(resetTeamRegistryGlobals)

	manager := GetTeamSessionManager()
	if manager == nil || manager != teamSessionManager {
		t.Fatal("expected the process-wide team session manager")
	}
}

type failingTeamRecoverer struct{}

func (failingTeamRecoverer) Recover(context.Context) (int, error) {
	return 0, errors.New("recover failed")
}

func TestRecoverTeamServiceLogsError(t *testing.T) {
	recoverTeamService(context.Background(), failingTeamRecoverer{})
}
