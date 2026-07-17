package orchestrator

import (
	"context"
	"errors"
	"strings"
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

func TestNewRefreshesSharedTeamManagerAndExposesMode(t *testing.T) {
	manager := &TeamSessionManager{}
	inbox := team.NewInMemoryInbox()
	service := team.NewService(team.NewInMemoryStore(), inbox, manager, &TeamModelProvider{}, team.NewInMemoryBus())

	orch := New(testConfig(), OrchestratorDeps{
		TeamService:        service,
		TeamSessionManager: manager,
		TeamInbox:          inbox,
	}, OrchestratorOptions{Mode: "work"})

	assert.Equal(t, "work", orch.Mode())
	assert.NotNil(t, manager.deps.Load())
}

func TestLLMResponseCompactorRemainingBranches(t *testing.T) {
	spy := &spyResponseCompactor{}
	c := &LLMResponseCompactor{Fallback: spy}
	assert.Same(t, spy, c.fallback())
	assert.Empty(t, c.Compact(context.Background(), nil, "task"))

	mockClient := new(MockLLMClient)
	deps := gapOrchestratorDeps(mockClient)
	deps.PromptProvider = testPromptProvider{compaction: "Summarize."}
	orch := New(testConfig(), deps, OrchestratorOptions{})
	c = &LLMResponseCompactor{Orchestrator: orch}
	responses := make([]string, 31)
	for i := range responses {
		responses[i] = strings.Repeat("x", 801)
	}
	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "summary"}}},
	}, nil)
	out := c.Compact(context.Background(), responses, "task")
	require.Len(t, out, len(responses))
	assert.Equal(t, "summary", out[0])
}

func TestTeamSessionManagerRemainingBranches(t *testing.T) {
	assert.Equal(t, "one\n\n[two]: two", renderTeamTranscript([]teamTranscriptEntry{{text: "one"}, {from: "two", text: "two"}}))
	assert.Nil(t, teamRunnerDepsFromContext(nil)) //nolint:staticcheck // Intentionally verifies defensive nil-context handling.
	assert.Nil(t, scopedTeamRegistry(nil, nil))

	mgr := &TeamSessionManager{}
	state := mgr.getOrCreateSessionState("session")
	state.rules = []team.PermissionRule{{Permission: "team_spawn", Pattern: "*", Action: "deny"}}
	require.NoError(t, mgr.RestoreLeadPermissions(context.Background(), "session", teamWriteTools))
	require.Len(t, state.rules, 1)

	state.agentName = "Researcher"
	state.deps = &TeamRunnerDeps{Config: config.Config{Gateway: config.GatewayConfig{Model: "openai/fallback"}}}
	name, _, model, err := mgr.GetSessionInfo(context.Background(), "session")
	require.NoError(t, err)
	assert.Equal(t, "Researcher", name)
	assert.Equal(t, "openai/fallback", model)

	state.modelLabel = "openai/explicit"
	modelInfo, err := mgr.GetLastUserMessageModel(context.Background(), "session")
	require.NoError(t, err)
	require.NotNil(t, modelInfo)
	assert.Equal(t, "openai/explicit", modelInfo.ModelID)
}

func TestTeamSessionManagerRunFailuresAndRolePrompt(t *testing.T) {
	t.Run("start prompt loop returns client error", func(t *testing.T) {
		client := new(MockLLMClient)
		client.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, errors.New("completion failed"))
		mgr := &TeamSessionManager{}
		mgr.SetRunnerDeps(TeamRunnerDeps{Client: client, Config: testConfig(), Registry: tools.NewToolRegistry()})
		sessionID, err := mgr.CreateSession(context.Background(), "lead", "Researcher", "title", nil)
		require.NoError(t, err)
		require.NoError(t, mgr.InjectMessage(context.Background(), sessionID, "lead", "prompt", ""))
		require.ErrorContains(t, mgr.StartPromptLoop(context.Background(), sessionID), "completion failed")
	})

	t.Run("role prompt is installed for teammate run", func(t *testing.T) {
		client := new(MockLLMClient)
		client.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(params agent.ChatCompletionCreateParams) bool {
			return len(params.Messages) > 0 && strings.HasPrefix(params.Messages[0].Content, "role system prompt")
		})).Return(&agent.ChatCompletion{Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "done"}}}}, nil)
		mgr := &TeamSessionManager{}
		_, err := mgr.runTeammateTurn(context.Background(), &TeamRunnerDeps{
			Client:         client,
			Config:         testConfig(),
			Registry:       tools.NewToolRegistry(),
			PromptProvider: testPromptProvider{roles: map[string]string{"Researcher": "role system prompt"}},
		}, "team", "Researcher", nil, "prompt")
		require.NoError(t, err)
		client.AssertExpectations(t)
	})

	t.Run("autowake logs prompt loop errors", func(t *testing.T) {
		mgr := &TeamSessionManager{}
		require.NoError(t, mgr.InjectMessage(context.Background(), "idle", "lead", "prompt", ""))
		require.NoError(t, mgr.AutoWake(context.Background(), "idle"))
		require.Eventually(t, func() bool {
			state, _ := mgr.sessionState("idle")
			state.mu.Lock()
			defer state.mu.Unlock()
			return !state.running
		}, time.Second, time.Millisecond)
	})
}

func TestResolveSpawnModelRemainingBranches(t *testing.T) {
	service := team.NewService(team.NewInMemoryStore(), team.NewInMemoryInbox(), &mockSessions{}, &mockModels{}, team.NewInMemoryBus())
	ctx := context.Background()

	configured := config.Config{Gateway: config.GatewayConfig{Model: "openai/default"}}
	teamTools := &TeamTools{service: service, runnerDeps: &TeamRunnerDeps{Config: configured}}
	model, deps, err := teamTools.resolveSpawnModel(ctx, "", "parent")
	require.NoError(t, err)
	assert.Equal(t, "openai", model.ProviderID)
	assert.Equal(t, "openai/default", deps.Config.Gateway.Model)

	teamTools.runnerDeps = &TeamRunnerDeps{}
	_, _, err = teamTools.resolveSpawnModel(ctx, "", "parent")
	require.ErrorIs(t, err, ErrNoModelsConfigured)

	_, _, err = teamTools.resolveSpawnModel(ctx, "invalid", "parent")
	require.ErrorContains(t, err, "expected provider/model")

	teamTools.runnerDeps = &TeamRunnerDeps{Config: config.Config{Models: config.ModelsConfig{
		Default: "openai/default",
		Options: []config.ModelOption{{ID: "openai/default"}},
	}}}
	_, _, err = teamTools.resolveSpawnModel(ctx, "openai/missing", "parent")
	require.Error(t, err)
}

func TestSpawnReturnsModelResolutionError(t *testing.T) {
	mgr := &mockSessions{}
	inbox := team.NewInMemoryInbox()
	service := team.NewService(team.NewInMemoryStore(), inbox, mgr, &mockModels{}, team.NewInMemoryBus())
	_, err := service.Create(context.Background(), "team", "lead", false)
	require.NoError(t, err)
	teamTools := NewTeamToolsWithRunnerDeps(service, TeamRunnerDeps{})
	result, err := teamTools.Spawn(context.Background(), ToolContext{SessionID: "lead"}, "worker", "agent", "", "prompt", "", false)
	require.ErrorIs(t, err, ErrNoModelsConfigured)
	assert.Equal(t, "Error", result.Title)
}
