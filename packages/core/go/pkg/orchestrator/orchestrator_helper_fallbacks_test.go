package orchestrator

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/enginecore/permission"
	"github.com/TaskForceAI/core/pkg/enginecore/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

type noRunTelemetry struct{}

func (noRunTelemetry) StartSpan(context.Context, string, string, map[string]any, func(context.Context) error) error {
	return errors.New("telemetry down")
}

type failingSetCache struct {
	MockCache
}

func (f *failingSetCache) Set(context.Context, string, string, time.Duration) error {
	return errors.New("set failed")
}

func TestOrchestratorHelperFallbacks(t *testing.T) {
	ctx := context.Background()

	t.Run("budget nil usd and pending clamp", func(t *testing.T) {
		budget := NewBudgetManager(nil)
		value := 1.0
		budget.SetUSDBudget(&value)
		budget.SetUSDBudget(nil)
		assert.Nil(t, budget.GetUsage().Value.InitialUSD)

		budget.SetUSDBudget(&value)
		budget.pendingUSD = -1
		require.NoError(t, budget.WithBudget("stage", func() error { return nil }))
		assert.Zero(t, budget.pendingUSD)
	})

	t.Run("hitl base nil and blank agent id fallback", func(t *testing.T) {
		checker := NewHITLPermissionChecker(ctx, nil, nil, "task-1", "")
		require.NoError(t, checker.Ask(protocol.PermissionRequest{Permission: "read"}))
	})

	t.Run("mcp description and approval id fallbacks", func(t *testing.T) {
		tool := newClientMCPTool("task-1", new(MockApprovalRegistry), ClientMCPToolDescriptor{
			ServerName: localComputerUseMCPServerName,
			ToolName:   localComputerUseMCPToolName,
		})
		assert.Equal(t, localComputerUseMCPToolName, tool.Name())
		assert.NotEmpty(t, tool.Description())
		assert.Contains(t, strings.ToLower(tool.Description()), "computer")
		assert.Contains(t, nextMCPApprovalID("task-1", ClientMCPToolDescriptor{}), "task-1:mcp:server:tool:")
	})

	t.Run("soul content loads from prompt provider", func(t *testing.T) {
		assert.Equal(t, "soul content", loadSoulContentFromProvider(testPromptProvider{soul: " soul content "}))
	})

	t.Run("usage tracker stale index repairs and marshal failures", func(t *testing.T) {
		tracker := NewUsageTracker()
		tracker.toolUsageByID = map[string]int{"call-stale": 99}
		tracker.RecordToolUsage(agent.ToolEvent{InvocationID: "call-stale", ToolName: "search_web"})
		require.Len(t, tracker.GetToolUsage(), 1)

		legacyEvent := agent.ToolEvent{ToolName: "grep", Arguments: map[string]any{}}
		key := toolInvocationKeyFor(legacyEvent)
		tracker = NewUsageTracker()
		tracker.toolUsage = []agent.ToolEvent{legacyEvent}
		tracker.toolUsageLegacyKeys = []toolInvocationKey{key}
		tracker.toolUsageByLegacyKey = map[toolInvocationKey]int{key: 10}
		tracker.RecordToolUsage(legacyEvent)
		require.Len(t, tracker.GetToolUsage(), 2)
		assert.Equal(t, 0, tracker.toolUsageByLegacyKey[key])

		tracker.toolUsageByLegacyKey = nil
		tracker.updateToolEventAt(0, legacyEvent, key, true)
		assert.NotNil(t, tracker.toolUsageByLegacyKey)
		assert.Empty(t, stableToolArguments(func() {}))
	})

	t.Run("agent runner telemetry fallback and helpers", func(t *testing.T) {
		cfg := testConfig()
		cfg.Gateway.Model = "gpt-4"
		mockClient := new(MockLLMClient)
		orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1, Silent: true})
		progress := NewProgressTracker()
		progress.Initialize(1)
		deps := &AgentRunnerDeps{
			Config:          cfg,
			Orchestrator:    orch,
			UsageTracker:    NewUsageTracker(),
			ProgressTracker: progress,
			Budget:          NewBudgetManager(nil),
			Telemetry:       noRunTelemetry{},
		}
		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
			onChunk := args.Get(2).(func(agent.ChatCompletionChunk))
			onChunk(agent.ChatCompletionChunk{Choices: []agent.ChatCompletionChunkChoice{{Delta: agent.ChatCompletionChunkDelta{Content: "ok"}}}})
		}).Once()
		result := RunAgentParallel(ctx, deps, 0, "subtask")
		assert.Equal(t, "success", result.Status)
		assert.Equal(t, "Using tool...", liveToolActivity(""))
		assert.False(t, isAllowedSystemOverride(nil, ""))
		require.NoError(t, firstAgentFailureCause([]AgentResult{{Status: "success"}}))
		assert.EqualError(t, firstAgentFailureCause([]AgentResult{{Status: "error", Response: "Error: failed"}}), "failed")
	})

	t.Run("task decomposer logs cache set errors", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		decomposer := NewTaskDecomposer(TaskDecomposerDeps{
			Client:         mockClient,
			Config:         config.Config{Gateway: config.GatewayConfig{Model: "gpt-4"}},
			LLMCache:       cache.NewLLMCache(&failingSetCache{MockCache: MockCache{Data: map[string]string{}}}),
			CacheNamespace: "final-edges",
		})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: `["one"]`}}},
		}, nil).Once()
		subtasks, err := decomposer.GenerateSubtasks(ctx, "plan", 1)
		require.NoError(t, err)
		assert.Equal(t, []string{"one"}, subtasks)
	})

	t.Run("role fallback prompt loads default text", func(t *testing.T) {
		roles := GetAgentRoles()
		require.NotEmpty(t, roles)
		assert.Contains(t, roles[0].SystemPrompt, "specialized in the role")
	})

	t.Run("permission ask without registry is explicit", func(t *testing.T) {
		base := permission.CheckerFromConfig(map[string]any{"default": "ask"})
		checker := NewHITLPermissionChecker(ctx, base, nil, "task-1", "worker")
		err := checker.Ask(protocol.PermissionRequest{Permission: "read", Patterns: []string{"*"}})
		require.ErrorContains(t, err, "approval required")
	})
}
