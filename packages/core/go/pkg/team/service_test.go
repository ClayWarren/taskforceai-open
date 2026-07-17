package team

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

type mockStore struct {
	teams map[string]*Team
	tasks map[string][]Task
}

type failingSaveStore struct {
	*mockStore
	getTeamErr   error
	saveTeamErr  error
	saveTasksErr error
}

func (s *failingSaveStore) GetTeam(ctx context.Context, name string) (*Team, error) {
	if s.getTeamErr != nil {
		return nil, s.getTeamErr
	}
	return s.mockStore.GetTeam(ctx, name)
}

func (s *failingSaveStore) SaveTeam(ctx context.Context, team *Team) error {
	if s.saveTeamErr != nil {
		return s.saveTeamErr
	}
	return s.mockStore.SaveTeam(ctx, team)
}

func (s *failingSaveStore) SaveTasks(ctx context.Context, teamName string, tasks []Task) error {
	if s.saveTasksErr != nil {
		return s.saveTasksErr
	}
	return s.mockStore.SaveTasks(ctx, teamName, tasks)
}

type erroringTeamStore struct {
	*mockStore
	saveTeamErr  error
	saveTasksErr error
	deleteErr    error
	listErr      error
	getTasksErr  error
}

func (s *erroringTeamStore) SaveTeam(ctx context.Context, team *Team) error {
	if s.saveTeamErr != nil {
		return s.saveTeamErr
	}
	return s.mockStore.SaveTeam(ctx, team)
}

func (s *erroringTeamStore) SaveTasks(ctx context.Context, teamName string, tasks []Task) error {
	if s.saveTasksErr != nil {
		return s.saveTasksErr
	}
	return s.mockStore.SaveTasks(ctx, teamName, tasks)
}

func (s *erroringTeamStore) DeleteTeam(ctx context.Context, name string) error {
	if s.deleteErr != nil {
		return s.deleteErr
	}
	return s.mockStore.DeleteTeam(ctx, name)
}

func (s *erroringTeamStore) ListTeams(ctx context.Context) ([]Team, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	return s.mockStore.ListTeams(ctx)
}

func (s *erroringTeamStore) GetTasks(ctx context.Context, teamName string) ([]Task, error) {
	if s.getTasksErr != nil {
		return nil, s.getTasksErr
	}
	return s.mockStore.GetTasks(ctx, teamName)
}

type failingBus struct {
	publishErr error
}

func (b *failingBus) Publish(ctx context.Context, event string, properties any) error {
	return b.publishErr
}

func (b *failingBus) Subscribe(ctx context.Context, event string, handler func(ctx context.Context, properties map[string]any) error) error {
	return nil
}

type spawnSessions struct {
	mockSessions
	createErr      error
	removeErr      error
	removeCalls    int
	startLoopErr   error
	startLoopPanic bool
	injectErr      error
	updatePermErr  error
	createCount    int
}

func (s *spawnSessions) CreateSession(ctx context.Context, parentID, agentName, title string, permissions []PermissionRule) (string, error) {
	if s.createErr != nil {
		return "", s.createErr
	}
	s.createCount++
	return fmt.Sprintf("spawn-session-%d", s.createCount), nil
}

func (s *spawnSessions) RemoveSession(ctx context.Context, sessionID string) error {
	s.removeCalls++
	return s.removeErr
}

func (s *spawnSessions) InjectMessage(ctx context.Context, sessionID, fromName, text, inboxMessageID string) error {
	if s.injectErr != nil {
		return s.injectErr
	}
	return nil
}

func (s *spawnSessions) UpdatePermissions(ctx context.Context, sessionID string, removePattern string) error {
	return s.updatePermErr
}

func (s *spawnSessions) StartPromptLoop(ctx context.Context, sessionID string) error {
	if s.startLoopPanic {
		panic("prompt loop panic")
	}
	return s.startLoopErr
}

type nilTeamStore struct {
	*mockStore
}

func TestRollbackSpawnedMember(t *testing.T) {
	ctx := context.Background()

	t.Run("joins store lookup and session removal errors", func(t *testing.T) {
		getErr := errors.New("get failed")
		removeErr := errors.New("remove failed")
		store := &failingSaveStore{
			mockStore:  &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
			getTeamErr: getErr,
		}
		sessions := &spawnSessions{removeErr: removeErr}
		svc := NewService(store, nil, sessions, nil, nil)

		err := svc.rollbackSpawnedMember(ctx, "team", "worker", "session")

		if !errors.Is(err, getErr) || !errors.Is(err, removeErr) {
			t.Fatalf("expected joined rollback errors, got %v", err)
		}
	})

	t.Run("propagates member removal save error", func(t *testing.T) {
		saveErr := errors.New("save failed")
		store := &erroringTeamStore{
			mockStore: &mockStore{teams: map[string]*Team{
				"team": {Name: "team", Members: []Member{{Name: "worker", SessionID: "session"}}},
			}, tasks: make(map[string][]Task)},
			saveTeamErr: saveErr,
		}
		sessions := &spawnSessions{}
		svc := NewService(store, nil, sessions, nil, nil)

		err := svc.rollbackSpawnedMember(ctx, "team", "worker", "session")

		if !errors.Is(err, saveErr) {
			t.Fatalf("expected save error, got %v", err)
		}
		if sessions.removeCalls != 1 {
			t.Fatalf("expected session removal, got %d calls", sessions.removeCalls)
		}
	})

	t.Run("leaves a replacement member intact", func(t *testing.T) {
		store := &mockStore{teams: map[string]*Team{
			"team": {Name: "team", Members: []Member{{Name: "worker", SessionID: "replacement"}}},
		}, tasks: make(map[string][]Task)}
		sessions := &spawnSessions{}
		svc := NewService(store, nil, sessions, nil, nil)

		if err := svc.rollbackSpawnedMember(ctx, "team", "worker", "old-session"); err != nil {
			t.Fatalf("rollback replacement member: %v", err)
		}
		if len(store.teams["team"].Members) != 1 {
			t.Fatalf("replacement member should remain")
		}
	})
}

func (s *nilTeamStore) GetTeam(ctx context.Context, name string) (*Team, error) {
	if name == "nil-team" {
		return nil, nil
	}
	return s.mockStore.GetTeam(ctx, name)
}

type failingAutoWakeSessions struct {
	mockSessions
	wakeErr error
}

func (s *failingAutoWakeSessions) AutoWake(ctx context.Context, sessionID string) error {
	return s.wakeErr
}

func agentInboxMessage(from, text string) InboxMessage {
	return InboxMessage{ID: "m1", From: from, Text: text}
}

func TestService_AddMember_DoesNotReadStaleStateWhenConcurrent(t *testing.T) {
	ctx := context.Background()
	store := newAddMemberBlockingStore("race-team")
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})

	errCh := make(chan error, 2)
	go func() {
		errCh <- svc.AddMember(ctx, "race-team", Member{Name: "a", SessionID: "sa"})
	}()

	<-store.firstSaveEntered

	go func() {
		errCh <- svc.AddMember(ctx, "race-team", Member{Name: "b", SessionID: "sb"})
	}()

	select {
	case <-store.secondGetObserved:
		t.Fatal("second AddMember call read team state before first save completed")
	case <-time.After(100 * time.Millisecond):
	}

	close(store.releaseFirstSave)

	if err := <-errCh; err != nil {
		t.Fatalf("first add failed: %v", err)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("second add failed: %v", err)
	}

	team, err := store.GetTeam(ctx, "race-team")
	if err != nil {
		t.Fatalf("failed to get team: %v", err)
	}
	if len(team.Members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(team.Members))
	}
}

func TestService_TransitionMemberStatus_DoesNotLoseConcurrentUpdates(t *testing.T) {
	ctx := context.Background()
	store := newAddMemberBlockingStore("transition-race")
	store.team.Members = []Member{
		{Name: "a", SessionID: "sa", Status: MemberStatusBusy},
		{Name: "b", SessionID: "sb", Status: MemberStatusBusy},
	}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})

	errCh := make(chan error, 2)
	go func() {
		_, err := svc.TransitionMemberStatus(ctx, "transition-race", "a", MemberStatusReady, true)
		errCh <- err
	}()

	<-store.firstSaveEntered

	go func() {
		_, err := svc.TransitionMemberStatus(ctx, "transition-race", "b", MemberStatusReady, true)
		errCh <- err
	}()

	select {
	case <-store.secondGetObserved:
		t.Fatal("second transition read team state before first save completed")
	case <-time.After(100 * time.Millisecond):
	}

	close(store.releaseFirstSave)

	if err := <-errCh; err != nil {
		t.Fatalf("first transition failed: %v", err)
	}
	if err := <-errCh; err != nil {
		t.Fatalf("second transition failed: %v", err)
	}

	team, err := store.GetTeam(ctx, "transition-race")
	if err != nil {
		t.Fatalf("failed to get team: %v", err)
	}
	for _, member := range team.Members {
		if member.Status != MemberStatusReady {
			t.Fatalf("expected all members ready after concurrent transitions, got %#v", team.Members)
		}
	}
}

func TestService_ApprovePlan(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	tmpDir := t.TempDir()
	inbox := newTestTeamInbox(tmpDir)
	svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "plan-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)
	_ = svc.AddMember(ctx, teamName, Member{Name: "worker", SessionID: "ses_w", PlanApproval: PlanApprovalPending})

	if err := svc.ApprovePlan(ctx, teamName, "worker", true, "good plan"); err != nil {
		t.Fatalf("failed to approve plan: %v", err)
	}

	team, _ := svc.Get(ctx, teamName)
	if team.Members[0].PlanApproval != PlanApprovalApproved {
		t.Errorf("expected approved plan, got %v", team.Members[0].PlanApproval)
	}
}

func TestService_CancelAll(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "cancel-all-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)
	_ = svc.AddMember(ctx, teamName, Member{Name: "w1", SessionID: "s1", Status: MemberStatusBusy})
	_ = svc.AddMember(ctx, teamName, Member{Name: "w2", SessionID: "s2", Status: MemberStatusBusy})

	count, err := svc.CancelAll(ctx, teamName)
	if err != nil || count != 2 {
		t.Errorf("CancelAll failed: %v, %d", err, count)
	}
}

func TestService_Cleanup(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	tmpDir := t.TempDir()
	inbox := newTestTeamInbox(tmpDir)
	svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "clean-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)
	_ = svc.AddMember(ctx, teamName, Member{Name: "worker", SessionID: "ses_w", Status: MemberStatusReady})

	// Try cleanup while worker is ready -> should fail
	err := svc.Cleanup(ctx, teamName)
	if err == nil {
		t.Errorf("expected error cleaning up team with non-shutdown member")
	}

	// Shutdown worker
	_, _ = svc.TransitionMemberStatus(ctx, teamName, "worker", MemberStatusShutdown, true)

	// Cleanup should succeed
	err = svc.Cleanup(ctx, teamName)
	if err != nil {
		t.Errorf("failed to clean up team: %v", err)
	}

	// Verify team gone
	_, err = svc.Get(ctx, teamName)
	if err == nil {
		t.Errorf("expected error getting deleted team")
	}
}

func TestService_Create(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})

	ctx := context.Background()
	team, err := svc.Create(ctx, "test-team", "lead-session", false)
	if err != nil {
		t.Fatalf("failed to create team: %v", err)
	}

	if team.Name != "test-team" {
		t.Errorf("expected team name test-team, got %s", team.Name)
	}

	// Try creating same team
	_, err = svc.Create(ctx, "test-team", "lead-session", false)
	if !errors.Is(err, ErrTeamAlreadyExists) {
		t.Errorf("expected ErrTeamAlreadyExists, got %v", err)
	}
}

func TestService_CreatePropagatesLookupError(t *testing.T) {
	store := &failingSaveStore{
		mockStore:  &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
		getTeamErr: errors.New("store unavailable"),
	}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})

	team, err := svc.Create(context.Background(), "new-team", "lead-session", false)
	if err == nil || !strings.Contains(err.Error(), "store unavailable") {
		t.Fatalf("expected store lookup error, got %v", err)
	}
	if team != nil {
		t.Fatalf("expected no team on lookup error, got %#v", team)
	}
}

func TestService_CreateRollsBackTeamWhenTaskInitializationFails(t *testing.T) {
	store := &failingSaveStore{
		mockStore:    &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)},
		saveTasksErr: errors.New("task init failed"),
	}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()

	_, err := svc.Create(ctx, "rollback-team", "lead-session", false)
	if err == nil || !strings.Contains(err.Error(), "task init failed") {
		t.Fatalf("expected task init error, got %v", err)
	}
	if _, ok := store.teams["rollback-team"]; ok {
		t.Fatal("expected rollback to delete team")
	}
}

func TestService_EventHandlers(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	tmpDir := t.TempDir()
	inbox := newTestTeamInbox(tmpDir)
	bus := &mockBus{}
	sessions := &mockSessions{}
	svc := NewService(store, inbox, sessions, &mockModels{}, bus)
	ctx := context.Background()

	svc.Init(ctx)

	// handleMemberStatusChanged
	teamName := "evt-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)
	_ = svc.AddMember(ctx, teamName, Member{Name: "worker", Status: MemberStatusShutdown})

	props := map[string]any{
		"status":   string(MemberStatusShutdown),
		"teamName": teamName,
	}
	_ = svc.handleMemberStatusChanged(ctx, props)

	// handleTeamCleaned
	props2 := map[string]any{
		"delegate":      true,
		"leadSessionID": "lead-ses",
	}
	_ = svc.handleTeamCleaned(ctx, props2)
}

func TestService_FindBySession(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	svc := NewService(store, nil, nil, &mockModels{}, &mockBus{})
	ctx := context.Background()
	_, _ = svc.Create(ctx, "t1", "lead-ses", false)
	_ = svc.AddMember(ctx, "t1", Member{Name: "w1", SessionID: "mem-ses"})

	team, role, _, _ := svc.FindBySession(ctx, "lead-ses")
	if team.Name != "t1" || role != "lead" {
		t.Error("failed to find lead")
	}

	team2, role2, name2, _ := svc.FindBySession(ctx, "mem-ses")
	if team2.Name != "t1" || role2 != "member" || name2 != "w1" {
		t.Error("failed to find member")
	}
}

func TestService_ListTeams(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	_, _ = svc.Create(ctx, "t1", "l1", false)
	_, _ = svc.Create(ctx, "t2", "l2", false)

	list, err := svc.ListTeams(ctx)
	if err != nil {
		t.Fatalf("failed to list teams: %v", err)
	}
	if len(list) != 2 {
		t.Errorf("expected 2 teams, got %d", len(list))
	}
}

func TestService_MarkRead(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	tmpDir := t.TempDir()
	inbox := newTestTeamInbox(tmpDir)
	svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "read-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)
	_ = svc.AddMember(ctx, teamName, Member{Name: "worker", SessionID: "ses_w"})

	_ = svc.Send(ctx, teamName, "lead", "worker", "msg1")
	_ = svc.Send(ctx, teamName, "lead", "worker", "msg2")

	count, err := svc.MarkRead(ctx, teamName, "worker")
	if err != nil || count != 2 {
		t.Errorf("MarkRead failed: %v, %d", err, count)
	}
}

func TestService_Messaging(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	tmpDir := t.TempDir()
	inbox := newTestTeamInbox(tmpDir)
	svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "msg-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)
	_ = svc.AddMember(ctx, teamName, Member{Name: "worker", SessionID: "ses_w"})

	// Send
	if err := svc.Send(ctx, teamName, "lead", "worker", "hello"); err != nil {
		t.Errorf("failed to send message: %v", err)
	}

	// Verify in inbox
	msgs, _ := inbox.ReadAll(teamName, "worker")
	if len(msgs) != 1 {
		t.Errorf("expected 1 message in inbox, got %d", len(msgs))
	}

	// Broadcast
	if err := svc.Broadcast(ctx, teamName, "lead", "all hands"); err != nil {
		t.Errorf("failed to broadcast: %v", err)
	}

	// worker should have 2 messages now
	msgs2, _ := inbox.ReadAll(teamName, "worker")
	if len(msgs2) != 2 {
		t.Errorf("expected 2 messages in worker inbox, got %d", len(msgs2))
	}
}

func TestService_Messaging_Extra(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "msg-extra"
	_, _ = svc.Create(ctx, teamName, "lead", false)

	// validateText too large
	bigText := strings.Repeat("A", MaxMessageTextBytes+1)
	if err := svc.Send(ctx, teamName, "lead", "worker", bigText); err == nil {
		t.Error("expected error for too large message")
	}

	// Send to non-existent
	if err := svc.Send(ctx, teamName, "lead", "ghost", "hi"); err == nil {
		t.Error("expected error sending to ghost")
	}

	// Broadcast while team not found
	svc2 := NewService(&mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}, nil, nil, &mockModels{}, &mockBus{})
	if err := svc2.Broadcast(ctx, "ghost", "lead", "hi"); err == nil {
		t.Error("expected error broadcasting to ghost team")
	}
}

func TestService_Recover(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	tmpDir := t.TempDir()
	inbox := newTestTeamInbox(tmpDir)
	svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "rec-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)
	_ = svc.AddMember(ctx, teamName, Member{Name: "w1", SessionID: "s1", Status: MemberStatusBusy})

	count, err := svc.Recover(ctx)
	if err != nil || count != 1 {
		t.Errorf("Recover failed: %v, %d", err, count)
	}

	team, _ := svc.Get(ctx, teamName)
	if team.Members[0].Status != MemberStatusReady {
		t.Errorf("expected member status ready after recovery, got %v", team.Members[0].Status)
	}
}

func TestService_RecoverInbox_Extra(t *testing.T) {
	tmpDir := t.TempDir()
	inbox := newTestTeamInbox(tmpDir)
	svc := NewService(nil, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()

	_ = inbox.Write("t", "a", InboxMessage{ID: "1", From: "f", Text: "hi"})

	count, err := svc.RecoverInbox(ctx, "t", "a", "s1")
	if err != nil || count != 1 {
		t.Errorf("RecoverInbox failed: %v, %d", err, count)
	}
}

func TestService_ResolveModel(t *testing.T) {
	models := &mockModels{defaultModel: ModelInfo{ProviderID: "def", ModelID: "mod"}}
	sessions := &mockSessions{}
	svc := NewService(nil, nil, sessions, models, &mockBus{})
	ctx := context.Background()

	// Explicit
	res, _ := svc.ResolveModel(ctx, "p/m", nil, "")
	if res.ProviderID != "p" {
		t.Errorf("expected p, got %s", res.ProviderID)
	}

	// Agent model
	agentModel := &ModelInfo{ProviderID: "agent-p", ModelID: "agent-m"}
	res2, _ := svc.ResolveModel(ctx, "", agentModel, "")
	if res2.ProviderID != "agent-p" {
		t.Errorf("expected agent-p, got %s", res2.ProviderID)
	}

	// Default
	res3, _ := svc.ResolveModel(ctx, "", nil, "")
	if res3.ProviderID != "def" {
		t.Errorf("expected def, got %s", res3.ProviderID)
	}
}

func TestService_ResolveModel_Error(t *testing.T) {
	models := &mockModels{}
	svc := NewService(nil, nil, nil, models, &mockBus{})
	ctx := context.Background()

	// Model not found
	_, err := svc.ResolveModel(ctx, "invalid", nil, "")
	if err == nil {
		t.Error("expected error for invalid model")
	}
}

func TestService_SetDelegate(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	svc := NewService(store, nil, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "del-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)

	if err := svc.SetDelegate(ctx, teamName, true); err != nil {
		t.Fatalf("failed to set delegate: %v", err)
	}

	team, _ := svc.Get(ctx, teamName)
	if !team.Delegate {
		t.Errorf("expected delegate to be true")
	}
}

func TestService_SpawnMember(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	tmpDir := t.TempDir()
	inbox := newTestTeamInbox(tmpDir)
	svc := NewService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "spawn-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)

	input := SpawnInput{
		TeamName:        teamName,
		Name:            "worker",
		ParentSessionID: "lead-ses",
		Prompt:          "work",
	}
	input.Model.ProviderID = "p"
	input.Model.ModelID = "m"

	sessionID, label, err := svc.SpawnMember(ctx, input)
	if err != nil {
		t.Fatalf("failed to spawn member: %v", err)
	}
	if sessionID != "ses_child" || label != "p/m" {
		t.Errorf("wrong spawn result: %s, %s", sessionID, label)
	}
}

func TestService_SpawnMemberPlanApprovalSkillsAndClaim(t *testing.T) {
	store := &mockStore{teams: make(map[string]*Team), tasks: make(map[string][]Task)}
	sessions := &countingSessions{}
	svc := NewService(store, newTestTeamInbox(t.TempDir()), sessions, &mockModels{}, &mockBus{})
	ctx := context.Background()
	teamName := "spawn-plan-team"
	_, _ = svc.Create(ctx, teamName, "lead", false)
	if err := svc.AddTasks(ctx, teamName, []Task{{ID: "task-1", Content: "work", Status: TaskStatusPending}}); err != nil {
		t.Fatalf("add task: %v", err)
	}

	input := SpawnInput{
		TeamName:        teamName,
		Name:            "planner",
		ParentSessionID: "lead-ses",
		Prompt:          "make a plan",
		ClaimTask:       "task-1",
		PlanApproval:    true,
	}
	input.Agent.Name = "coding-agent"
	input.Agent.Skills = []string{"go", "testing"}
	input.Model.ProviderID = "p"
	input.Model.ModelID = "m"

	sessionID, label, err := svc.SpawnMember(ctx, input)
	if err != nil {
		t.Fatalf("failed to spawn plan member: %v", err)
	}
	svc.runWG.Wait()
	if sessionID != "ses_child" || label != "p/m" {
		t.Fatalf("wrong spawn result: %s, %s", sessionID, label)
	}
	team, err := svc.Get(ctx, teamName)
	if err != nil {
		t.Fatalf("get team: %v", err)
	}
	if len(team.Members) != 1 || team.Members[0].PlanApproval != PlanApprovalPending {
		t.Fatalf("expected pending plan approval member, got %#v", team.Members)
	}
	tasks, err := svc.ListTasks(ctx, teamName)
	if err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	if tasks[0].Status != TaskStatusInProgress || tasks[0].Assignee != "planner" {
		t.Fatalf("expected claimed task, got %#v", tasks[0])
	}
	if len(sessions.injected) == 0 || !strings.Contains(sessions.injected[0], "Preloaded skills") {
		t.Fatalf("expected injected context with skills, got %#v", sessions.injected)
	}
}
