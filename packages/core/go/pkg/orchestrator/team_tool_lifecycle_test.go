package orchestrator

import (
	"context"
	"errors"
	"strings"
	"testing"
)

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

	svc.Wait()
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

	svc.Wait()
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
