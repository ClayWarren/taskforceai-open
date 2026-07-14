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

func TestAggregationCacheSetError(t *testing.T) {
	mockClient := new(MockLLMClient)
	mockCache := new(GapMockCache)
	cfg := config.Config{}
	budget := 1000

	orchDeps := OrchestratorDeps{
		Client:       mockClient,
		Cache:        mockCache,
		Budget:       NewBudgetManager(&budget),
		UsageTracker: NewUsageTracker(),
	}

	o := New(cfg, orchDeps, OrchestratorOptions{AgentCount: 2, CacheNamespace: "test"})
	strategy := &ConsensusAggregationStrategy{orch: o}

	// 1. GetCachedSynthesis misses
	mockCache.On("Get", mock.Anything, mock.Anything).Return("", fmt.Errorf("miss"))

	// 2. Synthesis LLM succeeds
	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "synth_res"}}},
	}, nil).Once()

	// 4. SetCachedSynthesis fails (but error is ignored code side)
	mockCache.On("Set", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(fmt.Errorf("set fail"))

	res, err := strategy.Aggregate(context.Background(), []string{"a", "b"}, "")
	require.NoError(t, err)
	assert.Equal(t, "synth_res", res)

	mockCache.AssertExpectations(t)
	mockClient.AssertExpectations(t)
}

func TestBuildDefaultSubtasks_AllRoles(t *testing.T) {
	orch := New(testConfig(), gapOrchestratorDeps(nil), OrchestratorOptions{})

	qs := orch.buildDefaultSubtasks("Test query")

	if len(qs) != 4 {
		t.Fatalf("expected 4 subtasks, got %d", len(qs))
	}

	expectedRoles := []string{"Researcher", "Analyst", "Skeptic", "Pragmatist"}
	for i, expected := range expectedRoles {
		role, _, _ := parseSubtaskOverrides(qs[i])
		if role != expected {
			t.Errorf("subtask %d: role = %q, want %q", i, role, expected)
		}
	}
}

func TestBuildDefaultSubtasks_IncludesMemories(t *testing.T) {
	orch := New(testConfig(), OrchestratorDeps{}, OrchestratorOptions{
		Memories: []string{"User prefers Go", "User is a backend dev"},
	})

	qs := orch.buildDefaultSubtasks("How should I build an API?")

	for i, q := range qs {
		if !strings.Contains(q, "User prefers Go") {
			t.Errorf("subtask %d does not contain memory", i)
		}
	}
}

func TestBuildDefaultSubtasks_IncludesQuery(t *testing.T) {
	orch := New(testConfig(), gapOrchestratorDeps(nil), OrchestratorOptions{})

	qs := orch.buildDefaultSubtasks("What is Go?")

	for i, q := range qs {
		if !strings.Contains(q, "What is Go?") {
			t.Errorf("subtask %d does not contain original query", i)
		}
	}
}

func TestDoAggregateCoverageGapPaths(t *testing.T) {
	ctx := context.Background()

	t.Run("returns single response without synthesis", func(t *testing.T) {
		strategy := &ConsensusAggregationStrategy{orch: New(testConfig(), gapOrchestratorDeps(new(MockLLMClient)), OrchestratorOptions{})}
		got, err := strategy.doAggregate(ctx, []string{"only"}, "task-1")
		if err != nil || got != "only" {
			t.Fatalf("expected single response passthrough, got %q err=%v", got, err)
		}
	})

	t.Run("successful synthesis caches result", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		mockCache := &MockCache{Data: map[string]string{}}
		cfg := testConfig()
		cfg.Orchestrator.SynthesisPrompt = "Combine {agent_responses}"
		deps := gapOrchestratorDeps(mockClient)
		deps.Cache = mockCache
		orch := New(cfg, deps, OrchestratorOptions{CacheNamespace: "cache-ns"})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "merged answer"}}},
		}, nil).Once()

		strategy := &ConsensusAggregationStrategy{orch: orch}
		got, err := strategy.doAggregate(ctx, []string{"alpha", "beta"}, "task-cache")
		if err != nil || got != "merged answer" {
			t.Fatalf("expected synthesized answer, got %q err=%v", got, err)
		}
		llmCache := cache.NewLLMCache(mockCache)
		cached := llmCache.GetCachedSynthesis(ctx, "cache-ns", []string{"alpha", "beta"})
		if !cached.Ok || cached.Value != "merged answer" {
			t.Fatalf("expected synthesis cache entry, got %#v", cached)
		}
	})

	t.Run("current data synthesis bypasses stale cache and includes user request", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		mockCache := &MockCache{Data: map[string]string{}}
		cfg := testConfig()
		cfg.Orchestrator.SynthesisPrompt = "Request: {user_input}\nResponses:\n{agent_responses}"
		deps := gapOrchestratorDeps(mockClient)
		deps.Cache = mockCache
		orch := New(cfg, deps, OrchestratorOptions{CacheNamespace: "cache-ns"})
		llmCache := cache.NewLLMCache(mockCache)
		require.NoError(t, llmCache.SetCachedSynthesis(ctx, "cache-ns", []string{"alpha", "beta"}, "stale cached answer"))

		mockClient.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(req agent.ChatCompletionCreateParams) bool {
			return strings.Contains(req.Messages[len(req.Messages)-1].Content, "latest AI news today")
		})).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "fresh answer"}}},
		}, nil).Once()

		strategy := &ConsensusAggregationStrategy{orch: orch, userInput: "latest AI news today"}
		got, err := strategy.doAggregate(ctx, []string{"alpha", "beta"}, "task-cache")
		if err != nil || got != "fresh answer" {
			t.Fatalf("expected fresh synthesized answer, got %q err=%v", got, err)
		}
		cached := llmCache.GetCachedSynthesis(ctx, "cache-ns", []string{"alpha", "beta"})
		if !cached.Ok || cached.Value != "stale cached answer" {
			t.Fatalf("expected current-data synthesis to leave existing cache untouched, got %#v", cached)
		}
	})

	t.Run("generic synthesis falls back to substantive agent response", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		cfg := testConfig()
		cfg.Orchestrator.SynthesisPrompt = "Request: {user_input}\nResponses:\n{agent_responses}"
		orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "Hello! I'm ready to help you. What can I do for you today?"}}},
		}, nil).Once()

		got, err := orch.aggregateResults(ctx, []AgentResult{
			{
				AgentID:  1,
				Status:   "success",
				Response: "Here is the current AI news summary with several concrete developments across models, regulation, infrastructure, and product launches.",
			},
			{
				AgentID:  2,
				Status:   "success",
				Response: "AI news: policy, foundation models, and hardware updates are the key themes.",
			},
		}, "Biggest news in AI", "task-generic-synthesis")
		if err != nil || !strings.Contains(got, "current AI news summary") {
			t.Fatalf("expected substantive agent response fallback, got %q err=%v", got, err)
		}
	})

	t.Run("current data synthesis falls back when model sees empty quotes", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		cfg := testConfig()
		cfg.Orchestrator.SynthesisPrompt = "Request: {user_input}\nResponses:\n{agent_responses}"
		orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "I see you've entered empty quotes. How can I help you today?"}}},
		}, nil).Once()

		got, err := orch.aggregateResults(ctx, []AgentResult{
			{
				AgentID:  1,
				Status:   "success",
				Response: "The biggest AI news today is a major frontier model release, fresh safety-policy reaction, and new infrastructure commitments from leading labs.",
			},
			{
				AgentID:  2,
				Status:   "success",
				Response: "AI news today centers on model launches, chip supply, and regulatory moves.",
			},
		}, "Biggest news in AI today", "task-empty-quotes-synthesis")
		if err != nil || !strings.Contains(got, "biggest AI news today") {
			t.Fatalf("expected substantive agent response fallback, got %q err=%v", got, err)
		}
	})

	t.Run("tool evidence is synthesized when agent responses are internal chatter", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		cfg := testConfig()
		cfg.Orchestrator.SynthesisPrompt = "Request: {user_input}\nResponses:\n{agent_responses}"
		orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(req agent.ChatCompletionCreateParams) bool {
			content := req.Messages[len(req.Messages)-1].Content
			return strings.Contains(content, "Search evidence collected by agents") &&
				strings.Contains(content, "Reuters AI News")
		})).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "Current AI news summary from verified search evidence."}}},
		}, nil).Once()

		got, err := orch.aggregateResults(ctx, []AgentResult{
			{
				AgentID: 1,
				Status:  "success",
				Response: "Agent completed task using tools: search_web, team_tasks. " +
					"(No summary provided by model)",
				ToolEvents: []agent.ToolEvent{{
					ToolName: "search_web",
					Success:  true,
					Sources: []agent.SourceReference{{
						Title:   "Reuters AI News",
						URL:     "https://www.reuters.com/technology/artificial-intelligence/",
						Snippet: "Latest headlines and developments in artificial intelligence.",
					}},
				}},
			},
			{
				AgentID:  2,
				Status:   "success",
				Response: "[Received message from Agent-1: Team - we've been tasked with researching current AI news. I've added 3 tasks to the board.]",
			},
		}, "What are the biggest current AI news stories?", "task-tool-evidence")
		if err != nil || got != "Current AI news summary from verified search evidence." {
			t.Fatalf("expected synthesized search evidence answer, got %q err=%v", got, err)
		}
	})

	t.Run("computer use evidence is synthesized before unrelated search evidence", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		cfg := testConfig()
		cfg.Orchestrator.SynthesisPrompt = "Request: {user_input}\nResponses:\n{agent_responses}"
		orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{})
		orch.computerUseEnabled = true
		mockClient.On("CreateChatCompletion", mock.Anything, mock.MatchedBy(func(req agent.ChatCompletionCreateParams) bool {
			content := req.Messages[len(req.Messages)-1].Content
			return strings.Contains(content, "Computer-use evidence collected by agents") &&
				strings.Contains(content, "captured desktop screenshot") &&
				!strings.Contains(content, "Reuters AI News")
		})).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "The virtual desktop shows a terminal window after the requested computer-use actions."}}},
		}, nil).Once()

		got, err := orch.aggregateResults(ctx, []AgentResult{{
			AgentID: 1,
			Status:  "success",
			Response: "Agent completed task using tools: search_web, computer_use. " +
				"(No summary provided by model)",
			ToolEvents: []agent.ToolEvent{
				{
					ToolName: "search_web",
					Success:  true,
					Sources: []agent.SourceReference{{
						Title: "Reuters AI News",
						URL:   "https://www.reuters.com/technology/artificial-intelligence/",
					}},
				},
				{
					ToolName:    "computer_use",
					Arguments:   map[string]any{"action": "screenshot"},
					Success:     true,
					ImageBase64: "encoded-screen",
				},
			},
		}}, "Use computer_use to inspect the desktop", "task-computer-evidence")
		if err != nil || !strings.Contains(got, "virtual desktop shows a terminal window") {
			t.Fatalf("expected synthesized computer-use evidence answer, got %q err=%v", got, err)
		}
	})

	t.Run("empty synthesis falls back to longest response", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, errors.New("synthesis failed")).Once()

		strategy := &ConsensusAggregationStrategy{orch: orch}
		got, err := strategy.doAggregate(ctx, []string{"short", "much longer answer"}, "task-fallback")
		if err != nil || got != "much longer answer" {
			t.Fatalf("expected longest-response fallback, got %q err=%v", got, err)
		}
	})

	t.Run("empty synthesis response falls back to longest answer", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		cfg := testConfig()
		cfg.Gateway.Model = "test-model"
		orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
			Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: ""}}},
		}, nil).Once()

		strategy := &ConsensusAggregationStrategy{orch: orch}
		got, err := strategy.doAggregate(ctx, []string{"a", "longer answer"}, "task-empty-response")
		if err != nil || got != "longer answer" {
			t.Fatalf("expected longest-response fallback for empty synthesis, got %q err=%v", got, err)
		}
	})

	t.Run("synthesis failure with empty responses returns error", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, errors.New("synthesis failed")).Once()

		strategy := &ConsensusAggregationStrategy{orch: orch}
		_, err := strategy.doAggregate(ctx, []string{"", ""}, "task-empty")
		if err == nil || !strings.Contains(err.Error(), "all agents failed") {
			t.Fatalf("expected synthesis failure with no usable fallback, got %v", err)
		}
	})

	t.Run("validate answer returns unvalidated answer when validation fails", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{})
		mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, errors.New("validation failed")).Once()

		got, err := orch.validateAnswer(ctx, "2+2", []string{"4"}, "4", "task-validate")
		if err != nil || got != "4" {
			t.Fatalf("expected unvalidated fallback answer, got %q err=%v", got, err)
		}
	})

	t.Run("validate answer rejects empty candidate", func(t *testing.T) {
		orch := New(testConfig(), gapOrchestratorDeps(new(MockLLMClient)), OrchestratorOptions{})
		_, err := orch.validateAnswer(ctx, "question", []string{"a"}, "   ", "task-empty")
		assert.Error(t, err)
	})
}
