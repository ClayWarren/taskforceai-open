package team

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type removeFailSpawnSessions struct {
	spawnSessions
	removeErr error
}

func (s *removeFailSpawnSessions) RemoveSession(context.Context, string) error {
	s.removeCalls++
	return s.removeErr
}

func TestService_Tasks(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "task-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)

	tasks := []Task{
		{ID: "1", Content: "Task 1", Priority: TaskPriorityHigh, Status: TaskStatusPending},
		{ID: "2", Content: "Task 2", Priority: TaskPriorityMedium, DependsOn: []string{"1"}, Status: TaskStatusPending},
	}

	if err := svc.AddTasks(ctx, teamName, tasks); err != nil {
		t.Fatalf("failed to add tasks: %v", err)
	}

	list, _ := svc.ListTasks(ctx, teamName)
	if len(list) != 2 {
		t.Errorf("expected 2 tasks, got %d", len(list))
	}

	// Task 2 should be blocked
	for _, task := range list {
		if task.ID == "2" && task.Status != TaskStatusBlocked {
			t.Errorf("task 2 should be blocked, got %v", task.Status)
		}
	}

	// Claim task 1
	claimed, err := svc.ClaimTask(ctx, teamName, "1", "worker-a")
	if err != nil || !claimed {
		t.Errorf("failed to claim task 1: %v, %v", err, claimed)
	}

	// Complete task 1
	if err := svc.CompleteTask(ctx, teamName, "1"); err != nil {
		t.Errorf("failed to complete task 1: %v", err)
	}

	// Task 2 should now be pending
	list2, _ := svc.ListTasks(ctx, teamName)
	for _, task := range list2 {
		if task.ID == "2" && task.Status != TaskStatusPending {
			t.Errorf("task 2 should be pending, got %v", task.Status)
		}
	}
}

func TestService_Tasks_Extra(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "tasks-extra"
	_, _ = svc.Create(ctx, teamName, "lead", false)

	// UpdateTasks
	tasks := []Task{{ID: "1", Content: "T1", Status: TaskStatusPending}}
	if err := svc.UpdateTasks(ctx, teamName, tasks); err != nil {
		t.Errorf("UpdateTasks failed: %v", err)
	}

	// ClaimTask - already claimed
	_, _ = svc.ClaimTask(ctx, teamName, "1", "w1")
	claimed, _ := svc.ClaimTask(ctx, teamName, "1", "w2")
	if claimed {
		t.Error("expected second claim to fail")
	}

	// ClaimTask - non-existent
	claimed2, _ := svc.ClaimTask(ctx, teamName, "ghost", "w1")
	if claimed2 {
		t.Error("expected claim of non-existent task to fail")
	}
}

func TestService_TransitionExecutionStatus(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "exec-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)
	_ = svc.AddMember(ctx, teamName, Member{Name: "worker", SessionID: "ses_w", Status: MemberStatusReady})

	ok, err := svc.TransitionExecutionStatus(ctx, teamName, "worker", ExecutionStatusStarting, false)
	if err != nil || !ok {
		t.Errorf("failed transition: %v, %v", err, ok)
	}
}

func TestService_Transitions(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "trans-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)
	_ = svc.AddMember(ctx, teamName, Member{Name: "worker", SessionID: "ses_w", Status: MemberStatusReady})

	// Valid transition
	ok, err := svc.TransitionMemberStatus(ctx, teamName, "worker", MemberStatusBusy, false)
	if err != nil || !ok {
		t.Errorf("failed transition: %v, %v", err, ok)
	}

	// Invalid transition
	_, err = svc.TransitionMemberStatus(ctx, teamName, "worker", MemberStatusShutdown, false)
	if err == nil {
		t.Errorf("expected error for busy -> shutdown transition")
	}

	// Force transition
	ok, err = svc.TransitionMemberStatus(ctx, teamName, "worker", MemberStatusShutdown, true)
	if err != nil || !ok {
		t.Errorf("failed force transition: %v, %v", err, ok)
	}
}

func TestTeamServiceApprovePlanAndCleanupGapCoverage(t *testing.T) {
	ctx := context.Background()

	t.Run("approve plan rejected with feedback and permission failure", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
		inbox := newTestTeamInbox(t.TempDir())
		sessions := &spawnSessions{updatePermErr: errors.New("permission update failed")}
		svc := NewService(store, inbox, sessions, &mockModels{}, &failingBus{publishErr: errors.New("publish failed")})
		if _, err := svc.Create(ctx, "plan-team", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "plan-team", Member{Name: "worker", SessionID: "ses_worker", PlanApproval: PlanApprovalPending}); err != nil {
			t.Fatalf("add member: %v", err)
		}

		if err := svc.ApprovePlan(ctx, "plan-team", "worker", true, "looks good"); err == nil || !strings.Contains(err.Error(), "permission update failed") {
			t.Fatalf("expected permission update error, got %v", err)
		}

		sessions.updatePermErr = nil
		if err := svc.ApprovePlan(ctx, "plan-team", "worker", false, "needs changes"); err != nil {
			t.Fatalf("reject plan: %v", err)
		}
		team, err := svc.Get(ctx, "plan-team")
		if err != nil {
			t.Fatalf("get team: %v", err)
		}
		if team.Members[0].PlanApproval != PlanApprovalRejected {
			t.Fatalf("expected rejected plan approval, got %v", team.Members[0].PlanApproval)
		}
	})

	t.Run("cleanup delete failure and inbox remove warnings", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore: &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
		}
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &failingBus{publishErr: errors.New("publish failed")})
		if _, err := svc.Create(ctx, "cleanup-team", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "cleanup-team", Member{Name: "worker", SessionID: "ses_worker", Status: MemberStatusShutdown}); err != nil {
			t.Fatalf("add member: %v", err)
		}
		store.deleteErr = errors.New("delete failed")
		if err := svc.Cleanup(ctx, "cleanup-team"); err == nil || !strings.Contains(err.Error(), "delete failed") {
			t.Fatalf("expected delete failure, got %v", err)
		}
	})
}

func TestTeamServiceCompletionAndRecoveryBranches(t *testing.T) {
	ctx := context.Background()
	store := &mockStore{
		teams: map[string]*Team{
			"team": {
				Name:          "team",
				LeadSessionID: "lead-session",
				Members: []Member{{
					Name:            "worker",
					SessionID:       "worker-session",
					Status:          MemberStatusBusy,
					ExecutionStatus: ExecutionStatusRunning,
				}},
			},
		},
		tasks: map[string][]Task{},
	}
	svc := NewService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})

	svc.finalizeMemberExecution(ctx, "team", "worker")
	member := svc.findCurrentMember(ctx, "team", "worker")
	if member == nil || member.ExecutionStatus != ExecutionStatusIdle {
		t.Fatalf("expected idle member after finalization, got %#v", member)
	}

	message := svc.buildCompletionMessage(ctx, "team", "worker", "worker-session", errors.New("failed"))
	if !strings.Contains(message, "I encountered an error") {
		t.Fatalf("expected error completion message, got %q", message)
	}

	store.teams["team"].Members[0].Status = MemberStatusShutdownRequested
	message = svc.buildCompletionMessage(ctx, "team", "worker", "worker-session", nil)
	if message != "" {
		t.Fatalf("shutdown requested member should not produce completion message, got %q", message)
	}

	store.teams["team"].Members[0].Status = MemberStatusBusy
	count, err := svc.Recover(ctx)
	if err != nil {
		t.Fatalf("recover failed: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one recovered member, got %d", count)
	}
}

func TestTeamServiceCoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("get and transition member status propagate store errors", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore:  &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
			getTeamErr: errors.New("get team failed"),
		}
		svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Get(ctx, "any"); err == nil || !strings.Contains(err.Error(), "get team failed") {
			t.Fatalf("expected get team error, got %v", err)
		}

		store.getTeamErr = nil
		if _, err := svc.Create(ctx, "transition-team", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "transition-team", Member{Name: "worker", SessionID: "ses_worker"}); err != nil {
			t.Fatalf("add member: %v", err)
		}
		store.saveTeamErr = errors.New("save team failed")
		if _, err := svc.TransitionMemberStatus(ctx, "transition-team", "worker", MemberStatusBusy, true); err == nil {
			t.Fatal("expected save team error from transition member status")
		}
	})

	t.Run("approve plan sends approved feedback and tolerates publish failures", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &failingBus{publishErr: errors.New("publish failed")})
		if _, err := svc.Create(ctx, "plan-feedback", "lead-ses", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "plan-feedback", Member{Name: "worker", SessionID: "worker-ses", PlanApproval: PlanApprovalPending}); err != nil {
			t.Fatalf("add member: %v", err)
		}

		if err := svc.ApprovePlan(ctx, "plan-feedback", "worker", true, "ship it"); err != nil {
			t.Fatalf("approve plan: %v", err)
		}
		msgs, err := inbox.ReadAll("plan-feedback", "worker")
		if err != nil {
			t.Fatalf("read worker inbox: %v", err)
		}
		if len(msgs) == 0 || !strings.Contains(msgs[0].Text, "APPROVED") || !strings.Contains(msgs[0].Text, "ship it") {
			t.Fatalf("expected approved feedback message, got %+v", msgs)
		}
	})

	t.Run("broadcast tolerates inbox write failures", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
		inbox := newTestTeamInbox(t.TempDir())
		if err := inbox.Write("broadcast-block", "lead", InboxMessage{ID: "seed", From: "lead", Text: "seed"}); err != nil {
			t.Fatalf("seed lead inbox: %v", err)
		}
		inbox.writeErr = errors.New("write failed")

		svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "broadcast-block", "lead-ses", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		_ = svc.AddMember(ctx, "broadcast-block", Member{Name: "worker", SessionID: "worker-ses", Status: MemberStatusReady})
		if err := svc.Broadcast(ctx, "broadcast-block", "lead", "status"); err != nil {
			t.Fatalf("broadcast should swallow inbox write failures, got %v", err)
		}
	})

	t.Run("mark read uses singular receipt text", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
		inbox := newTestTeamInbox(t.TempDir())
		sessions := &countingSessions{}
		svc := NewService(store, inbox, sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "receipt-singular", "lead-ses", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		_ = svc.AddMember(ctx, "receipt-singular", Member{Name: "worker", SessionID: "worker-ses", Status: MemberStatusReady})
		_ = inbox.Write("receipt-singular", "worker", InboxMessage{ID: "m1", From: "lead", Text: "one"})

		count, err := svc.MarkRead(ctx, "receipt-singular", "worker")
		if err != nil || count != 1 {
			t.Fatalf("mark read failed: count=%d err=%v", count, err)
		}
		if len(sessions.injected) == 0 || !strings.Contains(sessions.injected[0], "has read your message") {
			t.Fatalf("expected singular receipt injection, got %#v", sessions.injected)
		}
		if strings.Contains(sessions.injected[0], "message(s)") {
			t.Fatalf("expected singular receipt wording, got %q", sessions.injected[0])
		}
	})

	t.Run("claim and complete task error paths", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore: &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
		}
		svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "task-team", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddTasks(ctx, "task-team", []Task{{ID: "t1", Content: "work", Status: TaskStatusPending}}); err != nil {
			t.Fatalf("add tasks: %v", err)
		}

		store.saveTasksErr = errors.New("save tasks failed")
		if _, err := svc.ClaimTask(ctx, "task-team", "t1", "worker"); err == nil {
			t.Fatal("expected claim save error")
		}
		if err := svc.CompleteTask(ctx, "task-team", "t1"); err == nil {
			t.Fatal("expected complete save error")
		}
	})

	t.Run("resolve dependencies unblocks tasks with no dependencies", func(t *testing.T) {
		svc := NewService(nil, nil, nil, nil, nil)
		resolved := svc.resolveDependencies([]Task{
			{ID: "blocked", Status: TaskStatusBlocked, DependsOn: []string{"missing", "self"}},
		})
		if len(resolved) != 1 || resolved[0].Status != TaskStatusPending {
			t.Fatalf("expected blocked task to become pending after dependency cleanup, got %+v", resolved)
		}
		if len(resolved[0].DependsOn) != 0 {
			t.Fatalf("expected invalid dependencies to be filtered out, got %+v", resolved[0].DependsOn)
		}
	})
}

func TestTeamServiceCreateAndLookupGapCoverage(t *testing.T) {
	ctx := context.Background()

	t.Run("create save team failure", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore:   &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
			saveTeamErr: errors.New("save team failed"),
		}
		svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "save-fail", "lead", false); err == nil || !strings.Contains(err.Error(), "save team failed") {
			t.Fatalf("expected save team error, got %v", err)
		}
	})

	t.Run("create save tasks failure", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore:    &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
			saveTasksErr: errors.New("save tasks failed"),
		}
		svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "tasks-fail", "lead", false); err == nil || !strings.Contains(err.Error(), "save tasks failed") {
			t.Fatalf("expected save tasks error, got %v", err)
		}
	})

	t.Run("get missing team and add member failures", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
		svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Get(ctx, "missing"); err == nil {
			t.Fatal("expected missing team error")
		}
		if err := svc.AddMember(ctx, "missing", Member{Name: "w", SessionID: "s"}); err == nil {
			t.Fatal("expected add member error for missing team")
		}
	})
}

func TestTeamServiceExtraPushTo95CoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("spawn warns when cleanup session removal also fails", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore:   &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
			saveTeamErr: nil,
		}
		sessions := &removeFailSpawnSessions{removeErr: errors.New("remove failed")}
		svc := NewService(store, nil, sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "spawn-remove-fail", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		store.saveTeamErr = errors.New("add member save failed")
		input := SpawnInput{TeamName: "spawn-remove-fail", Name: "worker", ParentSessionID: "lead", Prompt: "work"}
		input.Agent.Name = "agent"
		input.Model.ProviderID = "p"
		input.Model.ModelID = "m"
		if _, _, err := svc.SpawnMember(ctx, input); err == nil {
			t.Fatal("expected add member failure")
		}
		if sessions.removeCalls != 1 {
			t.Fatalf("expected cleanup remove attempt, got %d", sessions.removeCalls)
		}
	})

	t.Run("mark read sends receipt warnings when sender inbox is blocked", func(t *testing.T) {
		store := &mockStore{
			teams: map[string]*Team{
				"receipts": {
					Name:          "receipts",
					LeadSessionID: "lead",
					Members:       []Member{{Name: "worker", SessionID: "worker", Status: MemberStatusReady}},
				},
			},
			tasks: map[string][]Task{},
		}
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
		_ = inbox.Write("receipts", "worker", agentInboxMessage("lead", "ping"))
		inbox.writeErr = errors.New("write failed")
		if _, err := svc.MarkRead(ctx, "receipts", "worker"); err != nil {
			t.Fatalf("mark read: %v", err)
		}
	})
}
