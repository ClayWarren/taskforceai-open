package orchestrator

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
)

type additionalBus struct {
	subscribeCalls []string
	subscribeErrs  map[string]error
}

func (b *additionalBus) Publish(ctx context.Context, event string, properties any) error {
	return nil
}

func (b *additionalBus) Subscribe(ctx context.Context, event string, handler func(ctx context.Context, properties map[string]any) error) error {
	b.subscribeCalls = append(b.subscribeCalls, event)
	if b.subscribeErrs == nil {
		return nil
	}
	return b.subscribeErrs[event]
}

type additionalSessions struct {
	mockSessions
	restoreCalls     int
	lastRestoreID    string
	lastRestoreTools []string
	restoreErr       error
	cancelErrs       map[string]error
	injectErrs       map[string]error
	autoWakeErrs     map[string]error
	lastModel        *ModelInfo
	lastModelErr     error
}

func (s *additionalSessions) RestoreLeadPermissions(ctx context.Context, sessionID string, writeTools []string) error {
	s.restoreCalls++
	s.lastRestoreID = sessionID
	s.lastRestoreTools = append([]string(nil), writeTools...)
	return s.restoreErr
}

func (s *additionalSessions) CancelPrompt(ctx context.Context, sessionID string) error {
	if s.cancelErrs != nil {
		if err, ok := s.cancelErrs[sessionID]; ok {
			return err
		}
	}
	return nil
}

func (s *additionalSessions) InjectMessage(ctx context.Context, sessionID, fromName, text, inboxMessageID string) error {
	if s.injectErrs != nil {
		if err, ok := s.injectErrs[sessionID]; ok {
			return err
		}
	}
	return nil
}

func (s *additionalSessions) AutoWake(ctx context.Context, sessionID string) error {
	if s.autoWakeErrs != nil {
		if err, ok := s.autoWakeErrs[sessionID]; ok {
			return err
		}
	}
	return nil
}

func (s *additionalSessions) GetLastUserMessageModel(ctx context.Context, sessionID string) (*ModelInfo, error) {
	if s.lastModelErr != nil {
		return nil, s.lastModelErr
	}
	return s.lastModel, nil
}

type additionalModels struct {
	parseOut   ModelInfo
	parseErr   error
	getErr     error
	defaultOut ModelInfo
	defaultErr error
}

func (m *additionalModels) ParseModel(model string) (ModelInfo, error) {
	if m.parseErr != nil {
		return ModelInfo{}, m.parseErr
	}
	if m.parseOut != (ModelInfo{}) {
		return m.parseOut, nil
	}
	return ModelInfo{ProviderID: "p", ModelID: model}, nil
}

func (m *additionalModels) GetModel(ctx context.Context, providerID, modelID string) (any, error) {
	if m.getErr != nil {
		return nil, m.getErr
	}
	return struct{}{}, nil
}

func (m *additionalModels) DefaultModel(ctx context.Context) (ModelInfo, error) {
	if m.defaultErr != nil {
		return ModelInfo{}, m.defaultErr
	}
	if m.defaultOut != (ModelInfo{}) {
		return m.defaultOut, nil
	}
	return ModelInfo{ProviderID: "def", ModelID: "default-model"}, nil
}

func TestTeamService_InitAndMemberStatusHandlerBranches(t *testing.T) {
	t.Run("init subscribes all handlers even when subscribe errors occur", func(t *testing.T) {
		bus := &additionalBus{
			subscribeErrs: map[string]error{
				"team.member.status": errors.New("member subscribe failed"),
				"team.cleaned":       errors.New("clean subscribe failed"),
			},
		}
		svc := NewTeamService(&mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, bus)

		svc.Init(context.Background())

		if len(bus.subscribeCalls) != 2 {
			t.Fatalf("expected 2 subscribe calls, got %d", len(bus.subscribeCalls))
		}
		if bus.subscribeCalls[0] != "team.member.status" || bus.subscribeCalls[1] != "team.cleaned" {
			t.Fatalf("unexpected subscribe order: %+v", bus.subscribeCalls)
		}
	})

	t.Run("handleMemberStatusChanged validates payload and cleans only fully-shutdown teams", func(t *testing.T) {
		ctx := context.Background()
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewTeamService(store, inbox, &mockSessions{}, &mockModels{}, &mockBus{})

		if err := svc.handleMemberStatusChanged(ctx, map[string]any{}); err == nil {
			t.Fatal("expected missing status error")
		}

		if err := svc.handleMemberStatusChanged(ctx, map[string]any{"status": string(MemberStatusReady)}); err != nil {
			t.Fatalf("non-shutdown event should be ignored, got %v", err)
		}

		if err := svc.handleMemberStatusChanged(ctx, map[string]any{"status": string(MemberStatusShutdown)}); err == nil {
			t.Fatal("expected missing teamName error")
		}

		if err := svc.handleMemberStatusChanged(ctx, map[string]any{
			"status":   string(MemberStatusShutdown),
			"teamName": "missing-team",
		}); err == nil {
			t.Fatal("expected missing team error")
		}

		if _, err := svc.Create(ctx, "empty-team", "lead", false); err != nil {
			t.Fatalf("create empty-team: %v", err)
		}
		if err := svc.handleMemberStatusChanged(ctx, map[string]any{
			"status":   string(MemberStatusShutdown),
			"teamName": "empty-team",
		}); err != nil {
			t.Fatalf("empty team should be ignored, got %v", err)
		}

		if _, err := svc.Create(ctx, "mixed-team", "lead", false); err != nil {
			t.Fatalf("create mixed-team: %v", err)
		}
		if err := svc.AddMember(ctx, "mixed-team", TeamMember{Name: "w1", SessionID: "s1", Status: MemberStatusShutdown}); err != nil {
			t.Fatalf("add member: %v", err)
		}
		if err := svc.AddMember(ctx, "mixed-team", TeamMember{Name: "w2", SessionID: "s2", Status: MemberStatusReady}); err != nil {
			t.Fatalf("add member: %v", err)
		}
		if err := svc.handleMemberStatusChanged(ctx, map[string]any{
			"status":   string(MemberStatusShutdown),
			"teamName": "mixed-team",
		}); err != nil {
			t.Fatalf("mixed team should not cleanup, got %v", err)
		}
		if _, err := svc.Get(ctx, "mixed-team"); err != nil {
			t.Fatalf("mixed-team should still exist, got %v", err)
		}

		if _, err := svc.Create(ctx, "done-team", "lead", false); err != nil {
			t.Fatalf("create done-team: %v", err)
		}
		if err := svc.AddMember(ctx, "done-team", TeamMember{Name: "a", SessionID: "sa", Status: MemberStatusShutdown}); err != nil {
			t.Fatalf("add member: %v", err)
		}
		if err := svc.AddMember(ctx, "done-team", TeamMember{Name: "b", SessionID: "sb", Status: MemberStatusShutdown}); err != nil {
			t.Fatalf("add member: %v", err)
		}
		if err := svc.handleMemberStatusChanged(ctx, map[string]any{
			"status":   string(MemberStatusShutdown),
			"teamName": "done-team",
		}); err != nil {
			t.Fatalf("expected cleanup success, got %v", err)
		}
		if _, err := svc.Get(ctx, "done-team"); err == nil {
			t.Fatal("expected done-team to be deleted by cleanup")
		}
	})
}

func TestTeamService_HandleTeamCleanedBranches(t *testing.T) {
	ctx := context.Background()
	sessions := &additionalSessions{}
	svc := NewTeamService(&mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}, newTestTeamInbox(t.TempDir()), sessions, &mockModels{}, &mockBus{})

	if err := svc.handleTeamCleaned(ctx, map[string]any{}); err == nil {
		t.Fatal("expected missing delegate error")
	}

	if err := svc.handleTeamCleaned(ctx, map[string]any{"delegate": false}); err != nil {
		t.Fatalf("delegate=false should no-op, got %v", err)
	}
	if sessions.restoreCalls != 0 {
		t.Fatalf("restore should not be called when delegate=false, got %d", sessions.restoreCalls)
	}

	if err := svc.handleTeamCleaned(ctx, map[string]any{"delegate": true}); err == nil {
		t.Fatal("expected missing leadSessionID error")
	}

	sessions.restoreErr = errors.New("restore failed")
	err := svc.handleTeamCleaned(ctx, map[string]any{"delegate": true, "leadSessionID": "lead-ses"})
	if err == nil || !strings.Contains(err.Error(), "restore failed") {
		t.Fatalf("expected restore failure, got %v", err)
	}

	sessions.restoreErr = nil
	if err := svc.handleTeamCleaned(ctx, map[string]any{"delegate": true, "leadSessionID": "lead-ok"}); err != nil {
		t.Fatalf("expected restore success, got %v", err)
	}
	if sessions.lastRestoreID != "lead-ok" {
		t.Fatalf("unexpected restore session id: %q", sessions.lastRestoreID)
	}
	if len(sessions.lastRestoreTools) != len(WRITE_TOOLS) {
		t.Fatalf("expected %d write tools, got %d", len(WRITE_TOOLS), len(sessions.lastRestoreTools))
	}
}

func TestTeamService_AddAndTransitionEdgeBranches(t *testing.T) {
	ctx := context.Background()
	store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
	svc := NewTeamService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})

	if _, err := svc.Create(ctx, "edge-team", "lead", false); err != nil {
		t.Fatalf("create team: %v", err)
	}
	if err := svc.AddMember(ctx, "edge-team", TeamMember{Name: "worker", SessionID: "s1", Status: MemberStatusReady}); err != nil {
		t.Fatalf("add member: %v", err)
	}

	if err := svc.AddMember(ctx, "edge-team", TeamMember{Name: "lead", SessionID: "s2"}); err == nil {
		t.Fatal("expected reserved-name add member error")
	}
	if err := svc.AddMember(ctx, "edge-team", TeamMember{Name: "Lead", SessionID: "s2"}); err == nil {
		t.Fatal("expected case-insensitive reserved-name add member error")
	}
	if err := svc.AddMember(ctx, "edge-team", TeamMember{Name: "worker", SessionID: "s3"}); err == nil {
		t.Fatal("expected duplicate-name add member error")
	}
	if err := svc.AddMember(ctx, "edge-team", TeamMember{Name: "worker-2", SessionID: "s1"}); err == nil {
		t.Fatal("expected duplicate-session add member error")
	}

	maxMembers := make([]TeamMember, MaxTeamMembers)
	for i := range maxMembers {
		maxMembers[i] = TeamMember{Name: "m" + string(rune('a'+(i%26))) + string(rune('A'+(i/26))), SessionID: "x" + string(rune('a'+(i%26))) + string(rune('A'+(i/26)))}
	}
	store.teams["max-team"] = &TeamInfo{Name: "max-team", LeadSessionID: "lead", Members: maxMembers}
	if err := svc.AddMember(ctx, "max-team", TeamMember{Name: "overflow", SessionID: "overflow"}); err == nil {
		t.Fatal("expected max-team add member error")
	}

	changed, err := svc.TransitionMemberStatus(ctx, "edge-team", "worker", MemberStatusReady, false)
	if err != nil {
		t.Fatalf("same-status transition should not error, got %v", err)
	}
	if changed {
		t.Fatal("expected no-op for same member status transition")
	}

	if _, err := svc.TransitionMemberStatus(ctx, "edge-team", "missing", MemberStatusBusy, false); !errors.Is(err, ErrMemberNotFound) {
		t.Fatalf("expected ErrMemberNotFound, got %v", err)
	}

	store.teams["exec-busy"] = &TeamInfo{
		Name:          "exec-busy",
		LeadSessionID: "lead",
		Members:       []TeamMember{{Name: "w", SessionID: "sw", Status: MemberStatusBusy}},
	}
	ok, err := svc.TransitionExecutionStatus(ctx, "exec-busy", "w", ExecutionStatusCancelRequested, false)
	if err != nil || !ok {
		t.Fatalf("expected derived running->cancel_requested transition success, got %v, %v", ok, err)
	}

	store.teams["exec-ready"] = &TeamInfo{
		Name:          "exec-ready",
		LeadSessionID: "lead",
		Members:       []TeamMember{{Name: "w", SessionID: "sw2", Status: MemberStatusReady}},
	}
	ok, err = svc.TransitionExecutionStatus(ctx, "exec-ready", "w", ExecutionStatusIdle, false)
	if err != nil {
		t.Fatalf("same derived status should not error, got %v", err)
	}
	if ok {
		t.Fatal("expected no-op when derived execution status already matches")
	}
	if _, err = svc.TransitionExecutionStatus(ctx, "exec-ready", "w", ExecutionStatusCompleted, false); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("expected ErrInvalidTransition, got %v", err)
	}
}

func TestTeamService_CancelAndResolveModelBranches(t *testing.T) {
	t.Run("cancel member guard branches", func(t *testing.T) {
		ctx := context.Background()
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		sessions := &additionalSessions{
			cancelErrs: map[string]error{"err-session": errors.New("cancel failed")},
		}
		svc := NewTeamService(store, newTestTeamInbox(t.TempDir()), sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "cancel-team", "lead", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		_ = svc.AddMember(ctx, "cancel-team", TeamMember{Name: "idle", SessionID: "idle-session", Status: MemberStatusReady, ExecutionStatus: ExecutionStatusIdle})
		_ = svc.AddMember(ctx, "cancel-team", TeamMember{Name: "terminal", SessionID: "terminal-session", Status: MemberStatusBusy, ExecutionStatus: ExecutionStatusCompleted})
		_ = svc.AddMember(ctx, "cancel-team", TeamMember{Name: "err", SessionID: "err-session", Status: MemberStatusBusy, ExecutionStatus: ExecutionStatusRunning})
		_ = svc.AddMember(ctx, "cancel-team", TeamMember{Name: "ok", SessionID: "ok-session", Status: MemberStatusBusy, ExecutionStatus: ExecutionStatusRunning})

		cancelled, err := svc.CancelMember(ctx, "cancel-team", "idle")
		if err != nil || cancelled {
			t.Fatalf("idle member should be ignored, got cancelled=%v err=%v", cancelled, err)
		}

		cancelled, err = svc.CancelMember(ctx, "cancel-team", "terminal")
		if err != nil || cancelled {
			t.Fatalf("terminal execution member should be ignored, got cancelled=%v err=%v", cancelled, err)
		}

		cancelled, err = svc.CancelMember(ctx, "cancel-team", "err")
		if err == nil || cancelled {
			t.Fatalf("expected cancel prompt error, got cancelled=%v err=%v", cancelled, err)
		}

		count, err := svc.CancelAll(ctx, "cancel-team")
		if err != nil {
			t.Fatalf("CancelAll should continue over member errors, got %v", err)
		}
		if count != 1 {
			t.Fatalf("expected one successful cancellation, got %d", count)
		}
	})

	t.Run("resolve model precedence and fallback branches", func(t *testing.T) {
		ctx := context.Background()
		sessions := &additionalSessions{}
		models := &additionalModels{
			parseOut:   ModelInfo{ProviderID: "p", ModelID: "m"},
			defaultOut: ModelInfo{ProviderID: "def", ModelID: "default"},
		}
		svc := NewTeamService(nil, nil, sessions, models, &mockBus{})

		models.parseErr = errors.New("parse failed")
		if _, err := svc.ResolveModel(ctx, "bad-model", nil, "s1"); err == nil {
			t.Fatal("expected parse error from explicit model")
		}

		models.parseErr = nil
		models.getErr = errors.New("not found")
		if _, err := svc.ResolveModel(ctx, "p/missing", nil, "s1"); err == nil || !strings.Contains(err.Error(), "model not found") {
			t.Fatalf("expected model-not-found error, got %v", err)
		}

		models.getErr = nil
		agentModel := &ModelInfo{ProviderID: "agent-provider", ModelID: "agent-model"}
		resolved, err := svc.ResolveModel(ctx, "", agentModel, "s1")
		if err != nil {
			t.Fatalf("agent model precedence failed: %v", err)
		}
		if resolved != *agentModel {
			t.Fatalf("expected agent model precedence, got %+v", resolved)
		}

		sessions.lastModel = &ModelInfo{ProviderID: "session-provider", ModelID: "session-model"}
		resolved, err = svc.ResolveModel(ctx, "", nil, "s2")
		if err != nil {
			t.Fatalf("session model fallback failed: %v", err)
		}
		if resolved.ModelID != "session-model" {
			t.Fatalf("expected session model fallback, got %+v", resolved)
		}

		sessions.lastModel = nil
		sessions.lastModelErr = errors.New("session lookup failed")
		resolved, err = svc.ResolveModel(ctx, "", nil, "s3")
		if err != nil {
			t.Fatalf("default model fallback failed: %v", err)
		}
		if resolved.ModelID != "default" {
			t.Fatalf("expected default model, got %+v", resolved)
		}
	})
}

func TestTeamService_SendBroadcastAndRecoverInboxBranches(t *testing.T) {
	t.Run("send surfaces inject and autowake failures", func(t *testing.T) {
		ctx := context.Background()
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		sessions := &additionalSessions{
			injectErrs:   map[string]error{"worker-ses": errors.New("inject failed")},
			autoWakeErrs: map[string]error{"lead-ses": errors.New("wake failed")},
		}
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewTeamService(store, inbox, sessions, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "msg-team", "lead-ses", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		if err := svc.AddMember(ctx, "msg-team", TeamMember{Name: "worker", SessionID: "worker-ses", Status: MemberStatusReady}); err != nil {
			t.Fatalf("add worker: %v", err)
		}
		if err := svc.AddMember(ctx, "msg-team", TeamMember{Name: "retired", SessionID: "retired-ses", Status: MemberStatusShutdown}); err != nil {
			t.Fatalf("add retired: %v", err)
		}

		big := strings.Repeat("x", MAX_TEXT+1)
		if err := svc.Send(ctx, "msg-team", "lead", "worker", big); err == nil {
			t.Fatal("expected oversize text validation error")
		}

		if err := svc.Send(ctx, "msg-team", "lead", "retired", "ping"); err == nil {
			t.Fatal("expected shutdown-target send error")
		}

		if err := svc.Send(ctx, "msg-team", "lead", "worker", "hello"); err == nil || !strings.Contains(err.Error(), "inject failed") {
			t.Fatalf("expected inject error, got %v", err)
		}

		delete(sessions.injectErrs, "worker-ses")
		if err := svc.Send(ctx, "msg-team", "worker", "lead", "to lead"); err == nil || !strings.Contains(err.Error(), "wake failed") {
			t.Fatalf("expected wake failure for lead session, got %v", err)
		}
	})

	t.Run("broadcast from member includes lead and skips shutdown members", func(t *testing.T) {
		ctx := context.Background()
		store := &mockStore{teams: make(map[string]*TeamInfo), tasks: make(map[string][]TeamTask)}
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewTeamService(store, inbox, &additionalSessions{}, &mockModels{}, &mockBus{})
		if _, err := svc.Create(ctx, "broadcast-team", "lead-ses", false); err != nil {
			t.Fatalf("create team: %v", err)
		}
		_ = svc.AddMember(ctx, "broadcast-team", TeamMember{Name: "sender", SessionID: "sender-ses", Status: MemberStatusReady})
		_ = svc.AddMember(ctx, "broadcast-team", TeamMember{Name: "active", SessionID: "active-ses", Status: MemberStatusReady})
		_ = svc.AddMember(ctx, "broadcast-team", TeamMember{Name: "off", SessionID: "off-ses", Status: MemberStatusShutdown})

		if err := svc.Broadcast(ctx, "broadcast-team", "sender", "status update"); err != nil {
			t.Fatalf("broadcast failed: %v", err)
		}

		leadMsgs, err := inbox.ReadAll("broadcast-team", "lead")
		if err != nil {
			t.Fatalf("read lead inbox: %v", err)
		}
		if len(leadMsgs) != 1 {
			t.Fatalf("expected lead to receive one message, got %d", len(leadMsgs))
		}

		activeMsgs, err := inbox.ReadAll("broadcast-team", "active")
		if err != nil {
			t.Fatalf("read active inbox: %v", err)
		}
		if len(activeMsgs) != 1 {
			t.Fatalf("expected active member to receive one message, got %d", len(activeMsgs))
		}
		if leadMsgs[0].ID == activeMsgs[0].ID {
			t.Fatalf("expected broadcast inbox IDs to be unique, got %q", leadMsgs[0].ID)
		}

		offMsgs, err := inbox.ReadAll("broadcast-team", "off")
		if err != nil {
			t.Fatalf("read shutdown inbox: %v", err)
		}
		if len(offMsgs) != 0 {
			t.Fatalf("expected shutdown member to receive no messages, got %d", len(offMsgs))
		}
	})

	t.Run("recover inbox counts only successful reinjections", func(t *testing.T) {
		ctx := context.Background()
		sessions := &additionalSessions{
			injectErrs: map[string]error{"target-ses": errors.New("inject failed")},
		}
		inbox := newTestTeamInbox(t.TempDir())
		svc := NewTeamService(nil, inbox, sessions, &mockModels{}, &mockBus{})

		if count, err := svc.RecoverInbox(ctx, "t", "missing", "target-ses"); err != nil || count != 0 {
			t.Fatalf("expected empty recovery count, got count=%d err=%v", count, err)
		}

		_ = inbox.Write("t", "agent", agent.InboxMessage{ID: "m1", From: "lead", Text: "one"})
		_ = inbox.Write("t", "agent", agent.InboxMessage{ID: "m2", From: "lead", Text: "two"})

		count, err := svc.RecoverInbox(ctx, "t", "agent", "target-ses")
		if err != nil {
			t.Fatalf("recover inbox failed: %v", err)
		}
		if count != 0 {
			t.Fatalf("expected 0 successful reinjections with forced inject error, got %d", count)
		}

		sessions.injectErrs = nil
		count, err = svc.RecoverInbox(ctx, "t", "agent", "target-ses")
		if err != nil {
			t.Fatalf("recover inbox failed after clearing errors: %v", err)
		}
		if count != 2 {
			t.Fatalf("expected 2 successful reinjections, got %d", count)
		}
	})
}
