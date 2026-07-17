package team

import (
	"context"
	"errors"
	"testing"
)

type selectiveCancelSessions struct {
	mockSessions
	failID string
}

func (s *selectiveCancelSessions) CancelPrompt(ctx context.Context, sessionID string) error {
	if sessionID == s.failID {
		return errors.New("cancel failed")
	}
	return nil
}

func TestTeamServiceEventsCoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("handle member status changed auto cleans shutdown teams", func(t *testing.T) {
		store := &mockStore{
			teams: map[string]*Team{
				"auto-clean": {
					Name:          "auto-clean",
					LeadSessionID: "lead",
					Members: []Member{
						{Name: "worker", SessionID: "worker", Status: MemberStatusShutdown},
					},
				},
			},
			tasks: map[string][]Task{},
		}
		svc := NewService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})
		if err := svc.handleMemberStatusChanged(ctx, map[string]any{
			"status":   string(MemberStatusShutdown),
			"teamName": "auto-clean",
		}); err != nil {
			t.Fatalf("handle member status changed: %v", err)
		}
		if _, ok := store.teams["auto-clean"]; ok {
			t.Fatal("expected team to be cleaned up")
		}
	})

	t.Run("cancel member tolerates transition failures and cancel all continues", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore: &mockStore{
				teams: map[string]*Team{
					"cancel-team": {
						Name:          "cancel-team",
						LeadSessionID: "lead",
						Members: []Member{
							{Name: "worker", SessionID: "worker-ses", Status: MemberStatusBusy, ExecutionStatus: ExecutionStatusRunning},
							{Name: "broken", SessionID: "broken-ses", Status: MemberStatusBusy, ExecutionStatus: ExecutionStatusRunning},
						},
					},
				},
				tasks: map[string][]Task{},
			},
			saveTeamErr: errors.New("save failed"),
		}
		svc := NewService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})

		cancelled, err := svc.CancelMember(ctx, "cancel-team", "worker")
		if err != nil || !cancelled {
			t.Fatalf("expected cancel to succeed despite transition warnings, cancelled=%v err=%v", cancelled, err)
		}

		sessions := &selectiveCancelSessions{failID: "broken-ses"}
		svc.sessions = sessions
		count, err := svc.CancelAll(ctx, "cancel-team")
		if err != nil {
			t.Fatalf("cancel all: %v", err)
		}
		if count != 1 {
			t.Fatalf("expected one successful cancel before prompt failure, got %d", count)
		}
	})

	t.Run("cleanup tolerates inbox remove and publish failures", func(t *testing.T) {
		inbox := newTestTeamInbox(t.TempDir())
		inbox.removeErr = errors.New("remove failed")
		store := &mockStore{
			teams: map[string]*Team{
				"cleanup-team": {
					Name:          "cleanup-team",
					LeadSessionID: "lead",
					Members: []Member{
						{Name: "worker", SessionID: "worker", Status: MemberStatusShutdown},
					},
				},
			},
			tasks: map[string][]Task{},
		}

		svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &failingBus{publishErr: errors.New("publish failed")})
		if err := svc.Cleanup(ctx, "cleanup-team"); err != nil {
			t.Fatalf("cleanup should succeed despite inbox and publish warnings: %v", err)
		}
	})

	t.Run("recover tolerates transition and inbox recovery failures", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore: &mockStore{
				teams: map[string]*Team{
					"recover-team": {
						Name:          "recover-team",
						LeadSessionID: "lead",
						Members: []Member{
							{Name: "worker", SessionID: "worker", Status: MemberStatusBusy},
						},
					},
				},
				tasks: map[string][]Task{},
			},
			saveTeamErr: errors.New("save failed"),
		}
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
		count, err := svc.Recover(ctx)
		if err != nil {
			t.Fatalf("recover: %v", err)
		}
		if count != 1 {
			t.Fatalf("expected one recovered member, got %d", count)
		}
	})

	t.Run("spawn member removes session when add member fails and warns on claim task", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore: &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
		}
		sessions := &spawnSessions{}
		svc := NewService(store, newTestTeamInbox(t.TempDir()), sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "spawn-remove", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		store.saveTeamErr = errors.New("add member failed")
		input := SpawnInput{
			TeamName:        "spawn-remove",
			Name:            "worker",
			ParentSessionID: "lead",
			Prompt:          "work",
			ClaimTask:       "missing-task",
		}
		input.Agent.Name = "agent"
		input.Model.ProviderID = "p"
		input.Model.ModelID = "m"
		if _, _, err := svc.SpawnMember(ctx, input); err == nil {
			t.Fatal("expected spawn failure when add member fails")
		}
		if sessions.removeCalls != 1 {
			t.Fatalf("expected spawned session cleanup, removeCalls=%d", sessions.removeCalls)
		}
	})

	t.Run("send broadcast and mark read propagate lookup failures", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore:  &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
			getTeamErr: errors.New("get failed"),
		}
		svc := NewService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})
		if err := svc.Send(ctx, "team", "lead", "worker", "hello"); err == nil {
			t.Fatal("expected send get team error")
		}
		if err := svc.Broadcast(ctx, "team", "lead", "hello"); err == nil {
			t.Fatal("expected broadcast get team error")
		}
	})
}
