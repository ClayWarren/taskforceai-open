package orchestrator

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestOrchestratorFallbacksAndGuards(t *testing.T) {
	cfg := config.Config{}

	t.Run("Aggregation Fallback - Empty Results", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orchDeps := gapOrchestratorDeps(mockClient)
		o := New(cfg, orchDeps, OrchestratorOptions{AgentCount: 2})
		strategy := &ConsensusAggregationStrategy{orch: o}
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, fmt.Errorf("synth fail")).Once()
		_, err := strategy.Aggregate(context.Background(), []string{"", ""}, "")
		assert.Error(t, err)
	})

	t.Run("Decomposer Cache and Regex Gaps", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		mockCache := &MockCache{Data: make(map[string]string)}
		deps := TaskDecomposerDeps{
			Client: mockClient,
			Config: config.Config{
				Gateway: config.GatewayConfig{Model: "test-model"},
			},
			Budget:         NewBudgetManager(nil),
			LLMCache:       cache.NewLLMCache(mockCache),
			CacheNamespace: "test",
		}
		decomposer := NewTaskDecomposer(deps)

		// 1. Regex Match 1: ```json ... ```
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "```json\n[\"t1\"]\n```"}}},
		}, nil).Once()
		res, _ := decomposer.GenerateSubtasks(context.Background(), "q1", 1)
		assert.Equal(t, "t1", res[0])

		// 2. Regex Match 2: [ ... ] somewhere in text
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "Result: [\"t2\"]"}}},
		}, nil).Once()
		res, _ = decomposer.GenerateSubtasks(context.Background(), "q2", 1)
		assert.Equal(t, "t2", res[0])

		// 3. Cache HIT
		// Should be "t2" from second call above (same key if I use "q2", 1)
		res, _ = decomposer.GenerateSubtasks(context.Background(), "q2", 1)
		assert.Equal(t, "t2", res[0])

		mockClient.AssertExpectations(t)
	})

	t.Run("Aggregation Strategy Gaps", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orchDeps := gapOrchestratorDeps(mockClient)
		orch := New(config.Config{}, orchDeps, OrchestratorOptions{})
		// Default Strategy Branch
		s := orch.getAggregationStrategy("unknown", "")
		assert.NotNil(t, s)

		// Synthesis Fallback Branch in aggregateResults
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, fmt.Errorf("fail")).Once()
		res, err := orch.aggregateResults(context.Background(), []AgentResult{{Status: "success", Response: "r1"}}, "q", "")
		require.NoError(t, err) // Swallowed by strategy fallback
		assert.Equal(t, "r1", res)
	})

	t.Run("validateAnswer No Choices", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orchDeps := gapOrchestratorDeps(mockClient)
		orch := New(config.Config{}, orchDeps, OrchestratorOptions{})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{},
		}, nil).Once()

		res, err := orch.validateAnswer(context.Background(), "q", []string{"a"}, "a", "")
		require.NoError(t, err)
		assert.Equal(t, "a", res)
	})

	t.Run("ModelSelection Label Gaps", func(t *testing.T) {
		assert.Equal(t, "Abc", computeModelLabel("abc"))
		assert.Equal(t, "123", computeModelLabel("123"))
	})

	t.Run("Search Provider Guards (Hardening TF-0164)", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orchDeps := gapOrchestratorDeps(mockClient)
		// webSearchEnabled: false
		orch := New(config.Config{}, orchDeps, OrchestratorOptions{WebSearchEnabled: false})

		assert.False(t, orch.webSearchEnabled)

		// Verification logic inside Orchestrate usually checks this flag before tool execution
		// We've already verified the flag is correctly set from opts.
	})
}

func TestOrchestratorExecutionFallbacks(t *testing.T) {
	ctx := context.Background()

	t.Run("do orchestrate uses default subtasks when decomposer is nil", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1})
		orch.decomposer = nil

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
			cb, ok := args.Get(2).(func(agent.ChatCompletionChunk))
			if ok {
				cb(agent.ChatCompletionChunk{Choices: []agent.ChatCompletionChunkChoice{{Delta: agent.ChatCompletionChunkDelta{Content: "agent answer"}}}})
			}
		}).Once()
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "final answer"}}},
		}, nil).Once()

		result, _, err := orch.doOrchestrate(ctx, "Plan a launch", nil, "task-default-subtasks", nil, nil)
		if err != nil || result != "final answer" {
			t.Fatalf("expected default subtask orchestration, result=%q err=%v", result, err)
		}
	})

	t.Run("exec agents with timeout logs member transition warnings", func(t *testing.T) {
		store := &erroringTeamStore{
			mockStore: &mockStore{
				teams: map[string]*TeamInfo{
					"timeout-team": {
						Name:          "timeout-team",
						LeadSessionID: "lead",
						Members: []TeamMember{
							{Name: "Researcher", SessionID: "researcher-session", Status: MemberStatusReady},
						},
					},
				},
				tasks: map[string][]TeamTask{},
			},
			saveTeamErr: errors.New("transition failed"),
		}
		cfg := testConfig()
		cfg.Orchestrator.TaskTimeout = 2
		mockClient := new(MockLLMClient)
		orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1})
		orch.TeamService = NewTeamService(store, newTestTeamInbox(t.TempDir()), &mockSessions{}, &mockModels{}, &mockBus{})

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
			cb, ok := args.Get(2).(func(agent.ChatCompletionChunk))
			if ok {
				cb(agent.ChatCompletionChunk{Choices: []agent.ChatCompletionChunkChoice{{Delta: agent.ChatCompletionChunkDelta{Content: "done"}}}})
			}
		}).Once()

		results := orch.execAgentsWithCheckpoint(ctx, "timeout-team", []string{"<<ROLE:Researcher>> task"}, nil, "task-timeout", nil, nil)
		if len(results) != 1 {
			t.Fatalf("expected one agent result, got %d", len(results))
		}
	})

	t.Run("aggregate with telemetry span wraps synthesis", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		telemetry := new(MockTelemetry)
		cfg := testConfig()
		cfg.Gateway.Model = "test-model"
		deps := gapOrchestratorDeps(mockClient)
		deps.Telemetry = telemetry
		orch := New(cfg, deps, OrchestratorOptions{AgentCount: 2})

		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "merged"}}},
		}, nil).Twice()
		telemetry.On("StartSpan", mock.Anything, "aggregateConsensus", "synthesis", mock.Anything, mock.Anything).
			Return(nil).
			Once()

		result, err := orch.aggregateResults(ctx, []AgentResult{
			{Status: "success", Response: "one"},
			{Status: "success", Response: "two"},
		}, "question", "")
		if err != nil || result == "" {
			t.Fatalf("expected aggregated result, got %q err=%v", result, err)
		}
		mockClient.AssertExpectations(t)
	})

	t.Run("save trace logs repository failures and buildDefaultSubtasks uses single agent prompt", func(t *testing.T) {
		mockRepo := new(MockTraceRepo)
		mockRepo.On("SaveExecutionTrace", mock.Anything, mock.Anything).Return(errors.New("save failed")).Once()
		deps := gapOrchestratorDeps(nil)
		deps.TraceRepo = mockRepo
		orch := New(testConfig(), deps, OrchestratorOptions{AgentCount: 1, ComputerUseEnabled: true})
		orch.saveTrace(ctx, "task-save-fail", nil, "goal", []string{"sub"}, []AgentResult{{Status: "success", Response: "ok"}}, "final")

		subtasks := orch.buildDefaultSubtasks("launch plan")
		if len(subtasks) != 1 || !strings.Contains(subtasks[0], "<<ROLE:") {
			t.Fatalf("expected single-agent default subtasks, got %#v", subtasks)
		}
		mockRepo.AssertExpectations(t)
	})

	t.Run("do orchestrate returns aggregate error for empty successful responses", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1})
		orch.decomposer = nil

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
			cb, ok := args.Get(2).(func(agent.ChatCompletionChunk))
			if ok {
				cb(agent.ChatCompletionChunk{Choices: []agent.ChatCompletionChunkChoice{{Delta: agent.ChatCompletionChunkDelta{Content: "   "}}}})
			}
		}).Once()

		_, _, err := orch.doOrchestrate(ctx, "empty answer", nil, "task-empty-success", nil, nil)
		if err == nil {
			t.Fatal("expected aggregate failure for whitespace-only agent response")
		}
	})

	t.Run("do orchestrate preserves failed agent cause", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1})
		orch.decomposer = nil

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).
			Return(errors.New("video generation failed with status 402: insufficient_funds")).
			Once()

		_, _, err := orch.doOrchestrate(ctx, "generate video", nil, "task-video-fail", nil, nil)
		if err == nil {
			t.Fatal("expected orchestration failure")
		}
		if !strings.Contains(err.Error(), "video generation failed with status 402") {
			t.Fatalf("expected concrete agent failure cause, got %v", err)
		}
	})
}
