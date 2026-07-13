package orchestrator

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
)

func TestTeamServiceMessagingAndTasksGapCoverage(t *testing.T) {
	ctx := context.Background()

	t.Run("mark read sends singular and plural receipts", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		inbox := newTestTeamInbox(t.TempDir())
		sessions := &countingSessions{}
		svc := NewTeamService(store, inbox, sessions, &mockModels{}, &failingBus{publishErr: errors.New("publish failed")})
		if _, err := svc.Create(ctx, "receipt-team", "lead-ses", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "receipt-team", TeamMember{Name: "worker", SessionID: "worker-ses", Status: MemberStatusReady}); err != nil {
			t.Fatalf("add worker: %v", err)
		}
		if err := svc.AddMember(ctx, "receipt-team", TeamMember{Name: "helper", SessionID: "helper-ses", Status: MemberStatusReady}); err != nil {
			t.Fatalf("add helper: %v", err)
		}

		_ = inbox.Write("receipt-team", "worker", agent.InboxMessage{ID: "m1", From: "lead", Text: "one"})
		_ = inbox.Write("receipt-team", "worker", agent.InboxMessage{ID: "m2", From: "helper", Text: "two"})
		_ = inbox.Write("receipt-team", "worker", agent.InboxMessage{ID: "m3", From: "helper", Text: "three"})

		count, err := svc.MarkRead(ctx, "receipt-team", "worker")
		if err != nil || count != 3 {
			t.Fatalf("mark read failed: count=%d err=%v", count, err)
		}
		if len(sessions.injected) < 2 {
			t.Fatalf("expected read receipt injections, got %#v", sessions.injected)
		}
	})

	t.Run("mark read does not receipt receipts", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		inbox := newTestTeamInbox(t.TempDir())
		sessions := &countingSessions{}
		svc := NewTeamService(store, inbox, sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "receipt-loop", "lead-ses", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "receipt-loop", TeamMember{Name: "worker", SessionID: "worker-ses", Status: MemberStatusReady}); err != nil {
			t.Fatalf("add worker: %v", err)
		}

		_ = inbox.Write("receipt-loop", "worker", agent.InboxMessage{ID: "r1", From: "lead", Text: "[receipt] lead has read your message"})

		count, err := svc.MarkRead(ctx, "receipt-loop", "worker")
		if err != nil || count != 1 {
			t.Fatalf("mark read failed: count=%d err=%v", count, err)
		}
		if len(sessions.injected) != 0 {
			t.Fatalf("expected no receipt injection for receipt message, got %#v", sessions.injected)
		}
	})

	t.Run("mark read returns zero when no messages were read", func(t *testing.T) {
		svc := NewTeamService(nil, newTestTeamInbox(t.TempDir()), nil, nil, nil)

		count, err := svc.MarkRead(ctx, "empty-team", "worker")

		if err != nil {
			t.Fatalf("expected no error for empty read set, got %v", err)
		}
		if count != 0 {
			t.Fatalf("expected zero read messages, got %d", count)
		}
	})

	t.Run("broadcast tolerates inbox and session failures", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		inbox := newTestTeamInbox(t.TempDir())
		sessions := &additionalSessions{
			injectErrs:   map[string]error{"helper-ses": errors.New("inject failed")},
			autoWakeErrs: map[string]error{"lead-ses": errors.New("wake failed")},
		}
		svc := NewTeamService(store, inbox, sessions, &mockModels{}, &failingBus{publishErr: errors.New("publish failed")})
		if _, err := svc.Create(ctx, "broadcast-warn", "lead-ses", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		_ = svc.AddMember(ctx, "broadcast-warn", TeamMember{Name: "helper", SessionID: "helper-ses", Status: MemberStatusReady})
		if err := svc.Broadcast(ctx, "broadcast-warn", "lead", "update"); err != nil {
			t.Fatalf("broadcast should swallow downstream failures, got %v", err)
		}
	})

	t.Run("task store failures and find current member miss", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore:   &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)},
			getTasksErr: errors.New("get tasks failed"),
		}
		svc := NewTeamService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "task-errors", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddTasks(ctx, "task-errors", []TeamTask{{ID: "1", Content: "task"}}); err == nil || !strings.Contains(err.Error(), "get tasks failed") {
			t.Fatalf("expected add tasks error, got %v", err)
		}
		if member := svc.findCurrentMember(ctx, "missing", "worker"); member != nil {
			t.Fatalf("expected nil member for missing team, got %#v", member)
		}
	})

	t.Run("recover list teams failure", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore: &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)},
			listErr:   fmt.Errorf("list failed"),
		}
		svc := NewTeamService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Recover(ctx); err == nil || !strings.Contains(err.Error(), "list failed") {
			t.Fatalf("expected recover list error, got %v", err)
		}
	})
}

func TestTeamServiceRecoverLogsInboxRecoveryErrors(t *testing.T) {
	ctx := context.Background()
	store := &mockStore{teams: map[string]*TeamInfo{
		"recover-errors": {
			Name:          "recover-errors",
			LeadSessionID: "lead-session",
			Members: []TeamMember{{
				Name:      "worker",
				SessionID: "worker-session",
				Status:    MemberStatusBusy,
			}},
		},
	}, tasks: make(map[string][]TeamTask)}
	inbox := newTestTeamInbox(t.TempDir())
	inbox.unreadErr = errors.New("recover inbox failed")
	svc := NewTeamService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})

	count, err := svc.Recover(ctx)

	if err != nil {
		t.Fatalf("recover should tolerate inbox recovery errors, got %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one busy member recovered, got %d", count)
	}
}

func TestTeamServiceMessagingCleanupAndCancelBranches(t *testing.T) {
	ctx := context.Background()
	store := &mockStore{
		teams: map[string]*TeamInfo{
			"team": {
				Name:          "team",
				LeadSessionID: "lead-session",
				Delegate:      true,
				Members: []TeamMember{
					{Name: "worker", SessionID: "worker-session", Status: MemberStatusBusy, ExecutionStatus: ExecutionStatusRunning},
					{Name: "helper", SessionID: "helper-session", Status: MemberStatusReady, ExecutionStatus: ExecutionStatusIdle},
					{Name: "done", SessionID: "done-session", Status: MemberStatusShutdown, ExecutionStatus: ExecutionStatusCompleted},
				},
			},
		},
		tasks: map[string][]TeamTask{},
	}
	sessions := &countingSessions{}
	svc := NewTeamService(store, newTestTeamInbox(t.TempDir()), sessions, &mockModels{}, &mockBus{})

	cancelled, err := svc.CancelMember(ctx, "team", "worker")
	if err != nil || !cancelled {
		t.Fatalf("expected worker cancel, cancelled=%v err=%v", cancelled, err)
	}
	if sessions.cancelID != "worker-session" {
		t.Fatalf("expected worker session cancel, got %q", sessions.cancelID)
	}
	cancelled, err = svc.CancelMember(ctx, "team", "helper")
	if err != nil || cancelled {
		t.Fatalf("ready helper should not cancel, cancelled=%v err=%v", cancelled, err)
	}
	cancelled, err = svc.CancelMember(ctx, "team", "missing")
	if !errors.Is(err, ErrMemberNotFound) || cancelled {
		t.Fatalf("missing member should fail with ErrMemberNotFound, cancelled=%v err=%v", cancelled, err)
	}

	if err := svc.Broadcast(ctx, "team", "worker", "hello everyone"); err != nil {
		t.Fatalf("broadcast from worker failed: %v", err)
	}
	if len(sessions.injected) < 2 {
		t.Fatalf("expected broadcast injections to lead and helper, got %#v", sessions.injected)
	}

	if err := svc.Send(ctx, "team", "lead", "worker", "direct"); err != nil {
		t.Fatalf("send failed: %v", err)
	}
	count, err := svc.MarkRead(ctx, "team", "worker")
	if err != nil || count == 0 {
		t.Fatalf("expected worker read receipts, count=%d err=%v", count, err)
	}

	if err := svc.Cleanup(ctx, "team"); err == nil {
		t.Fatalf("cleanup should fail while members are not shutdown")
	}
	for i := range store.teams["team"].Members {
		store.teams["team"].Members[i].Status = MemberStatusShutdown
	}
	if err := svc.Cleanup(ctx, "team"); err != nil {
		t.Fatalf("cleanup should succeed after shutdown: %v", err)
	}
	if _, ok := store.teams["team"]; ok {
		t.Fatalf("expected team to be deleted")
	}
}

func (m *mockStore) GetTeam(ctx context.Context, name string) (*TeamInfo, error) {
	t, ok := m.teams[name]
	if !ok {
		return nil, ErrTeamNotFound
	}
	return t, nil
}
func (m *mockStore) SaveTeam(ctx context.Context, team *TeamInfo) error {
	m.teams[team.Name] = team
	return nil
}
func (m *mockStore) ListTeams(ctx context.Context) ([]TeamInfo, error) {
	list := make([]TeamInfo, 0, len(m.teams))
	for _, t := range m.teams {
		list = append(list, *t)
	}
	return list, nil
}
func (m *mockStore) GetTasks(ctx context.Context, teamName string) ([]TeamTask, error) {
	return m.tasks[teamName], nil
}
func (m *mockStore) SaveTasks(ctx context.Context, teamName string, tasks []TeamTask) error {
	m.tasks[teamName] = tasks
	return nil
}
func (m *mockStore) DeleteTeam(ctx context.Context, name string) error {
	delete(m.teams, name)
	return nil
}
func (m *mockStore) FindBySession(ctx context.Context, sessionID string) (*TeamInfo, string, string, error) {
	for _, t := range m.teams {
		if t.LeadSessionID == sessionID {
			return t, "lead", "", nil
		}
		for _, mem := range t.Members {
			if mem.SessionID == sessionID {
				return t, "member", mem.Name, nil
			}
		}
	}
	return nil, "", "", nil
}

type mockBus struct{}

func (m *mockBus) Publish(ctx context.Context, event string, properties any) error {
	return nil
}
func (m *mockBus) Subscribe(ctx context.Context, event string, handler func(ctx context.Context, properties map[string]any) error) error {
	return nil
}

type mockSessions struct{}

func (m *mockSessions) InjectMessage(ctx context.Context, sessionID, fromName, text, inboxMessageID string) error {
	return nil
}
func (m *mockSessions) AutoWake(ctx context.Context, sessionID string) error { return nil }
func (m *mockSessions) GetSessionInfo(ctx context.Context, sessionID string) (string, string, string, error) {
	return "", "", "", nil
}
func (m *mockSessions) UpdatePermissions(ctx context.Context, sessionID string, removePattern string) error {
	return nil
}
func (m *mockSessions) RestoreLeadPermissions(ctx context.Context, sessionID string, writeTools []string) error {
	return nil
}
func (m *mockSessions) CancelPrompt(ctx context.Context, sessionID string) error  { return nil }
func (m *mockSessions) RemoveSession(ctx context.Context, sessionID string) error { return nil }
func (m *mockSessions) CreateSession(ctx context.Context, parentID, agentName, title string, permissions []PermissionRule) (string, error) {
	return "ses_child", nil
}
func (m *mockSessions) StartPromptLoop(ctx context.Context, sessionID string) error { return nil }
func (m *mockSessions) GetLastUserMessageModel(ctx context.Context, sessionID string) (*ModelInfo, error) {
	return nil, nil
}

type trackingSessions struct {
	mockSessions
	createSessionCalls int
}

func (m *trackingSessions) CreateSession(ctx context.Context, parentID, agentName, title string, permissions []PermissionRule) (string, error) {
	m.createSessionCalls++
	return "ses_child", nil
}

type countingSessions struct {
	mockSessions
	injected []string
	wakeIDs  []string
	cancelID string
}

func (m *countingSessions) InjectMessage(ctx context.Context, sessionID, fromName, text, inboxMessageID string) error {
	m.injected = append(m.injected, sessionID+":"+fromName+":"+text)
	return nil
}

func (m *countingSessions) AutoWake(ctx context.Context, sessionID string) error {
	m.wakeIDs = append(m.wakeIDs, sessionID)
	return nil
}

func (m *countingSessions) CancelPrompt(ctx context.Context, sessionID string) error {
	m.cancelID = sessionID
	return nil
}

type mockModels struct {
	defaultModel ModelInfo
}

func (m *mockModels) ParseModel(model string) (ModelInfo, error) {
	if model == "invalid" {
		return ModelInfo{ProviderID: "p", ModelID: "invalid"}, nil
	}
	return ModelInfo{ProviderID: "p", ModelID: "m"}, nil
}
func (m *mockModels) GetModel(ctx context.Context, providerID, modelID string) (any, error) {
	if modelID == "invalid" {
		return nil, fmt.Errorf("not found")
	}
	return nil, nil
}
func (m *mockModels) DefaultModel(ctx context.Context) (ModelInfo, error) { return m.defaultModel, nil }

type addMemberBlockingStore struct {
	mu                sync.Mutex
	team              *TeamInfo
	firstSaveEntered  chan struct{}
	releaseFirstSave  chan struct{}
	secondGetObserved chan struct{}
	getCalls          int
	saveCalls         int
}

func newAddMemberBlockingStore(teamName string) *addMemberBlockingStore {
	return &addMemberBlockingStore{
		team: &TeamInfo{
			Name:    teamName,
			Members: []TeamMember{},
		},
		firstSaveEntered:  make(chan struct{}),
		releaseFirstSave:  make(chan struct{}),
		secondGetObserved: make(chan struct{}),
	}
}

func (s *addMemberBlockingStore) GetTeam(ctx context.Context, name string) (*TeamInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.team == nil || s.team.Name != name {
		return nil, ErrTeamNotFound
	}
	s.getCalls++
	if s.getCalls == 2 {
		close(s.secondGetObserved)
	}
	return cloneTeamInfo(s.team), nil
}

func (s *addMemberBlockingStore) SaveTeam(ctx context.Context, team *TeamInfo) error {
	s.mu.Lock()
	s.saveCalls++
	saveCall := s.saveCalls
	s.mu.Unlock()

	if saveCall == 1 {
		close(s.firstSaveEntered)
		<-s.releaseFirstSave
	}

	s.mu.Lock()
	s.team = cloneTeamInfo(team)
	s.mu.Unlock()
	return nil
}

func (s *addMemberBlockingStore) ListTeams(ctx context.Context) ([]TeamInfo, error) { return nil, nil }
func (s *addMemberBlockingStore) GetTasks(ctx context.Context, teamName string) ([]TeamTask, error) {
	return nil, nil
}
func (s *addMemberBlockingStore) SaveTasks(ctx context.Context, teamName string, tasks []TeamTask) error {
	return nil
}
func (s *addMemberBlockingStore) DeleteTeam(ctx context.Context, name string) error { return nil }
func (s *addMemberBlockingStore) FindBySession(ctx context.Context, sessionID string) (*TeamInfo, string, string, error) {
	return nil, "", "", nil
}

func TestTeamServiceMoreCoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("get reports missing team when store returns nil", func(t *testing.T) {
		svc := NewTeamService(&nilTeamStore{mockStore: &mockStore{teams: map[string]*TeamInfo{}, tasks: map[string][]TeamTask{}}}, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Get(ctx, "nil-team"); err == nil || !strings.Contains(err.Error(), "not found") {
			t.Fatalf("expected not found error, got %v", err)
		}
	})

	t.Run("transition and delegate error branches", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore:  &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)},
			getTeamErr: errors.New("get failed"),
		}
		svc := NewTeamService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.TransitionMemberStatus(ctx, "any", "worker", MemberStatusBusy, true); err == nil {
			t.Fatal("expected transition get team error")
		}
		if _, err := svc.TransitionExecutionStatus(ctx, "any", "worker", ExecutionStatusRunning, true); err == nil {
			t.Fatal("expected execution transition get team error")
		}
		if err := svc.SetDelegate(ctx, "any", true); err == nil {
			t.Fatal("expected set delegate error")
		}

		store.getTeamErr = nil
		if _, err := svc.Create(ctx, "delegate-team", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		store.saveTeamErr = errors.New("save failed")
		if err := svc.SetDelegate(ctx, "delegate-team", true); err == nil {
			t.Fatal("expected set delegate save error")
		}
	})

	t.Run("approve plan and cleanup propagate get failures", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore:  &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)},
			getTeamErr: errors.New("get failed"),
		}
		svc := NewTeamService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if err := svc.ApprovePlan(ctx, "team", "worker", true, ""); err == nil {
			t.Fatal("expected approve plan get error")
		}
		if err := svc.Cleanup(ctx, "team"); err == nil {
			t.Fatal("expected cleanup get error")
		}
	})

	t.Run("send write failure and mark read inbox failure", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewTeamService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "send-team", "lead-ses", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		_ = svc.AddMember(ctx, "send-team", TeamMember{Name: "worker", SessionID: "worker-ses", Status: MemberStatusReady})

		inbox.writeErr = errors.New("write failed")
		if err := svc.Send(ctx, "send-team", "lead", "worker", "hello"); err == nil {
			t.Fatal("expected send inbox write failure")
		}

		goodInbox := newTestTeamInbox(t.TempDir())
		svc.inbox = goodInbox
		if err := svc.Send(ctx, "send-team", "lead", "worker", "hello"); err != nil {
			t.Fatalf("send after restoring inbox: %v", err)
		}
		goodInbox = newTestTeamInbox(t.TempDir())
		goodInbox.markErr = errors.New("mark failed")
		svc.inbox = goodInbox
		if _, err := svc.MarkRead(ctx, "send-team", "worker"); err == nil {
			t.Fatal("expected mark read failure on blocked inbox path")
		}
	})

	t.Run("recover inbox unreadable path and complete task list failure", func(t *testing.T) {
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewTeamService(&erroringTeamStore{
			mockStore:   &mockStore{teams: map[string]*TeamInfo{}, tasks: map[string][]TeamTask{}},
			getTasksErr: errors.New("list failed"),
		}, inbox, &mockSessions{}, &mockModels{}, &mockBus{})

		if _, err := svc.RecoverInbox(ctx, "../bad", "agent", "ses"); err == nil {
			t.Fatal("expected recover inbox unread error")
		}
		if err := svc.CompleteTask(ctx, "team", "task-1"); err == nil {
			t.Fatal("expected complete task list error")
		}
	})

	t.Run("resolve dependencies marks blocked tasks and unblocks when deps complete", func(t *testing.T) {
		svc := NewTeamService(nil, nil, nil, nil, nil)
		blocked := svc.resolveDependencies([]TeamTask{
			{ID: "dep", Status: TaskStatusPending},
			{ID: "child", Status: TaskStatusPending, DependsOn: []string{"dep"}},
		})
		if blocked[1].Status != TaskStatusBlocked {
			t.Fatalf("expected child task to be blocked, got %s", blocked[1].Status)
		}

		unblocked := svc.resolveDependencies([]TeamTask{
			{ID: "dep", Status: TaskStatusCompleted},
			{ID: "child", Status: TaskStatusBlocked, DependsOn: []string{"dep"}},
		})
		if unblocked[1].Status != TaskStatusPending {
			t.Fatalf("expected child task to be pending after dependency completion, got %s", unblocked[1].Status)
		}
	})

	t.Run("spawn member warns on claim task and transition starting failures", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore:   &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)},
			saveTeamErr: nil,
		}
		sessions := &spawnSessions{}
		svc := NewTeamService(store, newTestTeamInbox(t.TempDir()), sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "spawn-claim", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		store.saveTeamErr = errors.New("transition save failed")
		input := SpawnInput{
			TeamName:        "spawn-claim",
			Name:            "worker",
			ParentSessionID: "lead",
			Prompt:          "work",
			ClaimTask:       "missing-task",
		}
		input.Agent.Name = "agent"
		input.Model.ProviderID = "p"
		input.Model.ModelID = "m"
		if _, _, err := svc.SpawnMember(ctx, input); err == nil || !strings.Contains(err.Error(), "transition save failed") {
			t.Fatalf("expected transition starting save failure, got %v", err)
		}
	})

	t.Run("run member loop tolerates transition and send failures", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore: &mockStore{
				teams: map[string]*TeamInfo{
					"loop-team": {
						Name:          "loop-team",
						LeadSessionID: "lead-ses",
						Members: []TeamMember{{
							Name:      "worker",
							SessionID: "worker-ses",
							Status:    MemberStatusBusy,
						}},
					},
				},
				tasks: map[string][]TeamTask{},
			},
			saveTeamErr: errors.New("save failed"),
		}
		inbox := newTestTeamInbox(t.TempDir())
		sessions := &spawnSessions{startLoopErr: errors.New("loop failed"), injectErr: errors.New("inject failed")}
		svc := NewTeamService(store, inbox, sessions, &mockModels{}, &mockBus{})

		svc.runWG.Add(1)
		svc.runMemberLoop(ctx, SpawnInput{TeamName: "loop-team", Name: "worker", ParentSessionID: "lead", Prompt: "work"}, "worker-ses")
		svc.runWG.Wait()
	})
}

func TestTeamServiceRemainingCoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("transition execution status member not found", func(t *testing.T) {
		store := &mockStore{teams: map[string]*TeamInfo{
			"t": {Name: "t", LeadSessionID: "lead", Members: []TeamMember{}},
		}, tasks: map[string][]TeamTask{}}
		svc := NewTeamService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.TransitionExecutionStatus(ctx, "t", "missing", ExecutionStatusRunning, true); !errors.Is(err, ErrMemberNotFound) {
			t.Fatalf("expected ErrMemberNotFound, got %v", err)
		}
	})

	t.Run("approve plan save failure and send plan feedback warning", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore: &mockStore{teams: map[string]*TeamInfo{
				"plan": {
					Name:          "plan",
					LeadSessionID: "lead",
					Members:       []TeamMember{{Name: "worker", SessionID: "worker", PlanApproval: PlanApprovalPending}},
				},
			}, tasks: map[string][]TeamTask{}},
		}
		svc := NewTeamService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})
		store.saveTeamErr = errors.New("save failed")
		if err := svc.ApprovePlan(ctx, "plan", "worker", true, ""); err == nil {
			t.Fatal("expected approve plan save failure")
		}

		store.saveTeamErr = nil
		inbox := newTestTeamInbox(t.TempDir())
		svc.inbox = inbox
		if err := inbox.Write("plan", "worker", agent.InboxMessage{ID: "seed", From: "lead", Text: "seed"}); err != nil {
			t.Fatalf("seed worker inbox: %v", err)
		}
		inbox.writeErr = errors.New("write failed")
		svc.sendPlanFeedback(ctx, "plan", "worker", true, "try again")
	})

	t.Run("cancel member and cancel all propagate get failures", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore:  &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)},
			getTeamErr: errors.New("get failed"),
		}
		svc := NewTeamService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.CancelMember(ctx, "team", "worker"); err == nil {
			t.Fatal("expected cancel member get failure")
		}
		if _, err := svc.CancelAll(ctx, "team"); err == nil {
			t.Fatal("expected cancel all get failure")
		}
	})

	t.Run("broadcast validates text and tolerates autowake failures", func(t *testing.T) {
		store := &mockStore{teams: map[string]*TeamInfo{
			"bcast": {
				Name:          "bcast",
				LeadSessionID: "lead",
				Members:       []TeamMember{{Name: "worker", SessionID: "worker", Status: MemberStatusReady}},
			},
		}, tasks: map[string][]TeamTask{}}
		svc := NewTeamService(store, newTestTeamInbox(t.TempDir()), &failingAutoWakeSessions{wakeErr: errors.New("wake failed")}, &mockModels{}, &mockBus{})
		if err := svc.Broadcast(ctx, "bcast", "lead", strings.Repeat("x", MAX_TEXT+1)); err == nil {
			t.Fatal("expected broadcast text validation failure")
		}
		if err := svc.Broadcast(ctx, "bcast", "lead", "hello"); err != nil {
			t.Fatalf("broadcast should succeed despite autowake warning: %v", err)
		}
	})

	t.Run("mark read sends receipt warnings and claim task blocked paths", func(t *testing.T) {
		store := &mockStore{teams: map[string]*TeamInfo{
			"tasks": {
				Name:          "tasks",
				LeadSessionID: "lead",
				Members:       []TeamMember{{Name: "worker", SessionID: "worker", Status: MemberStatusReady}},
			},
		}, tasks: map[string][]TeamTask{
			"tasks": {
				{ID: "dep", Status: TaskStatusPending},
				{ID: "child", Status: TaskStatusPending, DependsOn: []string{"dep"}},
			},
		}}
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewTeamService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
		_ = inbox.Write("tasks", "worker", agentInboxMessage("lead", "hello"))

		blockingInbox := newTestTeamInbox(t.TempDir())
		_ = blockingInbox.Write("tasks", "worker", agentInboxMessage("lead", "hello"))
		blockingInbox.writeErr = errors.New("write failed")
		svc.inbox = blockingInbox
		if _, err := svc.MarkRead(ctx, "tasks", "worker"); err != nil {
			t.Fatalf("mark read: %v", err)
		}

		svc.inbox = inbox
		if claimed, err := svc.ClaimTask(ctx, "tasks", "child", "worker"); err != nil || claimed {
			t.Fatalf("expected blocked claim to be rejected, claimed=%v err=%v", claimed, err)
		}
		if err := svc.CompleteTask(ctx, "tasks", "missing"); err != nil {
			t.Fatalf("complete missing task should succeed: %v", err)
		}
	})

	t.Run("run member loop completion paths warn on transition failures", func(t *testing.T) {
		store := &failingSaveStore{
			mockStore: &mockStore{
				teams: map[string]*TeamInfo{
					"loop": {
						Name:          "loop",
						LeadSessionID: "lead",
						Members: []TeamMember{{
							Name:            "worker",
							SessionID:       "worker",
							Status:          MemberStatusBusy,
							ExecutionStatus: ExecutionStatusRunning,
						}},
					},
				},
				tasks: map[string][]TeamTask{},
			},
			saveTeamErr: errors.New("save failed"),
		}
		svc := NewTeamService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})
		msg := svc.buildCompletionMessage(ctx, "loop", "worker", "worker", nil)
		if msg == "" || !strings.Contains(msg, "finished my current work") {
			t.Fatalf("expected ready completion message, got %q", msg)
		}
		if member := svc.findCurrentMember(ctx, "missing", "worker"); member != nil {
			t.Fatalf("expected nil member for missing team, got %#v", member)
		}
	})
}

func TestTeamServiceSpawnMemberGapCoverage(t *testing.T) {
	ctx := context.Background()

	t.Run("create session failure", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		sessions := &spawnSessions{createErr: errors.New("create session failed")}
		svc := NewTeamService(store, nil, sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "spawn-create-fail", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		input := SpawnInput{TeamName: "spawn-create-fail", Name: "worker", ParentSessionID: "lead", Prompt: "work"}
		input.Agent.Name = "agent"
		input.Model.ProviderID = "p"
		input.Model.ModelID = "m"
		if _, _, err := svc.SpawnMember(ctx, input); err == nil || !strings.Contains(err.Error(), "create session failed") {
			t.Fatalf("expected create session error, got %v", err)
		}
	})

	t.Run("add member failure removes created session", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore:   &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)},
			saveTeamErr: nil,
		}
		sessions := &spawnSessions{}
		svc := NewTeamService(store, nil, sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "spawn-add-fail", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		store.saveTeamErr = errors.New("add member save failed")

		input := SpawnInput{TeamName: "spawn-add-fail", Name: "worker", ParentSessionID: "lead", Prompt: "work"}
		input.Agent.Name = "agent"
		input.Model.ProviderID = "p"
		input.Model.ModelID = "m"
		if _, _, err := svc.SpawnMember(ctx, input); err == nil || !strings.Contains(err.Error(), "add member save failed") {
			t.Fatalf("expected add member error, got %v", err)
		}
		if sessions.removeCalls != 1 {
			t.Fatalf("expected session cleanup after add failure, got %d remove calls", sessions.removeCalls)
		}
	})

	t.Run("inject message failure", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		sessions := &spawnSessions{injectErr: errors.New("inject failed")}
		svc := NewTeamService(store, nil, sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "spawn-inject-fail", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		input := SpawnInput{TeamName: "spawn-inject-fail", Name: "worker", ParentSessionID: "lead", Prompt: "work"}
		input.Agent.Name = "agent"
		input.Model.ProviderID = "p"
		input.Model.ModelID = "m"
		if _, _, err := svc.SpawnMember(ctx, input); err == nil || !strings.Contains(err.Error(), "inject failed") {
			t.Fatalf("expected inject error, got %v", err)
		}
	})

	t.Run("member loop handles prompt loop error panic and completion message", func(t *testing.T) {
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		inbox := newTestTeamInbox(t.TempDir())
		sessions := &spawnSessions{startLoopErr: errors.New("loop failed")}
		svc := NewTeamService(store, inbox, sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "spawn-loop", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		input := SpawnInput{TeamName: "spawn-loop", Name: "worker", ParentSessionID: "lead", Prompt: "work"}
		input.Agent.Name = "agent"
		input.Model.ProviderID = "p"
		input.Model.ModelID = "m"
		if _, _, err := svc.SpawnMember(ctx, input); err != nil {
			t.Fatalf("spawn member: %v", err)
		}
		svc.runWG.Wait()

		team, err := svc.Get(ctx, "spawn-loop")
		if err != nil {
			t.Fatalf("get team: %v", err)
		}
		if team.Members[0].Status != MemberStatusError {
			t.Fatalf("expected error status after loop failure, got %s", team.Members[0].Status)
		}

		sessions.startLoopErr = nil
		sessions.startLoopPanic = true
		input.Name = "worker2"
		if _, _, err := svc.SpawnMember(ctx, input); err != nil {
			t.Fatalf("spawn panic member: %v", err)
		}
		svc.runWG.Wait()
	})
}
