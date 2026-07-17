package orchestrator

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/core/pkg/team"
	"github.com/TaskForceAI/core/pkg/tools"
)

// Model Provider Implementation
type TeamModelProvider struct {
	orch *TaskOrchestrator
}

func (p *TeamModelProvider) ParseModel(model string) (team.ModelInfo, error) {
	// Simple parsing for now: provider/model
	return team.ModelInfo{ProviderID: "default", ModelID: model}, nil
}

func (p *TeamModelProvider) GetModel(ctx context.Context, providerID, modelID string) (any, error) {
	return nil, nil //nolint:nilnil // This compatibility provider validates by error only and has no model payload.
}

func (p *TeamModelProvider) DefaultModel(ctx context.Context) (team.ModelInfo, error) {
	if p.orch == nil {
		return team.ModelInfo{ProviderID: "default", ModelID: "openai/gpt-5.6-sol"}, nil
	}
	return team.ModelInfo{ProviderID: "default", ModelID: p.orch.config.Gateway.Model}, nil
}

// TeamRunnerDeps carries the per-request pieces TeamSessionManager needs to
// construct a real GatewayAgent for a spawned teammate. Shared managers may
// receive updates from many requests, so every teammate session binds the
// request-scoped snapshot supplied by its team_spawn call.
type TeamRunnerDeps struct {
	Client         agent.ILLMClient
	Config         config.Config
	Registry       *tools.ToolRegistry
	PromptProvider PromptProvider
	TeamInbox      team.InboxStore
}

// teamSessionState is the real per-session state TeamSessionManager tracks:
// a lightweight transcript (for turn-to-turn continuity, since GatewayAgent
// itself is single-shot and never persists history - see doRunAgentParallel),
// the permission rules installed at spawn time (or later via
// UpdatePermissions/RestoreLeadPermissions), and the cancel func for the
// currently in-flight run, if any.
type teamSessionState struct {
	mu         sync.Mutex
	teamName   string
	agentName  string
	modelLabel string
	transcript []teamTranscriptEntry
	rules      []team.PermissionRule
	deps       *TeamRunnerDeps
	cancel     context.CancelFunc
	running    bool
}

type teamTranscriptEntry struct {
	from string
	text string
}

func renderTeamTranscript(entries []teamTranscriptEntry) string {
	var b strings.Builder
	for i, e := range entries {
		if i > 0 {
			b.WriteString("\n\n")
		}
		if e.from != "" {
			b.WriteString("[" + e.from + "]: ")
		}
		b.WriteString(e.text)
	}
	return strings.TrimSpace(b.String())
}

// Session Manager Implementation
type TeamSessionManager struct {
	orch *TaskOrchestrator // optional; retained only as a legacy fallback, see CancelPrompt
	svc  atomic.Pointer[team.Service]
	deps atomic.Pointer[TeamRunnerDeps]

	sessions sync.Map // sessionID -> *teamSessionState
}

// SetRunnerDeps preserves compatibility for direct SessionManager callers.
// Production team_spawn calls carry their own request-scoped snapshot so a
// later request cannot change the dependencies bound to a child session.
func (m *TeamSessionManager) SetRunnerDeps(d TeamRunnerDeps) {
	m.deps.Store(cloneTeamRunnerDeps(&d))
}

func cloneTeamRunnerDeps(d *TeamRunnerDeps) *TeamRunnerDeps {
	if d == nil {
		return nil
	}
	clone := *d
	return &clone
}

type teamRunnerDepsContextKey struct{}

func withTeamRunnerDeps(ctx context.Context, deps *TeamRunnerDeps) context.Context {
	if deps == nil {
		return ctx
	}
	return context.WithValue(ctx, teamRunnerDepsContextKey{}, cloneTeamRunnerDeps(deps))
}

func teamRunnerDepsFromContext(ctx context.Context) *TeamRunnerDeps {
	if ctx == nil {
		return nil
	}
	deps, _ := ctx.Value(teamRunnerDepsContextKey{}).(*TeamRunnerDeps)
	return cloneTeamRunnerDeps(deps)
}

// SetTeamService lets TeamSessionManager resolve a session's team name
// (needed for AgentOptions.TeamName/TeamInbox polling) without creating a
// circular constructor dependency - team.NewService needs a SessionManager,
// so the Service reference has to be supplied after the fact.
func (m *TeamSessionManager) SetTeamService(svc *team.Service) {
	m.svc.Store(svc)
}

func (m *TeamSessionManager) sessionState(sessionID string) (*teamSessionState, bool) {
	v, ok := m.sessions.Load(sessionID)
	if !ok {
		return nil, false
	}
	state, ok := v.(*teamSessionState)
	if !ok {
		return nil, false
	}
	return state, true
}

func (m *TeamSessionManager) getOrCreateSessionState(sessionID string) *teamSessionState {
	v, _ := m.sessions.LoadOrStore(sessionID, &teamSessionState{})
	if state, ok := v.(*teamSessionState); ok {
		return state
	}
	// Unexpected type under the session key; replace with a fresh state.
	state := &teamSessionState{}
	m.sessions.Store(sessionID, state)
	return state
}

func (m *TeamSessionManager) CreateSession(ctx context.Context, parentID, agentName, title string, permissions []team.PermissionRule) (string, error) {
	sessionID := fmt.Sprintf("team_%s_%d", agentName, time.Now().UnixNano())

	teamName := ""
	if svc := m.svc.Load(); svc != nil {
		if teamInfo, _, _, err := svc.FindBySession(ctx, parentID); err == nil && teamInfo != nil {
			teamName = teamInfo.Name
		}
	}

	deps := teamRunnerDepsFromContext(ctx)
	if deps == nil {
		deps = cloneTeamRunnerDeps(m.deps.Load())
	}
	modelLabel := ""
	if deps != nil {
		modelLabel = deps.Config.Gateway.Model
	}

	state := &teamSessionState{
		teamName:   teamName,
		agentName:  agentName,
		modelLabel: modelLabel,
		rules:      append([]team.PermissionRule{}, permissions...),
		deps:       deps,
	}
	m.sessions.Store(sessionID, state)
	return sessionID, nil
}

func (m *TeamSessionManager) RemoveSession(ctx context.Context, sessionID string) error {
	if state, ok := m.sessionState(sessionID); ok {
		state.mu.Lock()
		if state.cancel != nil {
			state.cancel()
		}
		state.mu.Unlock()
	}
	m.sessions.Delete(sessionID)
	return nil
}

// InjectMessage appends a turn to the session's transcript. It's used both
// to seed the very first turn at spawn time and to add a new turn for an
// already-idle session (see AutoWake) - the running loop's own inbox
// polling (agent.enginecore_stream.go's appendTeamInboxMessages) already
// keeps an *active* run aware of new messages, so this only needs to
// guarantee the *next* run sees it.
func (m *TeamSessionManager) InjectMessage(ctx context.Context, sessionID, fromName, text, inboxMessageID string) error {
	state := m.getOrCreateSessionState(sessionID)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.transcript = append(state.transcript, teamTranscriptEntry{from: fromName, text: text})
	return nil
}

// StartPromptLoop runs one real agent turn to completion (the tool-calling
// "loop" is internal to GatewayAgent.Run - see doRunAgentParallel, which
// this mirrors). It blocks, matching runMemberLoop's contract: the caller
// derives the member's status transition from this call's return value.
func (m *TeamSessionManager) StartPromptLoop(ctx context.Context, sessionID string) error {
	state, ok := m.sessionState(sessionID)
	if !ok {
		return fmt.Errorf("team session %q not found", sessionID)
	}
	state.mu.Lock()
	if state.running {
		state.mu.Unlock()
		return fmt.Errorf("team session %q is already running", sessionID)
	}
	deps := cloneTeamRunnerDeps(state.deps)
	if deps == nil {
		deps = cloneTeamRunnerDeps(m.deps.Load())
		state.deps = cloneTeamRunnerDeps(deps)
	}
	if deps == nil {
		state.mu.Unlock()
		return fmt.Errorf("team session manager has no runner dependencies configured")
	}
	state.running = true
	prompt := renderTeamTranscript(state.transcript)
	rules := append([]team.PermissionRule{}, state.rules...)
	teamName := state.teamName
	agentName := state.agentName
	state.modelLabel = deps.Config.Gateway.Model
	state.mu.Unlock()

	agentCtx, cancel := context.WithCancel(ctx)
	state.mu.Lock()
	state.cancel = cancel
	state.mu.Unlock()
	defer func() {
		state.mu.Lock()
		state.cancel = nil
		state.running = false
		state.mu.Unlock()
		cancel()
	}()

	response, runErr := m.runTeammateTurn(agentCtx, deps, teamName, agentName, rules, prompt)
	if runErr != nil {
		return runErr
	}

	state.mu.Lock()
	state.transcript = append(state.transcript, teamTranscriptEntry{from: agentName, text: response})
	state.mu.Unlock()
	return nil
}

// AutoWake resumes an idle session after a new message arrives. If the
// session is still actively running, this is a no-op - that run's own
// inbox polling already picks up the new message. Must be safe to call
// unconditionally, since Broadcast fans this out to every member regardless
// of status.
func (m *TeamSessionManager) AutoWake(ctx context.Context, sessionID string) error {
	state, ok := m.sessionState(sessionID)
	if !ok {
		return nil
	}
	state.mu.Lock()
	alreadyRunning := state.running
	state.mu.Unlock()
	if alreadyRunning {
		return nil
	}

	go withBackgroundRecovery("team-autowake:"+sessionID, nil, func() {
		if err := m.StartPromptLoop(context.WithoutCancel(ctx), sessionID); err != nil {
			platform.GetLogger().Warn("Auto-wake prompt loop failed", "sessionID", sessionID, "error", err)
		}
	})
	return nil
}

// runTeammateTurn builds a real GatewayAgent scoped to the session's
// permission rules and runs one turn. Registry filtering (rather than a
// per-call gate) is sufficient here because a teammate's tool list is
// rebuilt fresh at the start of every StartPromptLoop/AutoWake invocation -
// this does NOT cover a *currently running* session having its permissions
// changed mid-turn (e.g. delegate-mode lead self-restriction), which would
// need a deeper gate inside pkg/agent's tool dispatch. That's a known,
// narrower gap left for a follow-up; it doesn't affect the primary
// team_spawn/team_message/plan-approval flows this implements.
func (m *TeamSessionManager) runTeammateTurn(ctx context.Context, deps *TeamRunnerDeps, teamName, agentName string, rules []team.PermissionRule, prompt string) (string, error) {
	cfg := deps.Config
	if systemPrompt := loadRolePromptFromProvider(deps.PromptProvider, agentName); systemPrompt != "" {
		cfg.SystemPrompt = systemPrompt
	}

	opts := agent.AgentOptions{
		AgentLabel:      "team:" + agentName,
		Registry:        scopedTeamRegistry(deps.Registry, rules),
		TeamInbox:       deps.TeamInbox,
		TeamName:        teamName,
		AgentName:       agentName,
		RawSystemPrompt: true,
	}

	a := agent.NewGatewayAgent(cfg, deps.Client, opts)
	return a.Run(ctx, prompt, nil)
}

// scopedTeamRegistry returns a copy of base with every tool matching a
// deny rule removed. All real deny rules in this codebase deny by tool
// name (Pattern "*" for team-management tools denied to every teammate,
// or Pattern "*:plan-approval" for write tools denied until a plan is
// approved) rather than by argument/path, so name-based filtering is a
// faithful, real enforcement - a denied tool is genuinely absent from both
// the LLM-facing schema and the dispatch table, not merely hidden.
func scopedTeamRegistry(base *tools.ToolRegistry, rules []team.PermissionRule) *tools.ToolRegistry {
	if base == nil {
		return nil
	}
	denied := deniedToolNames(rules)
	if len(denied) == 0 {
		return base
	}
	scoped := tools.NewToolRegistry()
	for _, t := range base.All() {
		if denied[t.Name()] {
			continue
		}
		scoped.Register(t)
	}
	return scoped
}

func deniedToolNames(rules []team.PermissionRule) map[string]bool {
	denied := make(map[string]bool, len(rules))
	for _, r := range rules {
		if r.Action == "deny" {
			denied[r.Permission] = true
		}
	}
	return denied
}

// UpdatePermissions removes rules matching removePattern from the session's
// stored rule set (mirrors how ApprovePlan lifts plan-mode write-tool denial
// via removePattern="*:plan-approval"). An empty removePattern is
// RestrictLeadPermissions' convention for "install the coordination-only
// deny set" instead.
func (m *TeamSessionManager) UpdatePermissions(ctx context.Context, sessionID string, removePattern string) error {
	state := m.getOrCreateSessionState(sessionID)
	state.mu.Lock()
	defer state.mu.Unlock()

	if removePattern == "" {
		state.rules = coordinationOnlyRules(state.rules)
		return nil
	}

	kept := make([]team.PermissionRule, 0, len(state.rules))
	for _, r := range state.rules {
		if r.Pattern == removePattern {
			continue
		}
		kept = append(kept, r)
	}
	state.rules = kept
	return nil
}

// coordinationOnlyRules adds a deny-all-write-tools rule set, matching the
// module-level writeTools list team/service.go's RestrictLeadPermissions
// intends to restrict to.
func coordinationOnlyRules(existing []team.PermissionRule) []team.PermissionRule {
	rules := append([]team.PermissionRule{}, existing...)
	for _, toolName := range teamWriteTools {
		rules = append(rules, team.PermissionRule{Permission: toolName, Pattern: "*:delegate", Action: "deny"})
	}
	return rules
}

// teamWriteTools mirrors team/service.go's unexported writeTools list.
var teamWriteTools = []string{"bash", "write", "edit", "multiedit", "apply_patch"}

func (m *TeamSessionManager) RestoreLeadPermissions(ctx context.Context, sessionID string, writeTools []string) error {
	state := m.getOrCreateSessionState(sessionID)
	state.mu.Lock()
	defer state.mu.Unlock()

	deny := make(map[string]bool, len(writeTools))
	for _, t := range writeTools {
		deny[t] = true
	}
	kept := make([]team.PermissionRule, 0, len(state.rules))
	for _, r := range state.rules {
		if r.Pattern == "*:delegate" && deny[r.Permission] {
			continue
		}
		kept = append(kept, r)
	}
	state.rules = kept
	return nil
}

func (m *TeamSessionManager) CancelPrompt(ctx context.Context, sessionID string) error {
	if state, ok := m.sessionState(sessionID); ok {
		state.mu.Lock()
		cancel := state.cancel
		state.mu.Unlock()
		if cancel != nil {
			cancel()
			return nil
		}
	}

	// Legacy fallback: an orchestrator-role agent's session (not a
	// team_spawn teammate) is cancelled via the orchestrator's own registry.
	if m.orch != nil {
		m.orch.CancelSessionPrompt(sessionID)
	}
	return nil
}

func (m *TeamSessionManager) GetSessionInfo(ctx context.Context, sessionID string) (string, string, string, error) {
	if state, ok := m.sessionState(sessionID); ok {
		state.mu.Lock()
		agentName := state.agentName
		modelLabel := state.modelLabel
		if modelLabel == "" && state.deps != nil {
			modelLabel = state.deps.Config.Gateway.Model
		}
		state.mu.Unlock()
		return agentName, "default", modelLabel, nil
	}
	if m.orch != nil {
		return "agent", "default", m.orch.config.Gateway.Model, nil
	}
	return "agent", "default", "openai/gpt-5.6-sol", nil
}

func (m *TeamSessionManager) GetLastUserMessageModel(ctx context.Context, sessionID string) (*team.ModelInfo, error) {
	if state, ok := m.sessionState(sessionID); ok {
		state.mu.Lock()
		label := state.modelLabel
		state.mu.Unlock()
		if label != "" {
			return &team.ModelInfo{ProviderID: "default", ModelID: label}, nil
		}
	}
	return nil, nil //nolint:nilnil // "no hint" - callers fall through to the default model.
}
