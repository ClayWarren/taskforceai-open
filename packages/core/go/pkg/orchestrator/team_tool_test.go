package orchestrator

import (
	"context"
	"errors"
	"strings"
	"testing"

	toolspkg "github.com/TaskForceAI/core/pkg/tools"
)

type erroringTeamToolStore struct {
	*mockStore
	findErr      error
	getTasksErr  error
	saveTasksErr error
}

func (e *erroringTeamToolStore) FindBySession(ctx context.Context, sessionID string) (*TeamInfo, string, string, error) {
	if e.findErr != nil {
		return nil, "", "", e.findErr
	}
	return e.mockStore.FindBySession(ctx, sessionID)
}

func (e *erroringTeamToolStore) GetTasks(ctx context.Context, teamName string) ([]TeamTask, error) {
	if e.getTasksErr != nil {
		return nil, e.getTasksErr
	}
	return e.mockStore.GetTasks(ctx, teamName)
}

func (e *erroringTeamToolStore) SaveTasks(ctx context.Context, teamName string, tasks []TeamTask) error {
	if e.saveTasksErr != nil {
		return e.saveTasksErr
	}
	return e.mockStore.SaveTasks(ctx, teamName, tasks)
}

func emptyTeamToolStore() *mockStore {
	return &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
}

func newTeamToolHarness(t *testing.T, store Store, sessions SessionManager) (*TeamService, *TeamTools) {
	t.Helper()
	if store == nil {
		store = emptyTeamToolStore()
	}
	if sessions == nil {
		sessions = &mockSessions{}
	}
	svc := NewTeamService(store, newTestTeamInbox(t.TempDir()), sessions, &mockModels{}, &mockBus{})
	return svc, NewTeamTools(svc)
}

func newTeamToolsNoInbox(t *testing.T, store Store, sessions SessionManager) (*TeamService, *TeamTools) {
	t.Helper()
	if store == nil {
		store = emptyTeamToolStore()
	}
	if sessions == nil {
		sessions = &mockSessions{}
	}
	svc := NewTeamService(store, nil, sessions, &mockModels{}, &mockBus{})
	return svc, NewTeamTools(svc)
}

type trackingTeamToolSessions struct {
	mockSessions
	updateCalls       int
	lastUpdateSession string
	lastUpdatePattern string
	cancelCalls       int
	injectErr         error
}

func (t *trackingTeamToolSessions) InjectMessage(ctx context.Context, sessionID, fromName, text, inboxMessageID string) error {
	if t.injectErr != nil {
		return t.injectErr
	}
	return nil
}

func (t *trackingTeamToolSessions) UpdatePermissions(ctx context.Context, sessionID string, removePattern string) error {
	t.updateCalls++
	t.lastUpdateSession = sessionID
	t.lastUpdatePattern = removePattern
	return nil
}

func (t *trackingTeamToolSessions) CancelPrompt(ctx context.Context, sessionID string) error {
	t.cancelCalls++
	return nil
}

func TestTeamToolsCoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("nil team membership errors", func(t *testing.T) {
		_, tools := newTeamToolHarness(t, nil, nil)
		toolCtx := ToolContext{SessionID: "orphan-session"}

		res, err := tools.Message(ctx, toolCtx, "worker", "hello")
		if err != nil || res.Title != "Error" || res.Output != "You are not part of any team." {
			t.Fatalf("expected missing team message result, got res=%+v err=%v", res, err)
		}
		res, err = tools.Broadcast(ctx, toolCtx, "hello")
		if err != nil || res.Title != "Error" {
			t.Fatalf("expected missing team broadcast result, got res=%+v err=%v", res, err)
		}

		res, err = tools.Tasks(ctx, toolCtx, "list", nil, "")
		if err != nil || res.Title != "Error" {
			t.Fatalf("expected missing team tasks result, got res=%+v err=%v", res, err)
		}
		res, err = tools.Claim(ctx, toolCtx, "task-1")
		if err != nil || res.Title != "Error" {
			t.Fatalf("expected missing team claim result, got res=%+v err=%v", res, err)
		}
		res, err = tools.ApprovePlan(ctx, toolCtx, "worker", true, "")
		if err != nil || res.Title != "Error" {
			t.Fatalf("expected missing team approve result, got res=%+v err=%v", res, err)
		}

		store := &erroringTeamToolStore{
			mockStore: emptyTeamToolStore(),
			findErr:   errors.New("lookup failed"),
		}
		_, teamTools := newTeamToolHarness(t, store, nil)
		res, err = teamTools.Shutdown(ctx, ToolContext{SessionID: "lead-session"}, "worker", "done")
		if err == nil || res.Title != "Error" || !strings.Contains(res.Output, "lookup failed") {
			t.Fatalf("expected shutdown lookup failure, got res=%+v err=%v", res, err)
		}
	})

	t.Run("success paths for message broadcast claim and tasks", func(t *testing.T) {
		store := &mockStore{
			teams: map[string]*TeamInfo{
				"tools": {
					Name:          "tools",
					LeadSessionID: "lead-session",
					Members: []TeamMember{
						{Name: "worker", SessionID: "worker-session", Status: MemberStatusReady},
					},
				},
			},
			tasks: map[string][]TeamTask{
				"tools": {{ID: "task-1", Content: "work", Status: TaskStatusPending}},
			},
		}
		_, tools := newTeamToolHarness(t, store, nil)
		leadCtx := ToolContext{SessionID: "lead-session"}

		res, err := tools.Message(ctx, leadCtx, "worker", "hello")
		if err != nil || res.Title == "Error" {
			t.Fatalf("expected message success, res=%+v err=%v", res, err)
		}
		res, err = tools.Broadcast(ctx, leadCtx, "status")
		if err != nil || res.Title == "Error" {
			t.Fatalf("expected broadcast success, res=%+v err=%v", res, err)
		}
		res, err = tools.Tasks(ctx, leadCtx, "list", nil, "")
		if err != nil || res.Title == "Error" {
			t.Fatalf("expected tasks list success, res=%+v err=%v", res, err)
		}
		res, err = tools.Claim(ctx, ToolContext{SessionID: "worker-session"}, "task-1")
		if err != nil || res.Title == "Error" {
			t.Fatalf("expected claim success, res=%+v err=%v", res, err)
		}
	})

	t.Run("registered tools return unmarshal errors", func(t *testing.T) {
		_, teamTools := newTeamToolHarness(t, nil, nil)
		registry := toolspkg.NewToolRegistry()
		teamTools.Register(registry)

		ctxWithSession := context.WithValue(ctx, sessionIDKey, "lead-session")
		for _, toolName := range []string{"team_message", "team_broadcast", "team_tasks", "team_claim"} {
			tool, ok := registry.Get(toolName)
			if !ok {
				t.Fatalf("tool %q not registered", toolName)
			}
			if _, err := tool.Execute(ctxWithSession, "{"); err == nil {
				t.Fatalf("expected malformed JSON error for %q", toolName)
			}
		}
	})

	t.Run("message and broadcast propagate service errors", func(t *testing.T) {
		store := &erroringTeamToolStore{
			mockStore: emptyTeamToolStore(),
			findErr:   errors.New("lookup failed"),
		}
		_, teamTools := newTeamToolHarness(t, store, nil)
		toolCtx := ToolContext{SessionID: "lead-session"}

		res, err := teamTools.Message(ctx, toolCtx, "worker", "hello")
		if err == nil || res.Title != "Error" || res.Output != "lookup failed" {
			t.Fatalf("expected lookup failure, got res=%+v err=%v", res, err)
		}

		res, err = teamTools.Broadcast(ctx, toolCtx, "hello")
		if err == nil || res.Title != "Error" {
			t.Fatalf("expected broadcast lookup failure, got res=%+v err=%v", res, err)
		}
	})

	t.Run("create store failure and spawn service failure", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore:   emptyTeamToolStore(),
			saveTeamErr: errors.New("create failed"),
		}
		svc, teamTools := newTeamToolsNoInbox(t, store, nil)

		res, err := teamTools.Create(ctx, ToolContext{SessionID: "lead-session"}, "broken-team", nil, false)
		if err == nil || res.Title != "Error" || !strings.Contains(res.Output, "create failed") {
			t.Fatalf("expected create failure, got res=%+v err=%v", res, err)
		}

		store.saveTeamErr = nil
		if _, err := svc.Create(ctx, "spawn-team", "lead-session", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		sessions := &spawnSessions{createErr: errors.New("spawn failed")}
		svc.sessions = sessions
		res, err = teamTools.Spawn(ctx, ToolContext{SessionID: "lead-session"}, "worker", "agent", "openai/gpt-4", "prompt", "", false)
		if err == nil || res.Title != "Error" || !strings.Contains(res.Output, "spawn failed") {
			t.Fatalf("expected spawn failure, got res=%+v err=%v", res, err)
		}
	})

	t.Run("approve plan and cleanup propagate service failures", func(t *testing.T) {
		svc, teamTools := newTeamToolHarness(t, nil, nil)
		if _, err := svc.Create(ctx, "tool-plan", "lead-session", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		_ = svc.AddMember(ctx, "tool-plan", TeamMember{Name: "worker", SessionID: "worker-ses", PlanApproval: PlanApprovalPending})

		res, err := teamTools.ApprovePlan(ctx, ToolContext{SessionID: "lead-session"}, "missing", true, "")
		if err == nil || res.Title != "Error" {
			t.Fatalf("expected approve failure, got res=%+v err=%v", res, err)
		}

		res, err = teamTools.Cleanup(ctx, ToolContext{SessionID: "lead-session"}, "tool-plan")
		if err == nil || res.Title != "Error" {
			t.Fatalf("expected cleanup failure for active member, got res=%+v err=%v", res, err)
		}
	})
}

func TestTeamTools_ApprovePlan(t *testing.T) {
	svc, tools := newTeamToolHarness(t, nil, nil)

	ctx := context.Background()
	_, _ = svc.Create(ctx, "plan-team", "lead-session", false)
	_ = svc.AddMember(ctx, "plan-team", TeamMember{Name: "worker", SessionID: "ses_w", PlanApproval: PlanApprovalPending})

	toolCtx := ToolContext{SessionID: "lead-session"}
	res, err := tools.ApprovePlan(ctx, toolCtx, "worker", true, "good")
	if err != nil {
		t.Fatalf("tool failed: %v", err)
	}
	if res.Title == "Error" {
		t.Errorf("tool returned error: %s", res.Output)
	}
}

func TestTeamTools_ApprovePlanAndCleanup_Guards(t *testing.T) {
	svc, teamTools := newTeamToolHarness(t, nil, &trackingTeamToolSessions{})
	ctx := context.Background()

	if _, err := svc.Create(ctx, "plan-guards", "lead-session", false); err != nil {
		t.Fatalf("create team: %v", err)
	}
	if err := svc.AddMember(ctx, "plan-guards", TeamMember{Name: "worker", SessionID: "ses_worker", PlanApproval: PlanApprovalPending, Status: MemberStatusReady}); err != nil {
		t.Fatalf("add member: %v", err)
	}

	res, err := teamTools.ApprovePlan(ctx, ToolContext{SessionID: "ses_worker"}, "worker", true, "")
	if err != nil {
		t.Fatalf("member approve returned error: %v", err)
	}
	if res.Title != "Error" || !strings.Contains(res.Output, "Only the lead can approve") {
		t.Fatalf("expected non-lead approve guard, got %+v", res)
	}

	res, err = teamTools.ApprovePlan(ctx, ToolContext{SessionID: "lead-session"}, "missing", true, "")
	if err == nil {
		t.Fatal("expected approve missing member error")
	}
	if res.Title != "Error" || !strings.Contains(res.Output, ErrMemberNotFound.Error()) {
		t.Fatalf("unexpected missing-member response: %+v", res)
	}

	res, err = teamTools.ApprovePlan(ctx, ToolContext{SessionID: "lead-session"}, "worker", false, "needs revision")
	if err != nil {
		t.Fatalf("reject plan: %v", err)
	}
	if res.Title != "Plan rejected" {
		t.Fatalf("expected rejected title, got %+v", res)
	}

	team, err := svc.Get(ctx, "plan-guards")
	if err != nil {
		t.Fatalf("get team: %v", err)
	}
	if team.Members[0].PlanApproval != PlanApprovalRejected {
		t.Fatalf("expected rejected state, got %s", team.Members[0].PlanApproval)
	}

	res, err = teamTools.Cleanup(ctx, ToolContext{SessionID: "lead-session"}, "wrong-name")
	if err != nil {
		t.Fatalf("cleanup mismatch returned error: %v", err)
	}
	if res.Title != "Error" || !strings.Contains(res.Output, "Only the lead can clean up") {
		t.Fatalf("expected cleanup guard for mismatched team, got %+v", res)
	}

	res, err = teamTools.Cleanup(ctx, ToolContext{SessionID: "lead-session"}, "plan-guards")
	if err == nil {
		t.Fatal("expected cleanup to fail with non-shutdown member")
	}
	if res.Title != "Error" || !strings.Contains(res.Output, "cannot clean up team") {
		t.Fatalf("unexpected cleanup error response: %+v", res)
	}
}

func TestTeamTools_Broadcast(t *testing.T) {
	svc, tools := newTeamToolHarness(t, nil, nil)

	ctx := context.Background()
	_, _ = svc.Create(ctx, "bcast-team", "lead-session", false)
	_ = svc.AddMember(ctx, "bcast-team", TeamMember{Name: "worker", SessionID: "ses_w"})

	toolCtx := ToolContext{SessionID: "lead-session"}
	res, err := tools.Broadcast(ctx, toolCtx, "broadcast from tool")
	if err != nil {
		t.Fatalf("tool failed: %v", err)
	}
	if res.Title == "Error" {
		t.Errorf("tool returned error: %s", res.Output)
	}
}

func TestTeamTools_Claim(t *testing.T) {
	svc, tools := newTeamToolsNoInbox(t, nil, nil)

	ctx := context.Background()
	_, _ = svc.Create(ctx, "claim-team", "lead-session", false)
	_ = svc.AddTasks(ctx, "claim-team", []TeamTask{{ID: "1", Content: "Task 1", Status: TaskStatusPending}})

	toolCtx := ToolContext{SessionID: "lead-session"}
	res, err := tools.Claim(ctx, toolCtx, "1")
	if err != nil {
		t.Fatalf("tool failed: %v", err)
	}
	if res.Title == "Error" {
		t.Errorf("tool returned error: %s", res.Output)
	}
}

func TestTeamTools_Create(t *testing.T) {
	svc, tools := newTeamToolsNoInbox(t, nil, nil)

	ctx := context.Background()
	toolCtx := ToolContext{SessionID: "lead-session"}

	res, err := tools.Create(ctx, toolCtx, "tool-team", nil, false)
	if err != nil {
		t.Fatalf("tool failed: %v", err)
	}

	if res.Title == "Error" {
		t.Errorf("tool returned error: %s", res.Output)
	}

	// Verify team created
	team, _ := svc.Get(ctx, "tool-team")
	if team == nil {
		t.Fatal("team not found after tool execution")
	}
}

func TestTeamTools_Create_GuardsAndDelegate(t *testing.T) {
	t.Run("already in a team", func(t *testing.T) {
		svc, teamTools := newTeamToolsNoInbox(t, nil, nil)
		ctx := context.Background()

		if _, err := svc.Create(ctx, "existing-team", "lead-session", false); err != nil {
			t.Fatalf("create team: %v", err)
		}

		res, err := teamTools.Create(ctx, ToolContext{SessionID: "lead-session"}, "new-team", nil, false)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if res.Title != "Error" || !strings.Contains(res.Output, "already part of team") {
			t.Fatalf("unexpected response: %+v", res)
		}
	})

	t.Run("find by session failure returns error", func(t *testing.T) {
		store := &erroringTeamToolStore{
			mockStore: emptyTeamToolStore(),
			findErr:   errors.New("lookup failed"),
		}
		_, teamTools := newTeamToolsNoInbox(t, store, nil)

		res, err := teamTools.Create(context.Background(), ToolContext{SessionID: "lead-session"}, "new-team", nil, false)
		if err == nil {
			t.Fatal("expected create error")
		}
		if res.Title != "Error" || res.Output != "lookup failed" {
			t.Fatalf("unexpected response: %+v", res)
		}
	})

	t.Run("delegate mode updates permissions", func(t *testing.T) {
		sessions := &trackingTeamToolSessions{}
		svc, teamTools := newTeamToolsNoInbox(t, nil, sessions)
		ctx := context.Background()

		res, err := teamTools.Create(ctx, ToolContext{SessionID: "lead-session"}, "delegate-team", []TeamTask{
			{ID: "t1", Content: "delegate task", Status: TaskStatusPending},
		}, true)
		if err != nil {
			t.Fatalf("create delegate team: %v", err)
		}
		if res.Metadata["delegate"] != true {
			t.Fatalf("expected delegate metadata true, got %v", res.Metadata["delegate"])
		}
		if sessions.updateCalls != 1 || sessions.lastUpdateSession != "lead-session" || sessions.lastUpdatePattern != "" {
			t.Fatalf("unexpected permission update calls: %+v", sessions)
		}
		tasks, err := svc.ListTasks(ctx, "delegate-team")
		if err != nil {
			t.Fatalf("list tasks: %v", err)
		}
		if len(tasks) != 1 {
			t.Fatalf("expected 1 seeded task, got %d", len(tasks))
		}
	})
}

func TestTeamTools_Errors(t *testing.T) {
	_, tools := newTeamToolsNoInbox(t, nil, nil)
	ctx := context.Background()
	toolCtx := ToolContext{SessionID: "lead-ses"}

	// Cleanup non-existent
	res, _ := tools.Cleanup(ctx, toolCtx, "ghost")
	if res.Title != "Error" {
		t.Errorf("expected error for ghost team cleanup")
	}

	// Message while not in team
	res2, _ := tools.Message(ctx, toolCtx, "lead", "hi")
	if res2.Title != "Error" {
		t.Error("expected error messaging while not in team")
	}

	// Spawn while not in team
	res3, _ := tools.Spawn(ctx, toolCtx, "w", "a", "m", "p", "", false)
	if res3.Title != "Error" {
		t.Error("expected error spawning while not in team")
	}
}

func TestTeamTools_Message(t *testing.T) {
	svc, tools := newTeamToolHarness(t, nil, nil)

	ctx := context.Background()
	_, _ = svc.Create(ctx, "msg-team", "lead-session", false)
	_ = svc.AddMember(ctx, "msg-team", TeamMember{Name: "worker", SessionID: "ses_w"})

	toolCtx := ToolContext{SessionID: "lead-session"}
	res, err := tools.Message(ctx, toolCtx, "worker", "hello from tool")
	if err != nil {
		t.Fatalf("tool failed: %v", err)
	}
	if res.Title == "Error" {
		t.Errorf("tool returned error: %s", res.Output)
	}
}

func TestTeamTools_Register(t *testing.T) {
	svc, teamTools := newTeamToolHarness(t, nil, &trackingTeamToolSessions{})
	ctx := context.Background()

	if _, err := svc.Create(ctx, "register-team", "lead-session", false); err != nil {
		t.Fatalf("create team: %v", err)
	}
	if err := svc.AddMember(ctx, "register-team", TeamMember{Name: "worker", SessionID: "ses_w"}); err != nil {
		t.Fatalf("add member: %v", err)
	}
	if err := svc.AddTasks(ctx, "register-team", []TeamTask{{ID: "task-1", Content: "do thing", Status: TaskStatusPending}}); err != nil {
		t.Fatalf("add tasks: %v", err)
	}

	registry := toolspkg.NewToolRegistry()
	teamTools.Register(registry)

	getTool := func(name string) toolspkg.ITool {
		t.Helper()
		tool, ok := registry.Get(name)
		if !ok {
			t.Fatalf("tool %q not registered", name)
		}
		return tool
	}

	missingSessionCases := []struct {
		tool string
		args string
	}{
		{tool: "team_message", args: `{"to":"worker","text":"hello"}`},
		{tool: "team_broadcast", args: `{"text":"hello all"}`},
		{tool: "team_tasks", args: `{"action":"list"}`},
		{tool: "team_claim", args: `{"taskID":"task-1"}`},
	}
	for _, tc := range missingSessionCases {
		res, err := getTool(tc.tool).Execute(context.Background(), tc.args)
		if err != nil {
			t.Fatalf("%s missing session returned error: %v", tc.tool, err)
		}
		if got := res["content"]; got != "session ID not found in context" {
			t.Fatalf("%s missing session content = %v", tc.tool, got)
		}
	}

	ctxWithSession := context.WithValue(ctx, sessionIDKey, "lead-session")

	if _, err := getTool("team_message").Execute(ctxWithSession, "{"); err == nil {
		t.Fatal("expected malformed JSON to fail")
	}

	messageRes, err := getTool("team_message").Execute(ctxWithSession, `{"to":"worker","text":"hello from registry"}`)
	if err != nil {
		t.Fatalf("team_message execute: %v", err)
	}
	if got := messageRes["title"]; got != "Message sent to worker" {
		t.Fatalf("unexpected team_message title: %v", got)
	}

	broadcastRes, err := getTool("team_broadcast").Execute(ctxWithSession, `{"text":"hi team"}`)
	if err != nil {
		t.Fatalf("team_broadcast execute: %v", err)
	}
	if got := broadcastRes["title"]; got != "Broadcast sent" {
		t.Fatalf("unexpected team_broadcast title: %v", got)
	}

	tasksRes, err := getTool("team_tasks").Execute(ctxWithSession, `{"action":"bogus"}`)
	if err != nil {
		t.Fatalf("team_tasks execute: %v", err)
	}
	if got := tasksRes["content"]; got != "Unknown action" {
		t.Fatalf("unexpected team_tasks content: %v", got)
	}

	claimRes, err := getTool("team_claim").Execute(ctxWithSession, `{"taskID":"task-1"}`)
	if err != nil {
		t.Fatalf("team_claim execute: %v", err)
	}
	if got := claimRes["title"]; got != "Task claimed" {
		t.Fatalf("unexpected team_claim title: %v", got)
	}
}

func TestTeamTools_ShutdownCleanup(t *testing.T) {
	svc, tools := newTeamToolHarness(t, nil, nil)

	ctx := context.Background()
	_, _ = svc.Create(ctx, "sc-team", "lead-session", false)
	_ = svc.AddMember(ctx, "sc-team", TeamMember{Name: "worker", SessionID: "ses_w", Status: MemberStatusReady})

	toolCtx := ToolContext{SessionID: "lead-session"}

	// Shutdown
	res, _ := tools.Shutdown(ctx, toolCtx, "worker", "bye")
	if res.Title == "Error" {
		t.Errorf("shutdown failed: %s", res.Output)
	}

	// Move to shutdown status manually for cleanup
	_, _ = svc.TransitionMemberStatus(ctx, "sc-team", "worker", MemberStatusShutdown, true)

	// Cleanup
	res, _ = tools.Cleanup(ctx, toolCtx, "sc-team")
	if res.Title == "Error" {
		t.Errorf("cleanup failed: %s", res.Output)
	}

	// Shutdown lead attempt (invalid)
	res2, _ := tools.Shutdown(ctx, toolCtx, "lead", "")
	if res2.Title != "Error" {
		t.Error("expected error for shutdown lead attempt")
	}

	// Cleanup non-existent team
	res3, _ := tools.Cleanup(ctx, toolCtx, "ghost")
	if res3.Title != "Error" {
		t.Error("expected error for ghost team cleanup")
	}
}

func TestTeamTools_Shutdown_TransitionsAndFallback(t *testing.T) {
	t.Run("send failure forces direct shutdown", func(t *testing.T) {
		sessions := &trackingTeamToolSessions{injectErr: errors.New("inject failed")}
		svc, teamTools := newTeamToolHarness(t, nil, sessions)
		ctx := context.Background()

		if _, err := svc.Create(ctx, "shutdown-fallback", "lead-session", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "shutdown-fallback", TeamMember{Name: "worker", SessionID: "ses_worker", Status: MemberStatusReady}); err != nil {
			t.Fatalf("add member: %v", err)
		}

		res, err := teamTools.Shutdown(ctx, ToolContext{SessionID: "lead-session"}, "worker", "")
		if err != nil {
			t.Fatalf("shutdown fallback returned error: %v", err)
		}
		if !strings.Contains(res.Output, "Shutdown request sent") {
			t.Fatalf("unexpected shutdown response: %+v", res)
		}

		team, err := svc.Get(ctx, "shutdown-fallback")
		if err != nil {
			t.Fatalf("get team: %v", err)
		}
		if team.Members[0].Status != MemberStatusShutdown {
			t.Fatalf("expected forced shutdown, got %s", team.Members[0].Status)
		}
	})

	t.Run("busy member requests cancel and transitions", func(t *testing.T) {
		sessions := &trackingTeamToolSessions{}
		svc, teamTools := newTeamToolHarness(t, nil, sessions)
		ctx := context.Background()

		if _, err := svc.Create(ctx, "shutdown-cancel", "lead-session", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "shutdown-cancel", TeamMember{
			Name:            "worker",
			SessionID:       "ses_worker",
			Status:          MemberStatusBusy,
			ExecutionStatus: ExecutionStatusRunning,
		}); err != nil {
			t.Fatalf("add member: %v", err)
		}

		res, err := teamTools.Shutdown(ctx, ToolContext{SessionID: "lead-session"}, "worker", "wrap up now")
		if err != nil {
			t.Fatalf("shutdown busy member: %v", err)
		}
		if res.Title != "Shutdown requested: worker" {
			t.Fatalf("unexpected title: %s", res.Title)
		}
		if sessions.cancelCalls != 1 {
			t.Fatalf("expected one cancel prompt call, got %d", sessions.cancelCalls)
		}

		team, err := svc.Get(ctx, "shutdown-cancel")
		if err != nil {
			t.Fatalf("get team: %v", err)
		}
		member := team.Members[0]
		if member.Status != MemberStatusShutdownRequested {
			t.Fatalf("expected shutdown requested status, got %s", member.Status)
		}
		if member.ExecutionStatus != ExecutionStatusCancelling {
			t.Fatalf("expected execution status cancelling, got %s", member.ExecutionStatus)
		}
	})

	t.Run("missing and already shutdown members", func(t *testing.T) {
		svc, teamTools := newTeamToolHarness(t, nil, &trackingTeamToolSessions{})
		ctx := context.Background()

		if _, err := svc.Create(ctx, "shutdown-guards", "lead-session", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "shutdown-guards", TeamMember{Name: "worker", SessionID: "ses_worker", Status: MemberStatusShutdown}); err != nil {
			t.Fatalf("add member: %v", err)
		}

		res, err := teamTools.Shutdown(ctx, ToolContext{SessionID: "lead-session"}, "ghost", "")
		if err != nil {
			t.Fatalf("missing member shutdown returned error: %v", err)
		}
		if res.Title != "Error" || !strings.Contains(res.Output, "not found") {
			t.Fatalf("unexpected missing-member response: %+v", res)
		}

		res, err = teamTools.Shutdown(ctx, ToolContext{SessionID: "lead-session"}, "worker", "")
		if err != nil {
			t.Fatalf("already-shutdown returned error: %v", err)
		}
		if res.Title != "Already shutdown" {
			t.Fatalf("unexpected already-shutdown response: %+v", res)
		}
	})
}

func TestTeamTools_Spawn(t *testing.T) {
	svc, tools := newTeamToolHarness(t, nil, nil)

	ctx := context.Background()
	_, _ = svc.Create(ctx, "spawn-team", "lead-session", false)

	toolCtx := ToolContext{SessionID: "lead-session"}
	res, err := tools.Spawn(ctx, toolCtx, "worker", "agent", "model", "prompt", "", false)
	if err != nil {
		t.Fatalf("tool failed: %v", err)
	}
	if res.Title == "Error" {
		t.Errorf("tool returned error: %s", res.Output)
	}

	svc.runWG.Wait()
}

func TestTeamTools_Spawn_GuardsAndModelParsing(t *testing.T) {
	svc, teamTools := newTeamToolHarness(t, nil, &trackingTeamToolSessions{})
	ctx := context.Background()

	if _, err := svc.Create(ctx, "spawn-guards", "lead-session", false); err != nil {
		t.Fatalf("create team: %v", err)
	}
	if err := svc.AddMember(ctx, "spawn-guards", TeamMember{Name: "member-a", SessionID: "ses_member"}); err != nil {
		t.Fatalf("add member: %v", err)
	}

	res, err := teamTools.Spawn(ctx, ToolContext{SessionID: "lead-session"}, "lead", "agent", "openai/gpt-4.1", "prompt", "", false)
	if err != nil {
		t.Fatalf("spawn reserved name returned error: %v", err)
	}
	if res.Title != "Error" || !strings.Contains(res.Output, "reserved") {
		t.Fatalf("expected reserved-name error, got %+v", res)
	}

	res, err = teamTools.Spawn(ctx, ToolContext{SessionID: "ses_member"}, "worker-a", "agent", "openai/gpt-4.1", "prompt", "", false)
	if err != nil {
		t.Fatalf("spawn by member returned error: %v", err)
	}
	if res.Title != "Error" || !strings.Contains(res.Output, "Only the lead can spawn") {
		t.Fatalf("expected non-lead guard, got %+v", res)
	}

	res, err = teamTools.Spawn(ctx, ToolContext{SessionID: "lead-session"}, "worker-b", "agent", "openai/gpt-4.1", "prompt", "", true)
	if err != nil {
		t.Fatalf("spawn with model parse failed: %v", err)
	}
	if res.Metadata["model"] != "openai/gpt-4.1" {
		t.Fatalf("expected parsed model label, got %v", res.Metadata["model"])
	}
	if res.Metadata["planApproval"] != true {
		t.Fatalf("expected plan approval metadata true, got %v", res.Metadata["planApproval"])
	}

	svc.runWG.Wait()
}

func TestTeamTools_Tasks(t *testing.T) {
	svc, tools := newTeamToolsNoInbox(t, nil, nil)

	ctx := context.Background()
	_, _ = svc.Create(ctx, "task-team", "lead-session", false)

	toolCtx := ToolContext{SessionID: "lead-session"}

	// Add
	tasks := []TeamTask{{ID: "1", Content: "Task 1", Priority: TaskPriorityHigh, Status: TaskStatusPending}}
	res, _ := tools.Tasks(ctx, toolCtx, "add", tasks, "")
	if res.Title == "Error" {
		t.Errorf("failed to add task via tool: %s", res.Output)
	}

	// List
	res, _ = tools.Tasks(ctx, toolCtx, "list", nil, "")
	if !strings.Contains(res.Output, "Task 1") {
		t.Errorf("list output missing task: %s", res.Output)
	}

	// Complete
	res, _ = tools.Tasks(ctx, toolCtx, "complete", nil, "1")
	if res.Title == "Error" {
		t.Errorf("failed to complete task via tool: %s", res.Output)
	}

	// Update
	res, _ = tools.Tasks(ctx, toolCtx, "update", tasks, "")
	if res.Title == "Error" {
		t.Errorf("failed to update tasks via tool: %s", res.Output)
	}

	// Claim
	_ = svc.AddTasks(ctx, "task-team", []TeamTask{{ID: "2", Content: "T2", Status: TaskStatusPending}})
	res, _ = tools.Claim(ctx, toolCtx, "2")
	if res.Title == "Error" {
		t.Errorf("failed to claim task via tool: %s", res.Output)
	}
}

func TestTeamTools_TasksAndClaim_Guards(t *testing.T) {
	t.Run("tasks list and unknown action", func(t *testing.T) {
		svc, teamTools := newTeamToolsNoInbox(t, nil, nil)
		ctx := context.Background()

		if _, err := svc.Create(ctx, "tasks-guards", "lead-session", false); err != nil {
			t.Fatalf("create team: %v", err)
		}

		res, err := teamTools.Tasks(ctx, ToolContext{SessionID: "lead-session"}, "list", nil, "")
		if err != nil {
			t.Fatalf("list tasks: %v", err)
		}
		if res.Output != "No tasks found." {
			t.Fatalf("expected empty list output, got %q", res.Output)
		}

		res, err = teamTools.Tasks(ctx, ToolContext{SessionID: "lead-session"}, "bogus", nil, "")
		if err != nil {
			t.Fatalf("unknown action: %v", err)
		}
		if res.Title != "Error" || res.Output != "Unknown action" {
			t.Fatalf("unexpected unknown action response: %+v", res)
		}
	})

	t.Run("tasks list propagates list error", func(t *testing.T) {
		store := &erroringTeamToolStore{
			mockStore:   emptyTeamToolStore(),
			getTasksErr: errors.New("task lookup failed"),
		}
		svc, teamTools := newTeamToolsNoInbox(t, store, nil)
		ctx := context.Background()

		if _, err := svc.Create(ctx, "tasks-error", "lead-session", false); err != nil {
			t.Fatalf("create team: %v", err)
		}

		res, err := teamTools.Tasks(ctx, ToolContext{SessionID: "lead-session"}, "list", nil, "")
		if err == nil {
			t.Fatal("expected list error")
		}
		if res.Title != "Error" || res.Output != "task lookup failed" {
			t.Fatalf("unexpected error response: %+v", res)
		}
	})

	t.Run("tasks mutations propagate save errors", func(t *testing.T) {
		store := &erroringTeamToolStore{
			mockStore: emptyTeamToolStore(),
		}
		svc, teamTools := newTeamToolsNoInbox(t, store, nil)
		ctx := context.Background()

		if _, err := svc.Create(ctx, "tasks-save-error", "lead-session", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		store.saveTasksErr = errors.New("task save failed")

		res, err := teamTools.Tasks(ctx, ToolContext{SessionID: "lead-session"}, "add", []TeamTask{{ID: "1", Content: "Task"}}, "")
		if err == nil {
			t.Fatal("expected add error")
		}
		if res.Title != "Error" || res.Output != "task save failed" {
			t.Fatalf("unexpected add error response: %+v", res)
		}

		store.saveTasksErr = nil
		if err := svc.AddTasks(ctx, "tasks-save-error", []TeamTask{{ID: "1", Content: "Task", Status: TaskStatusPending}}); err != nil {
			t.Fatalf("seed task: %v", err)
		}
		store.saveTasksErr = errors.New("task save failed")

		res, err = teamTools.Tasks(ctx, ToolContext{SessionID: "lead-session"}, "complete", nil, "1")
		if err == nil {
			t.Fatal("expected complete error")
		}
		if res.Title != "Error" || res.Output != "task save failed" {
			t.Fatalf("unexpected complete error response: %+v", res)
		}

		res, err = teamTools.Tasks(ctx, ToolContext{SessionID: "lead-session"}, "update", []TeamTask{{ID: "2", Content: "Next"}}, "")
		if err == nil {
			t.Fatal("expected update error")
		}
		if res.Title != "Error" || res.Output != "task save failed" {
			t.Fatalf("unexpected update error response: %+v", res)
		}
	})

	t.Run("claim blocked task and member claim owner", func(t *testing.T) {
		svc, teamTools := newTeamToolsNoInbox(t, nil, nil)
		ctx := context.Background()

		if _, err := svc.Create(ctx, "claim-guards", "lead-session", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "claim-guards", TeamMember{Name: "worker", SessionID: "ses_worker"}); err != nil {
			t.Fatalf("add member: %v", err)
		}
		if err := svc.AddTasks(ctx, "claim-guards", []TeamTask{
			{ID: "prereq", Content: "prereq", Status: TaskStatusPending},
			{ID: "blocked", Content: "blocked", Status: TaskStatusPending, DependsOn: []string{"prereq"}},
			{ID: "ready", Content: "ready", Status: TaskStatusPending},
		}); err != nil {
			t.Fatalf("add tasks: %v", err)
		}

		res, err := teamTools.Claim(ctx, ToolContext{SessionID: "ses_worker"}, "blocked")
		if err != nil {
			t.Fatalf("claim blocked task: %v", err)
		}
		if res.Title != "Claim failed" {
			t.Fatalf("expected claim failure for blocked task, got %+v", res)
		}

		res, err = teamTools.Claim(ctx, ToolContext{SessionID: "ses_worker"}, "ready")
		if err != nil {
			t.Fatalf("claim ready task: %v", err)
		}
		if res.Title != "Task claimed" {
			t.Fatalf("expected successful claim, got %+v", res)
		}

		tasks, err := svc.ListTasks(ctx, "claim-guards")
		if err != nil {
			t.Fatalf("list tasks: %v", err)
		}
		for _, task := range tasks {
			if task.ID == "ready" && task.Assignee != "worker" {
				t.Fatalf("expected assignee to be member name, got %q", task.Assignee)
			}
		}
	})
}
