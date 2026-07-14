package team

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestTeamService_BuildCompletionMessageTransitions(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name         string
		initial      MemberStatus
		loopErr      error
		expectStatus MemberStatus
		expectEmpty  bool
		expectText   string
	}{
		{
			name:         "loop error transitions to error",
			initial:      MemberStatusBusy,
			loopErr:      errors.New("loop crashed"),
			expectStatus: MemberStatusError,
			expectText:   "I encountered an error and stopped",
		},
		{
			name:         "shutdown requested transitions to shutdown with no message",
			initial:      MemberStatusShutdownRequested,
			expectStatus: MemberStatusShutdown,
			expectEmpty:  true,
		},
		{
			name:         "successful completion transitions to ready",
			initial:      MemberStatusBusy,
			expectStatus: MemberStatusReady,
			expectText:   "I have finished my current work and am now idle",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
			svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
			teamName := "completion-team"
			if _, err := svc.Create(ctx, teamName, "lead", false); err != nil {
				t.Fatalf("failed to create team: %v", err)
			}
			if err := svc.AddMember(ctx, teamName, Member{Name: "worker", SessionID: "ses_worker", Status: tc.initial}); err != nil {
				t.Fatalf("failed to add member: %v", err)
			}

			msg := svc.buildCompletionMessage(ctx, teamName, "worker", "ses_member", tc.loopErr)
			if tc.expectEmpty && msg != "" {
				t.Fatalf("expected empty completion message, got %q", msg)
			}
			if !tc.expectEmpty && msg == "" {
				t.Fatal("expected non-empty completion message")
			}
			if tc.expectEmpty {
				return
			}
			if !strings.Contains(msg, tc.expectText) {
				t.Fatalf("expected message containing %q, got %q", tc.expectText, msg)
			}
			if !strings.Contains(msg, "ses_member") {
				t.Fatalf("expected message to include session id, got %q", msg)
			}

			team, err := svc.Get(ctx, teamName)
			if err != nil {
				t.Fatalf("failed to fetch team: %v", err)
			}
			if len(team.Members) != 1 {
				t.Fatalf("expected 1 member, got %d", len(team.Members))
			}
			if team.Members[0].Status != tc.expectStatus {
				t.Fatalf("expected status %q, got %q", tc.expectStatus, team.Members[0].Status)
			}
		})
	}
}

func TestTeamService_EnsureSpawnBudgetAvailableMatrix(t *testing.T) {
	cases := []struct {
		name        string
		budget      SpawnBudget
		expectError string
	}{
		{
			name:   "no budget manager",
			budget: nil,
		},
		{
			name:   "budget port allows spawn",
			budget: spawnBudgetStub{},
		},
		{
			name:        "budget port rejects spawn",
			budget:      spawnBudgetStub{err: errors.New("budget exhausted")},
			expectError: "budget exhausted",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := NewService(nil, nil, nil, nil, nil)
			svc.SetBudget(tc.budget)

			err := svc.ensureSpawnBudgetAvailable()
			if tc.expectError == "" {
				if err != nil {
					t.Fatalf("expected no error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.expectError)
			}
			if !strings.Contains(err.Error(), tc.expectError) {
				t.Fatalf("expected error containing %q, got %v", tc.expectError, err)
			}
		})
	}
}

func TestTeamService_IsTaskBlockedMatrix(t *testing.T) {
	svc := NewService(nil, nil, nil, nil, nil)
	cases := []struct {
		name    string
		task    Task
		all     []Task
		blocked bool
	}{
		{
			name:    "task with no dependencies is not blocked",
			task:    Task{ID: "task"},
			all:     []Task{},
			blocked: false,
		},
		{
			name:    "missing dependency blocks task",
			task:    Task{ID: "task", DependsOn: []string{"missing"}},
			all:     []Task{{ID: "other", Status: TaskStatusCompleted}},
			blocked: true,
		},
		{
			name:    "pending dependency blocks task",
			task:    Task{ID: "task", DependsOn: []string{"dep"}},
			all:     []Task{{ID: "dep", Status: TaskStatusPending}},
			blocked: true,
		},
		{
			name:    "in progress dependency blocks task",
			task:    Task{ID: "task", DependsOn: []string{"dep"}},
			all:     []Task{{ID: "dep", Status: TaskStatusInProgress}},
			blocked: true,
		},
		{
			name:    "blocked dependency blocks task",
			task:    Task{ID: "task", DependsOn: []string{"dep"}},
			all:     []Task{{ID: "dep", Status: TaskStatusBlocked}},
			blocked: true,
		},
		{
			name:    "completed dependency does not block task",
			task:    Task{ID: "task", DependsOn: []string{"dep"}},
			all:     []Task{{ID: "dep", Status: TaskStatusCompleted}},
			blocked: false,
		},
		{
			name:    "cancelled dependency does not block task",
			task:    Task{ID: "task", DependsOn: []string{"dep"}},
			all:     []Task{{ID: "dep", Status: TaskStatusCancelled}},
			blocked: false,
		},
		{
			name: "all dependencies terminal does not block task",
			task: Task{ID: "task", DependsOn: []string{"dep1", "dep2"}},
			all: []Task{
				{ID: "dep1", Status: TaskStatusCompleted},
				{ID: "dep2", Status: TaskStatusCancelled},
			},
			blocked: false,
		},
		{
			name: "one unresolved dependency blocks task",
			task: Task{ID: "task", DependsOn: []string{"dep1", "dep2"}},
			all: []Task{
				{ID: "dep1", Status: TaskStatusCompleted},
				{ID: "dep2", Status: TaskStatusInProgress},
			},
			blocked: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			blocked := svc.isTaskBlocked(tc.task, tc.all)
			if blocked != tc.blocked {
				t.Fatalf("expected blocked=%v, got %v", tc.blocked, blocked)
			}
		})
	}
}

func TestTeamService_SpawnMemberBudgetExhaustion(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name        string
		budget      SpawnBudget
		expectError string
	}{
		{
			name:        "budget port rejects spawn",
			budget:      spawnBudgetStub{err: errors.New("budget exhausted")},
			expectError: "budget exhausted",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
			sessions := &trackingSessions{}
			svc := NewService(store, nil, sessions, &mockModels{}, &mockBus{})
			teamName := "spawn-budget-team"
			if _, err := svc.Create(ctx, teamName, "lead", false); err != nil {
				t.Fatalf("failed to create team: %v", err)
			}
			svc.SetBudget(tc.budget)

			input := SpawnInput{
				TeamName:        teamName,
				Name:            "worker",
				ParentSessionID: "lead-ses",
				Prompt:          "work",
			}
			input.Agent.Name = "coding-agent"
			input.Model.ProviderID = "p"
			input.Model.ModelID = "m"

			sessionID, label, err := svc.SpawnMember(ctx, input)
			if err == nil {
				t.Fatalf("expected budget error containing %q, got nil", tc.expectError)
			}
			if !strings.Contains(err.Error(), tc.expectError) {
				t.Fatalf("expected error containing %q, got %v", tc.expectError, err)
			}
			if sessionID != "" || label != "" {
				t.Fatalf("expected empty session/label on failure, got %q/%q", sessionID, label)
			}
			if sessions.createSessionCalls != 0 {
				t.Fatalf("expected no session creation attempt, got %d", sessions.createSessionCalls)
			}

			team, getErr := svc.Get(ctx, teamName)
			if getErr != nil {
				t.Fatalf("failed to get team: %v", getErr)
			}
			if len(team.Members) != 0 {
				t.Fatalf("expected no members added on budget failure, got %d", len(team.Members))
			}
		})
	}
}
