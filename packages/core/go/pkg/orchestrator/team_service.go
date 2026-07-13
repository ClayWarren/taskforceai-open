package orchestrator

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
)

var WRITE_TOOLS = []string{"bash", "write", "edit", "multiedit", "apply_patch"}

// MaxTeamMembers is the upper bound on how many members a single team can have.
const MaxTeamMembers = 50

// MaxInboxMessages is the upper bound on messages stored per inbox file.
const MaxInboxMessages = 1000

type Store interface {
	GetTeam(ctx context.Context, name string) (*TeamInfo, error)
	SaveTeam(ctx context.Context, team *TeamInfo) error
	ListTeams(ctx context.Context) ([]TeamInfo, error)
	GetTasks(ctx context.Context, teamName string) ([]TeamTask, error)
	SaveTasks(ctx context.Context, teamName string, tasks []TeamTask) error
	DeleteTeam(ctx context.Context, name string) error
	FindBySession(ctx context.Context, sessionID string) (*TeamInfo, string, string, error) // team, role, memberName
}

type ModelInfo struct {
	ProviderID string `json:"providerID"`
	ModelID    string `json:"modelID"`
}

type ModelProvider interface {
	ParseModel(model string) (ModelInfo, error)
	GetModel(ctx context.Context, providerID, modelID string) (any, error)
	DefaultModel(ctx context.Context) (ModelInfo, error)
}

type SessionManager interface {
	InjectMessage(ctx context.Context, sessionID, fromName, text, inboxMessageID string) error
	AutoWake(ctx context.Context, sessionID string) error
	GetSessionInfo(ctx context.Context, sessionID string) (agentName string, modelProvider string, modelID string, err error)
	UpdatePermissions(ctx context.Context, sessionID string, removePattern string) error
	RestoreLeadPermissions(ctx context.Context, sessionID string, writeTools []string) error
	CancelPrompt(ctx context.Context, sessionID string) error
	RemoveSession(ctx context.Context, sessionID string) error
	CreateSession(ctx context.Context, parentID, agentName, title string, permissions []PermissionRule) (string, error)
	StartPromptLoop(ctx context.Context, sessionID string) error
	GetLastUserMessageModel(ctx context.Context, sessionID string) (*ModelInfo, error)
}

type Bus interface {
	Publish(ctx context.Context, event string, properties any) error
	Subscribe(ctx context.Context, event string, handler func(ctx context.Context, properties map[string]any) error) error
}

type TeamInboxStore interface {
	Write(teamName, to string, msg agent.InboxMessage) error
	ReadAll(teamName, agentName string) ([]agent.InboxMessage, error)
	Unread(teamName, agentName string) ([]agent.InboxMessage, error)
	MarkRead(teamName, agentName string) ([]agent.InboxMessage, error)
	Remove(teamName, agentName string) error
}

type PermissionRule struct {
	Permission string `json:"permission"`
	Pattern    string `json:"pattern"`
	Action     string `json:"action"` // "allow" or "deny"
}

type SpawnInput struct {
	TeamName        string
	Name            string
	ParentSessionID string
	Agent           struct {
		Name   string
		Prompt string
		Skills []string
	}
	Model struct {
		ProviderID string
		ModelID    string
	}
	Prompt       string
	ClaimTask    string
	PlanApproval bool
}

type TeamService struct {
	store    Store
	inbox    TeamInboxStore
	sessions SessionManager
	models   ModelProvider
	bus      Bus
	budget   *BudgetManager
	mu       sync.Mutex // For team creation lock equivalent
	runWG    sync.WaitGroup
}

func NewTeamService(store Store, inbox TeamInboxStore, sessions SessionManager, models ModelProvider, bus Bus) *TeamService {
	return &TeamService{
		store:    store,
		inbox:    inbox,
		sessions: sessions,
		models:   models,
		bus:      bus,
	}
}

// SetBudget sets the budget manager for pre-spawn budget checks.
func (s *TeamService) SetBudget(b *BudgetManager) {
	s.budget = b
}

func (s *TeamService) TransitionMemberStatus(ctx context.Context, teamName, memberName string, status MemberStatus, force bool) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	team, err := s.store.GetTeam(ctx, teamName)
	if err != nil {
		return false, err
	}

	idx := memberIndex(team.Members, memberName)
	if idx == -1 {
		return false, ErrMemberNotFound
	}

	m := team.Members[idx]
	if !force && !CanTransitionMember(m.Status, status) {
		return false, ErrInvalidTransition
	}
	if m.Status == status {
		return false, nil
	}

	team.Members[idx].Status = status
	if err := s.store.SaveTeam(ctx, team); err != nil {
		return false, err
	}

	return true, nil
}

func (s *TeamService) TransitionExecutionStatus(ctx context.Context, teamName, memberName string, status ExecutionStatus, force bool) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	team, err := s.store.GetTeam(ctx, teamName)
	if err != nil {
		return false, err
	}

	idx := memberIndex(team.Members, memberName)
	if idx == -1 {
		return false, ErrMemberNotFound
	}

	m := team.Members[idx]
	from := m.ExecutionStatus
	if from == "" {
		if m.Status == MemberStatusBusy {
			from = ExecutionStatusRunning
		} else {
			from = ExecutionStatusIdle
		}
	}

	if !force && !CanTransitionExecution(from, status) {
		return false, ErrInvalidTransition
	}
	if from == status {
		return false, nil
	}

	team.Members[idx].ExecutionStatus = status
	if err := s.store.SaveTeam(ctx, team); err != nil {
		return false, err
	}

	return true, nil
}

func (s *TeamService) warnTransitionExecution(ctx context.Context, teamName, memberName string, status ExecutionStatus, force bool, message string) {
	if _, err := s.TransitionExecutionStatus(ctx, teamName, memberName, status, force); err != nil {
		slog.Warn(message, "teamName", teamName, "memberName", memberName, "error", err)
	}
}

func (s *TeamService) warnForceTransitionMember(ctx context.Context, teamName, memberName string, status MemberStatus, message string) {
	if _, err := s.TransitionMemberStatus(ctx, teamName, memberName, status, true); err != nil {
		slog.Warn(message, "teamName", teamName, "memberName", memberName, "error", err)
	}
}

func (s *TeamService) CancelMember(ctx context.Context, teamName, memberName string) (bool, error) {
	s.mu.Lock()
	team, err := s.store.GetTeam(ctx, teamName)
	if err != nil {
		s.mu.Unlock()
		return false, err
	}

	member := findMember(team.Members, memberName)
	if member == nil {
		s.mu.Unlock()
		return false, ErrMemberNotFound
	}

	if member.Status != MemberStatusBusy && member.Status != MemberStatusShutdownRequested {
		s.mu.Unlock()
		return false, nil
	}

	if IsTerminalExecutionState(member.ExecutionStatus) {
		s.mu.Unlock()
		return false, nil
	}
	s.mu.Unlock()

	s.warnTransitionExecution(ctx, teamName, memberName, ExecutionStatusCancelRequested, false, "Failed to mark cancel requested")

	if err := s.sessions.CancelPrompt(ctx, member.SessionID); err != nil {
		return false, err
	}

	s.warnTransitionExecution(ctx, teamName, memberName, ExecutionStatusCancelling, false, "Failed to mark member cancelling")

	return true, nil
}

func (s *TeamService) CancelAll(ctx context.Context, teamName string) (int, error) {
	team, err := s.Get(ctx, teamName)
	if err != nil {
		return 0, err
	}

	count := 0
	for _, m := range team.Members {
		if m.Status == MemberStatusBusy && !IsTerminalExecutionState(m.ExecutionStatus) {
			cancelled, cancelErr := s.CancelMember(ctx, teamName, m.Name)
			if cancelErr != nil {
				slog.Warn("Failed to cancel member", "teamName", teamName, "memberName", m.Name, "error", cancelErr)
				continue
			}
			if cancelled {
				count++
			}
		}
	}
	return count, nil
}

func (s *TeamService) ResolveModel(ctx context.Context, explicitModel string, agentModel *ModelInfo, sessionID string) (ModelInfo, error) {
	if explicitModel != "" {
		parsed, err := s.models.ParseModel(explicitModel)
		if err != nil {
			return ModelInfo{}, err
		}
		_, err = s.models.GetModel(ctx, parsed.ProviderID, parsed.ModelID)
		if err != nil {
			return ModelInfo{}, fmt.Errorf("model not found: %s", explicitModel)
		}
		return parsed, nil
	}

	if agentModel != nil {
		return *agentModel, nil
	}

	lastModel, err := s.sessions.GetLastUserMessageModel(ctx, sessionID)
	if err == nil && lastModel != nil {
		return *lastModel, nil
	}

	return s.models.DefaultModel(ctx)
}

func (s *TeamService) SpawnMember(ctx context.Context, input SpawnInput) (string, string, error) {
	// Check budget before spawning to avoid wasting resources on a member
	// that will immediately be budget-constrained.
	if err := s.ensureSpawnBudgetAvailable(); err != nil {
		return "", "", err
	}

	label := fmt.Sprintf("%s/%s", input.Model.ProviderID, input.Model.ModelID)

	rules := []PermissionRule{
		{Permission: "team_create", Pattern: "*", Action: "deny"},
		{Permission: "team_spawn", Pattern: "*", Action: "deny"},
		{Permission: "team_shutdown", Pattern: "*", Action: "deny"},
		{Permission: "team_cleanup", Pattern: "*", Action: "deny"},
		{Permission: "team_approve_plan", Pattern: "*", Action: "deny"},
	}

	if input.PlanApproval {
		for _, tool := range WRITE_TOOLS {
			rules = append(rules, PermissionRule{Permission: tool, Pattern: "*:plan-approval", Action: "deny"})
		}
	}

	title := fmt.Sprintf("%s (@%s teammate, %s)", input.Name, input.Agent.Name, label)
	if input.PlanApproval {
		title += " [plan mode]"
	}

	sessionID, err := s.sessions.CreateSession(ctx, input.ParentSessionID, input.Agent.Name, title, rules)
	if err != nil {
		return "", "", err
	}

	member := TeamMember{
		Name:            input.Name,
		SessionID:       sessionID,
		Agent:           input.Agent.Name,
		Status:          MemberStatusBusy,
		ExecutionStatus: ExecutionStatusIdle,
		Prompt:          input.Prompt,
		Model:           label,
	}
	if input.PlanApproval {
		member.PlanApproval = PlanApprovalPending
	} else {
		member.PlanApproval = PlanApprovalNone
	}

	if err := s.AddMember(ctx, input.TeamName, member); err != nil {
		if removeErr := s.sessions.RemoveSession(ctx, sessionID); removeErr != nil {
			slog.Warn("Failed to remove session after add-member failure", "sessionID", sessionID, "error", removeErr)
		}
		return "", "", err
	}

	if input.ClaimTask != "" {
		if _, err := s.ClaimTask(ctx, input.TeamName, input.ClaimTask, input.Name); err != nil {
			slog.Warn("Failed to claim task for spawned member", "teamName", input.TeamName, "memberName", input.Name, "taskID", input.ClaimTask, "error", err)
		}
	}

	contextParts := []string{
		fmt.Sprintf("You are %q, a teammate in team %q.", input.Name, input.TeamName),
		fmt.Sprintf("Your agent type is %q, using model %s.", input.Agent.Name, label),
		"",
		"Team tools available to you:",
		"- team_message: send a message to the lead or another teammate",
		"- team_broadcast: send a message to all teammates",
		"- team_tasks: view/add/complete tasks on the shared task list",
		"- team_claim: claim a pending task from the shared task list",
		"",
		"You do NOT have access to team_create, team_spawn, team_shutdown, or team_cleanup.",
		"Only the team lead can manage the team structure.",
	}

	if len(input.Agent.Skills) > 0 {
		contextParts = append(contextParts,
			"",
			fmt.Sprintf("Preloaded skills: %s", strings.Join(input.Agent.Skills, ", ")),
			"These skills are already loaded into your context — you do not need to invoke the skill tool for them.",
			"",
		)
	}

	if input.PlanApproval {
		contextParts = append(contextParts,
			"",
			"IMPORTANT: You are in PLAN MODE (read-only). You can read files, search, and explore,",
			"but you CANNOT write, edit, or run bash commands until the lead approves your plan.",
			"",
			"Your workflow:",
			"1. Research and explore the codebase to understand the problem",
			"2. Formulate a detailed implementation plan",
			"3. Send your plan to the lead using team_message (to: 'lead')",
			"4. Wait for the lead to approve your plan (you'll receive a message when approved)",
			"5. Once approved, your write permissions will be unlocked and you can implement",
			"",
		)
	}

	contextParts = append(contextParts,
		"When you finish a task, mark it done with team_tasks and send a summary to the lead with team_message.",
		"You can message any teammate by name — not just the lead. Coordinate directly with peers when useful.",
		"",
		"SUBAGENT RELAY: If you use the task tool to spawn subagents, they CANNOT communicate with the team.",
		"You are responsible for relaying any relevant subagent findings via team_message or team_broadcast.",
		"",
		"IMPORTANT: Your plain text output is NOT visible to the team lead or other teammates.",
		"You MUST use team_message or team_broadcast to communicate. Just typing a response is not enough.",
		"",
		"Your instructions:",
		input.Prompt,
	)

	contextMsg := strings.Join(contextParts, "\n")

	if err := s.sessions.InjectMessage(ctx, sessionID, "system", contextMsg, ""); err != nil {
		return "", "", err
	}

	s.warnTransitionExecution(ctx, input.TeamName, input.Name, ExecutionStatusStarting, false, "Failed to mark member starting")

	s.mu.Lock()
	s.runWG.Add(1)
	s.mu.Unlock()
	go s.runMemberLoop(ctx, input, sessionID)

	return sessionID, label, nil
}

func (s *TeamService) ensureSpawnBudgetAvailable() error {
	if s.budget == nil {
		return nil
	}

	usage := s.budget.GetUsage()
	u := usage.Value
	if u.RemainingUSD != nil && *u.RemainingUSD <= 0 {
		return fmt.Errorf("cannot spawn member: organization USD budget exhausted")
	}
	if u.Initial > 0 && u.Remaining <= 0 {
		return fmt.Errorf("cannot spawn member: LLM call budget exhausted")
	}

	return nil
}

func (s *TeamService) runMemberLoop(ctx context.Context, input SpawnInput, sessionID string) {
	defer s.runWG.Done()
	defer func() {
		if recovered := recover(); recovered != nil {
			slog.Error("Panic in member prompt loop", "teamName", input.TeamName, "memberName", input.Name, "panic", recovered)
		}
	}()

	s.warnTransitionExecution(ctx, input.TeamName, input.Name, ExecutionStatusRunning, false, "Failed to mark member running")

	loopErr := s.sessions.StartPromptLoop(ctx, sessionID)

	s.finalizeMemberExecution(ctx, input.TeamName, input.Name)
	leadMsg := s.buildCompletionMessage(ctx, input.TeamName, input.Name, sessionID, loopErr)
	if leadMsg != "" {
		if sendErr := s.Send(ctx, input.TeamName, input.Name, "lead", leadMsg); sendErr != nil {
			slog.Warn("Failed to send completion message to lead", "teamName", input.TeamName, "memberName", input.Name, "error", sendErr)
		}
	}
}

func (s *TeamService) finalizeMemberExecution(ctx context.Context, teamName, memberName string) {
	s.warnTransitionExecution(ctx, teamName, memberName, ExecutionStatusCompleting, false, "Failed to mark member completing")
	s.warnTransitionExecution(ctx, teamName, memberName, ExecutionStatusCompleted, false, "Failed to mark member completed")
	s.warnTransitionExecution(ctx, teamName, memberName, ExecutionStatusIdle, false, "Failed to mark member idle")
}

func (s *TeamService) buildCompletionMessage(ctx context.Context, teamName, memberName, sessionID string, loopErr error) string {
	if loopErr != nil {
		s.warnForceTransitionMember(ctx, teamName, memberName, MemberStatusError, "Failed to transition member to error")
		return fmt.Sprintf("I encountered an error and stopped: %v. Review my session (%s). You can use team_shutdown to shut me down, or send me a message to retry.", loopErr, sessionID)
	}

	member := s.findCurrentMember(ctx, teamName, memberName)
	if member != nil && member.Status == MemberStatusShutdownRequested {
		s.warnForceTransitionMember(ctx, teamName, memberName, MemberStatusShutdown, "Failed to transition member to shutdown")
		return ""
	}

	s.warnForceTransitionMember(ctx, teamName, memberName, MemberStatusReady, "Failed to transition member to ready")
	return fmt.Sprintf("I have finished my current work and am now idle. Review my session (%s) for detailed results. You can use team_shutdown to shut me down if no more work is needed.", sessionID)
}

func (s *TeamService) findCurrentMember(ctx context.Context, teamName, memberName string) *TeamMember {
	team, err := s.Get(ctx, teamName)
	if err != nil {
		slog.Warn("Failed to refresh team after member finished", "teamName", teamName, "memberName", memberName, "error", err)
		return nil
	}
	return findMember(team.Members, memberName)
}

func memberIndex(members []TeamMember, name string) int {
	for i, member := range members {
		if member.Name == name {
			return i
		}
	}
	return -1
}

func findMember(members []TeamMember, name string) *TeamMember {
	idx := memberIndex(members, name)
	if idx == -1 {
		return nil
	}
	return &members[idx]
}

func (s *TeamService) Recover(ctx context.Context) (int, error) {
	teams, err := s.store.ListTeams(ctx)
	if err != nil {
		return 0, err
	}

	count := 0
	for _, team := range teams {
		for _, m := range team.Members {
			if m.Status == MemberStatusBusy {
				s.warnTransitionExecution(ctx, team.Name, m.Name, ExecutionStatusCancelled, true, "Failed to mark member cancelled during recovery")
				s.warnTransitionExecution(ctx, team.Name, m.Name, ExecutionStatusIdle, true, "Failed to mark member idle during recovery")
				s.warnForceTransitionMember(ctx, team.Name, m.Name, MemberStatusReady, "Failed to mark member ready during recovery")
				count++
				if _, recoverErr := s.RecoverInbox(ctx, team.Name, m.Name, m.SessionID); recoverErr != nil {
					slog.Warn("Failed to recover member inbox", "teamName", team.Name, "memberName", m.Name, "error", recoverErr)
				}
			}
		}
		if _, recoverErr := s.RecoverInbox(ctx, team.Name, "lead", team.LeadSessionID); recoverErr != nil {
			slog.Warn("Failed to recover lead inbox", "teamName", team.Name, "error", recoverErr)
		}
	}

	return count, nil
}

func (s *TeamService) RecoverInbox(ctx context.Context, teamName, agentName, sessionID string) (int, error) {
	pending, err := s.inbox.Unread(teamName, agentName)
	if err != nil {
		return 0, err
	}

	if len(pending) == 0 {
		return 0, nil
	}

	count := 0
	for _, msg := range pending {
		if err := s.sessions.InjectMessage(ctx, sessionID, msg.From, msg.Text, msg.ID); err == nil {
			count++
		}
	}
	return count, nil
}

const MAX_TEXT = 10 * 1024

func validateText(text string) error {
	if len(text) > MAX_TEXT {
		return fmt.Errorf("team message too large (%d chars), maximum is %d", len(text), MAX_TEXT)
	}
	return nil
}

func (s *TeamService) Send(ctx context.Context, teamName, from, to, text string) error {
	if err := validateText(text); err != nil {
		return err
	}
	team, err := s.Get(ctx, teamName)
	if err != nil {
		return err
	}

	targetSessionID, err := s.findTargetSession(team, to)
	if err != nil {
		return err
	}

	msgID := nextInboxMessageID()
	msg := agent.InboxMessage{
		ID:        msgID,
		From:      from,
		Text:      text,
		Timestamp: time.Now().UnixNano() / int64(time.Millisecond),
	}

	if err := s.inbox.Write(teamName, to, msg); err != nil {
		return err
	}

	if err := s.sessions.InjectMessage(ctx, targetSessionID, from, text, msgID); err != nil {
		return err
	}

	if pubErr := s.bus.Publish(ctx, "team.message", map[string]string{
		"teamName": teamName,
		"from":     from,
		"to":       to,
		"text":     text,
	}); pubErr != nil {
		slog.Warn("bus.Publish team.message failed", "error", pubErr)
	}

	return s.sessions.AutoWake(ctx, targetSessionID)
}

func (s *TeamService) findTargetSession(team *TeamInfo, to string) (string, error) {
	if to == "lead" {
		return team.LeadSessionID, nil
	}
	for _, m := range team.Members {
		if m.Name == to {
			if m.Status == MemberStatusShutdown {
				return "", fmt.Errorf("member %q has shut down", to)
			}
			return m.SessionID, nil
		}
	}
	return "", fmt.Errorf("member %q not found", to)
}

func (s *TeamService) Broadcast(ctx context.Context, teamName, from, text string) error {
	if err := validateText(text); err != nil {
		return err
	}
	team, err := s.Get(ctx, teamName)
	if err != nil {
		return err
	}

	type target struct {
		name string
		id   string
	}
	var targets []target

	if from != "lead" {
		targets = append(targets, target{name: "lead", id: team.LeadSessionID})
	}

	for _, m := range team.Members {
		if m.Name != from && m.Status != MemberStatusShutdown {
			targets = append(targets, target{name: m.Name, id: m.SessionID})
		}
	}

	for _, t := range targets {
		msgID := nextInboxMessageID()
		msg := agent.InboxMessage{
			ID:        msgID,
			From:      from,
			Text:      text,
			Timestamp: time.Now().UnixNano() / int64(time.Millisecond),
		}

		if err := s.inbox.Write(teamName, t.name, msg); err == nil {
			if injectErr := s.sessions.InjectMessage(ctx, t.id, from, text, msgID); injectErr != nil {
				slog.Warn("Failed to inject broadcast message", "teamName", teamName, "targetName", t.name, "error", injectErr)
			}
			if wakeErr := s.sessions.AutoWake(ctx, t.id); wakeErr != nil {
				slog.Warn("Failed to autowake broadcast target", "teamName", teamName, "targetName", t.name, "error", wakeErr)
			}
		} else {
			slog.Warn("Failed to write broadcast message to inbox", "teamName", teamName, "targetName", t.name, "error", err)
		}
	}

	if pubErr := s.bus.Publish(ctx, "team.broadcast", map[string]string{
		"teamName": teamName,
		"from":     from,
		"text":     text,
	}); pubErr != nil {
		slog.Warn("bus.Publish team.broadcast failed", "error", pubErr)
	}

	return nil
}

func nextInboxMessageID() string {
	var entropy [4]byte
	if _, err := readInboxMessageEntropy(entropy[:]); err != nil {
		return fmt.Sprintf("im_%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("im_%d_%s", time.Now().UnixNano(), hex.EncodeToString(entropy[:]))
}

var readInboxMessageEntropy = rand.Read

func (s *TeamService) MarkRead(ctx context.Context, teamName, agentName string) (int, error) {
	read, err := s.inbox.MarkRead(teamName, agentName)
	if err != nil {
		return 0, err
	}

	if len(read) == 0 {
		return 0, nil
	}

	bySender := make(map[string]int)
	for _, m := range read {
		if strings.HasPrefix(m.Text, "[receipt]") {
			continue
		}
		bySender[m.From]++
	}

	team, _ := s.Get(ctx, teamName)
	if team != nil {
		for sender, count := range bySender {
			receiptText := fmt.Sprintf("[receipt] %s has read your message(s)", agentName)
			if count == 1 {
				receiptText = fmt.Sprintf("[receipt] %s has read your message", agentName)
			}
			if sendErr := s.Send(ctx, teamName, agentName, sender, receiptText); sendErr != nil {
				slog.Warn("Failed to send read receipt", "teamName", teamName, "from", agentName, "to", sender, "error", sendErr)
			}
		}
	}

	if pubErr := s.bus.Publish(ctx, "team.message.read", map[string]any{
		"teamName":  teamName,
		"agentName": agentName,
		"count":     len(read),
	}); pubErr != nil {
		slog.Warn("bus.Publish team.message.read failed", "error", pubErr)
	}

	return len(read), nil
}
