package orchestrator

import (
	"context"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/team"
	"github.com/TaskForceAI/core/pkg/tools"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestInMemBus(t *testing.T) {
	bus := NewInMemBus()
	ctx := context.Background()

	// Publish with no handlers
	err := bus.Publish(ctx, "evt1", map[string]any{"key": "val"})
	require.NoError(t, err)

	// Subscribe
	called := false
	err = bus.Subscribe(ctx, "evt1", func(ctx context.Context, properties map[string]any) error {
		called = true
		assert.Equal(t, "val", properties["key"])
		return nil
	})
	require.NoError(t, err)

	// Publish with handler
	err = bus.Publish(ctx, "evt1", map[string]any{"key": "val"})
	require.NoError(t, err)
	assert.True(t, called)

	// Publish with non-map properties should no-op and not call handlers
	called = false
	err = bus.Publish(ctx, "evt1", "not-a-map")
	require.NoError(t, err)
	assert.False(t, called)

	// Handler errors are swallowed by in-memory bus publish loop
	err = bus.Subscribe(ctx, "evt-error", func(ctx context.Context, properties map[string]any) error {
		return assert.AnError
	})
	require.NoError(t, err)
	err = bus.Publish(ctx, "evt-error", map[string]any{"x": 1})
	require.NoError(t, err)

	// Max handlers
	for i := 1; i < MaxHandlersPerEvent; i++ {
		_ = bus.Subscribe(ctx, "evt1", func(ctx context.Context, properties map[string]any) error { return nil })
	}
	err = bus.Subscribe(ctx, "evt1", func(ctx context.Context, properties map[string]any) error { return nil })
	assert.ErrorContains(t, err, "maximum number of handlers")
}

func TestTeamModelProvider(t *testing.T) {
	ctx := context.Background()

	// With nil orch
	provider := &TeamModelProvider{}
	info, err := provider.ParseModel("some/model")
	require.NoError(t, err)
	assert.Equal(t, "default", info.ProviderID)
	assert.Equal(t, "some/model", info.ModelID)

	val, err := provider.GetModel(ctx, "default", "model")
	require.NoError(t, err)
	assert.Nil(t, val)

	defInfo, err := provider.DefaultModel(ctx)
	require.NoError(t, err)
	assert.Equal(t, "openai/gpt-5.6-sol", defInfo.ModelID)

	// With orch
	pch := &TaskOrchestrator{config: config.Config{Gateway: config.GatewayConfig{Model: "my/model"}}}
	providerWithOrch := &TeamModelProvider{orch: pch}
	defInfoWithOrch, err := providerWithOrch.DefaultModel(ctx)
	require.NoError(t, err)
	assert.Equal(t, "my/model", defInfoWithOrch.ModelID)
}

func TestTeamSessionManagerCreateSessionMintsRealIDAndResolvesTeamName(t *testing.T) {
	mgr := &TeamSessionManager{}
	svc := team.NewService(team.NewInMemoryStore(), nil, mgr, &TeamModelProvider{}, team.NewInMemoryBus())
	mgr.SetTeamService(svc)

	ctx := context.Background()
	_, err := svc.Create(ctx, "my-team", "lead-session", false)
	require.NoError(t, err)

	sessionID, err := mgr.CreateSession(ctx, "lead-session", "Researcher", "worker (@Researcher teammate)", nil)
	require.NoError(t, err)
	assert.Contains(t, sessionID, "team_Researcher_")

	state, ok := mgr.sessionState(sessionID)
	require.True(t, ok)
	assert.Equal(t, "my-team", state.teamName)
	assert.Equal(t, "Researcher", state.agentName)
}

func TestTeamSessionManagerInjectMessageAndRemoveSession(t *testing.T) {
	mgr := &TeamSessionManager{}
	ctx := context.Background()

	require.NoError(t, mgr.InjectMessage(ctx, "s1", "lead", "do the thing", ""))
	state, ok := mgr.sessionState("s1")
	require.True(t, ok)
	require.Len(t, state.transcript, 1)
	assert.Equal(t, "lead", state.transcript[0].from)
	assert.Equal(t, "do the thing", state.transcript[0].text)

	require.NoError(t, mgr.RemoveSession(ctx, "s1"))
	_, ok = mgr.sessionState("s1")
	assert.False(t, ok)
}

func TestTeamSessionManagerRepairsUnexpectedSessionStateType(t *testing.T) {
	mgr := &TeamSessionManager{}
	mgr.sessions.Store("s1", "unexpected")

	state, ok := mgr.sessionState("s1")
	assert.False(t, ok)
	assert.Nil(t, state)

	repaired := mgr.getOrCreateSessionState("s1")
	require.NotNil(t, repaired)
	stored, ok := mgr.sessionState("s1")
	require.True(t, ok)
	assert.Same(t, repaired, stored)
}

func TestTeamSessionManagerRemoveSessionCancelsInFlightRun(t *testing.T) {
	mgr := &TeamSessionManager{}
	ctx := context.Background()
	require.NoError(t, mgr.InjectMessage(ctx, "s1", "lead", "hi", ""))

	cancelled := false
	state, _ := mgr.sessionState("s1")
	state.mu.Lock()
	state.cancel = func() { cancelled = true }
	state.mu.Unlock()

	require.NoError(t, mgr.RemoveSession(ctx, "s1"))
	assert.True(t, cancelled)
}

func TestTeamSessionManagerCancelPromptNoOpWhenNothingRunning(t *testing.T) {
	mgr := &TeamSessionManager{}
	ctx := context.Background()
	require.NoError(t, mgr.InjectMessage(ctx, "s1", "lead", "hi", ""))
	// No cancel func registered and no orch fallback configured - should be a
	// harmless no-op, not an error.
	require.NoError(t, mgr.CancelPrompt(ctx, "s1"))
}

func TestTeamSessionManagerCancelPromptUsesSessionCancelFuncOverOrchFallback(t *testing.T) {
	pch := &TaskOrchestrator{sessionCancels: map[string]context.CancelFunc{}}
	mgr := &TeamSessionManager{orch: pch}
	ctx := context.Background()
	require.NoError(t, mgr.InjectMessage(ctx, "s1", "lead", "hi", ""))

	sessionCancelled := false
	state, _ := mgr.sessionState("s1")
	state.mu.Lock()
	state.cancel = func() { sessionCancelled = true }
	state.mu.Unlock()

	require.NoError(t, mgr.CancelPrompt(ctx, "s1"))
	assert.True(t, sessionCancelled, "should prefer the session's own cancel func")
}

func TestTeamSessionManagerCancelPromptFallsBackToOrchRegistry(t *testing.T) {
	pch := &TaskOrchestrator{}
	mgr := &TeamSessionManager{orch: pch}
	ctx := context.Background()

	orchCancelled := false
	pch.sessionCancels = map[string]context.CancelFunc{
		"s-legacy": func() { orchCancelled = true },
	}
	// No teamSessionState exists for "s-legacy" (an orchestrator-role
	// session, not a team_spawn teammate) - should fall back to the
	// orchestrator's own cancellation registry.
	require.NoError(t, mgr.CancelPrompt(ctx, "s-legacy"))
	assert.True(t, orchCancelled)
}

func TestTeamSessionManagerUpdatePermissionsRemovesMatchingPattern(t *testing.T) {
	mgr := &TeamSessionManager{}
	ctx := context.Background()
	require.NoError(t, mgr.InjectMessage(ctx, "s1", "lead", "hi", ""))
	state, _ := mgr.sessionState("s1")
	state.mu.Lock()
	state.rules = []team.PermissionRule{
		{Permission: "write", Pattern: "*:plan-approval", Action: "deny"},
		{Permission: "edit", Pattern: "*:plan-approval", Action: "deny"},
		{Permission: "team_spawn", Pattern: "*", Action: "deny"},
	}
	state.mu.Unlock()

	require.NoError(t, mgr.UpdatePermissions(ctx, "s1", "*:plan-approval"))

	state.mu.Lock()
	defer state.mu.Unlock()
	require.Len(t, state.rules, 1)
	assert.Equal(t, "team_spawn", state.rules[0].Permission)
}

func TestTeamSessionManagerRestrictAndRestoreLeadPermissions(t *testing.T) {
	mgr := &TeamSessionManager{}
	ctx := context.Background()
	require.NoError(t, mgr.InjectMessage(ctx, "lead-1", "user", "hi", ""))

	// RestrictLeadPermissions calls UpdatePermissions with an empty pattern.
	require.NoError(t, mgr.UpdatePermissions(ctx, "lead-1", ""))
	state, _ := mgr.sessionState("lead-1")
	state.mu.Lock()
	denied := deniedToolNames(state.rules)
	state.mu.Unlock()
	for _, toolName := range teamWriteTools {
		assert.True(t, denied[toolName], "expected %q to be denied after restricting lead permissions", toolName)
	}

	require.NoError(t, mgr.RestoreLeadPermissions(ctx, "lead-1", teamWriteTools))
	state.mu.Lock()
	defer state.mu.Unlock()
	assert.Empty(t, state.rules, "restoring should remove the coordination-only deny rules that were installed")
}

func TestScopedTeamRegistryFiltersDeniedToolsByName(t *testing.T) {
	base := tools.NewToolRegistry()
	base.Register(fakeTool{name: "team_spawn"})
	base.Register(fakeTool{name: "team_message"})
	base.Register(fakeTool{name: "write"})

	rules := []team.PermissionRule{
		{Permission: "team_spawn", Pattern: "*", Action: "deny"},
	}
	scoped := scopedTeamRegistry(base, rules)

	_, ok := scoped.Get("team_spawn")
	assert.False(t, ok, "denied tool must be absent from the scoped registry")
	_, ok = scoped.Get("team_message")
	assert.True(t, ok)
	_, ok = scoped.Get("write")
	assert.True(t, ok)
}

func TestScopedTeamRegistryReturnsBaseWhenNoRulesDeny(t *testing.T) {
	base := tools.NewToolRegistry()
	base.Register(fakeTool{name: "write"})
	scoped := scopedTeamRegistry(base, nil)
	assert.Same(t, base, scoped)
}

func TestTeamSessionManagerStartPromptLoopErrorsWithoutSessionOrDeps(t *testing.T) {
	mgr := &TeamSessionManager{}
	ctx := context.Background()

	err := mgr.StartPromptLoop(ctx, "missing")
	require.ErrorContains(t, err, "not found")

	require.NoError(t, mgr.InjectMessage(ctx, "s1", "lead", "hi", ""))
	err = mgr.StartPromptLoop(ctx, "s1")
	require.ErrorContains(t, err, "no runner dependencies configured")
}

func TestTeamSessionManagerStartPromptLoopRunsRealAgentAndAppendsTranscript(t *testing.T) {
	mockClient := new(MockLLMClient)
	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "investigation complete"}}},
	}, nil)

	mgr := &TeamSessionManager{}
	mgr.SetRunnerDeps(TeamRunnerDeps{
		Client:   mockClient,
		Config:   testConfig(),
		Registry: tools.NewToolRegistry(),
	})

	ctx := context.Background()
	sessionID, err := mgr.CreateSession(ctx, "lead-session", "Researcher", "title", nil)
	require.NoError(t, err)
	require.NoError(t, mgr.InjectMessage(ctx, sessionID, "lead", "investigate the bug", ""))

	require.NoError(t, mgr.StartPromptLoop(ctx, sessionID))

	state, ok := mgr.sessionState(sessionID)
	require.True(t, ok)
	state.mu.Lock()
	defer state.mu.Unlock()
	require.Len(t, state.transcript, 2)
	assert.Equal(t, "investigate the bug", state.transcript[0].text)
	assert.Equal(t, "Researcher", state.transcript[1].from)
	assert.Equal(t, "investigation complete", state.transcript[1].text)
	assert.False(t, state.running)
	assert.Nil(t, state.cancel)
	mockClient.AssertExpectations(t)
}

func TestTeamSessionManagerStartPromptLoopUsesSessionBoundDeps(t *testing.T) {
	tenantAClient := new(MockLLMClient)
	tenantBClient := new(MockLLMClient)
	tenantAClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "tenant A response"}}},
	}, nil)

	tenantAConfig := testConfig()
	tenantAConfig.Gateway.Model = "tenant-a-model"
	tenantBConfig := testConfig()
	tenantBConfig.Gateway.Model = "tenant-b-model"

	mgr := &TeamSessionManager{}
	mgr.SetRunnerDeps(TeamRunnerDeps{Client: tenantAClient, Config: tenantAConfig, Registry: tools.NewToolRegistry()})
	sessionID, err := mgr.CreateSession(context.Background(), "lead", "Researcher", "title", nil)
	require.NoError(t, err)
	require.NoError(t, mgr.InjectMessage(context.Background(), sessionID, "lead", "TENANT_A_SECRET_TRANSCRIPT", ""))

	mgr.SetRunnerDeps(TeamRunnerDeps{Client: tenantBClient, Config: tenantBConfig, Registry: tools.NewToolRegistry()})

	require.NoError(t, mgr.StartPromptLoop(context.Background(), sessionID))
	tenantAClient.AssertExpectations(t)
	tenantBClient.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)

	state, ok := mgr.sessionState(sessionID)
	require.True(t, ok)
	state.mu.Lock()
	defer state.mu.Unlock()
	assert.Equal(t, "tenant-a-model", state.modelLabel)
}

func TestTeamSpawnBindsRequestDepsAndAppliesExplicitModel(t *testing.T) {
	tenantAClient := new(MockLLMClient)
	tenantBClient := new(MockLLMClient)
	var tenantAParams agent.ChatCompletionCreateParams
	tenantAClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Run(func(args mock.Arguments) {
		tenantAParams = args.Get(1).(agent.ChatCompletionCreateParams)
	}).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "tenant A response"}}},
	}, nil)

	tenantAConfig := testConfig()
	tenantAConfig.Gateway.Model = "openai/tenant-a-default"
	tenantAConfig.Models.Default = "openai/tenant-a-default"
	tenantAConfig.Models.Options = []config.ModelOption{
		{ID: "openai/tenant-a-default"},
		{ID: "openai/tenant-a-override"},
	}
	tenantBConfig := testConfig()
	tenantBConfig.Gateway.Model = "openai/tenant-b-model"

	mgr := &TeamSessionManager{}
	inbox := newTestTeamInbox(t.TempDir())
	svc := team.NewService(team.NewInMemoryStore(), inbox, mgr, &TeamModelProvider{}, team.NewInMemoryBus())
	mgr.SetTeamService(svc)
	_, err := svc.Create(context.Background(), "tenant-a-team", "tenant-a-lead", false)
	require.NoError(t, err)

	tenantADeps := TeamRunnerDeps{Client: tenantAClient, Config: tenantAConfig, Registry: tools.NewToolRegistry(), TeamInbox: inbox}
	teamTools := NewTeamToolsWithRunnerDeps(svc, tenantADeps)

	// Simulate tenant B refreshing the process-wide compatibility fallback
	// after tenant A's request was initialized but before tenant A calls spawn.
	mgr.SetRunnerDeps(TeamRunnerDeps{Client: tenantBClient, Config: tenantBConfig, Registry: tools.NewToolRegistry(), TeamInbox: inbox})

	result, err := teamTools.Spawn(
		context.Background(),
		ToolContext{SessionID: "tenant-a-lead"},
		"worker",
		"Researcher",
		"openai/tenant-a-override",
		"TENANT_A_SECRET_TRANSCRIPT",
		"",
		false,
	)
	require.NoError(t, err)
	assert.Equal(t, "openai/tenant-a-override", result.Metadata["model"])

	svc.Wait()
	tenantAClient.AssertExpectations(t)
	tenantBClient.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
	assert.Equal(t, "openai/tenant-a-override", tenantAParams.Model)
}

func TestTeamSessionManagerStartPromptLoopRejectsConcurrentRun(t *testing.T) {
	mgr := &TeamSessionManager{}
	mgr.SetRunnerDeps(TeamRunnerDeps{Client: new(MockLLMClient), Config: testConfig(), Registry: tools.NewToolRegistry()})

	ctx := context.Background()
	sessionID, err := mgr.CreateSession(ctx, "lead", "Researcher", "title", nil)
	require.NoError(t, err)

	state, _ := mgr.sessionState(sessionID)
	state.mu.Lock()
	state.running = true
	state.mu.Unlock()

	err = mgr.StartPromptLoop(ctx, sessionID)
	assert.ErrorContains(t, err, "already running")
}

func TestTeamSessionManagerAutoWakeIsNoOpWhenSessionMissingOrRunning(t *testing.T) {
	mgr := &TeamSessionManager{}
	ctx := context.Background()

	// Missing session: no-op, no error.
	require.NoError(t, mgr.AutoWake(ctx, "missing"))

	require.NoError(t, mgr.InjectMessage(ctx, "s1", "lead", "hi", ""))
	state, _ := mgr.sessionState("s1")
	state.mu.Lock()
	state.running = true
	state.mu.Unlock()

	// Already running: no-op, must not spawn a second run.
	require.NoError(t, mgr.AutoWake(ctx, "s1"))
}

func TestTeamSessionManagerAutoWakeResumesIdleSession(t *testing.T) {
	done := make(chan struct{})
	mockClient := new(MockLLMClient)
	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Run(func(mock.Arguments) {
		close(done)
	}).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "woke up and replied"}}},
	}, nil)

	mgr := &TeamSessionManager{}
	mgr.SetRunnerDeps(TeamRunnerDeps{Client: mockClient, Config: testConfig(), Registry: tools.NewToolRegistry()})

	ctx := context.Background()
	sessionID, err := mgr.CreateSession(ctx, "lead", "Researcher", "title", nil)
	require.NoError(t, err)
	require.NoError(t, mgr.InjectMessage(ctx, sessionID, "lead", "new message while idle", ""))

	require.NoError(t, mgr.AutoWake(ctx, sessionID))

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("AutoWake did not trigger a real agent run in time")
	}
	mockClient.AssertExpectations(t)
}

func TestTeamSessionManagerGetSessionInfoAndModelFallbacks(t *testing.T) {
	ctx := context.Background()

	// No session, no orch, no deps.
	mgr := &TeamSessionManager{}
	name, provider, model, err := mgr.GetSessionInfo(ctx, "missing")
	require.NoError(t, err)
	assert.Equal(t, "agent", name)
	assert.Equal(t, "default", provider)
	assert.Equal(t, "openai/gpt-5.6-sol", model)

	modelInfo, err := mgr.GetLastUserMessageModel(ctx, "missing")
	require.NoError(t, err)
	assert.Nil(t, modelInfo, "no session and no data means no hint, not a fabricated default")

	// Existing session, no deps: agent name is known, model isn't.
	require.NoError(t, mgr.InjectMessage(ctx, "s1", "lead", "hi", ""))
	name, _, model, err = mgr.GetSessionInfo(ctx, "s1")
	require.NoError(t, err)
	assert.Empty(t, name) // never set via CreateSession
	assert.Empty(t, model)

	// With orch fallback and no session.
	pch := &TaskOrchestrator{config: config.Config{Gateway: config.GatewayConfig{Model: "my/model"}}}
	mgrWithOrch := &TeamSessionManager{orch: pch}
	_, _, modelWithOrch, err := mgrWithOrch.GetSessionInfo(ctx, "unknown")
	require.NoError(t, err)
	assert.Equal(t, "my/model", modelWithOrch)
}

type fakeTool struct {
	name string
}

func (f fakeTool) Name() string                     { return f.name }
func (f fakeTool) Description() string              { return "fake tool for registry filtering tests" }
func (f fakeTool) Parameters() tools.ToolParameters { return tools.ToolParameters{Type: "object"} }
func (f fakeTool) Execute(context.Context, string) (tools.ToolResult, error) {
	return tools.ToolResult{"success": true}, nil
}
func (f fakeTool) ToGatewaySchema() any { return map[string]any{"name": f.name} }
