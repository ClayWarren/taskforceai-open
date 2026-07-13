package orchestrator

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestRunAgentParallel(t *testing.T) {
	cfg := config.Config{
		Gateway: config.GatewayConfig{Model: "gpt-4"},
	}

	budgetLimit := 10
	ctx := context.Background()

	t.Run("Successful run", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orchDeps := gapOrchestratorDeps(mockClient, &budgetLimit)
		orch := New(cfg, orchDeps, OrchestratorOptions{AgentCount: 1, Silent: true})
		pt := NewProgressTracker()
		pt.Initialize(1)
		deps := &AgentRunnerDeps{
			Config:          cfg,
			Orchestrator:    orch,
			UsageTracker:    NewUsageTracker(),
			ProgressTracker: pt,
			Budget:          NewBudgetManager(&budgetLimit),
		}

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
			onChunk, ok := args.Get(2).(func(agent.ChatCompletionChunk))
			assert.True(t, ok)
			if !ok {
				return
			}
			onChunk(agent.ChatCompletionChunk{
				Choices: []agent.ChatCompletionChunkChoice{
					{Delta: agent.ChatCompletionChunkDelta{Content: "Subtask result"}},
				},
			})
		}).Once()

		result := RunAgentParallel(ctx, deps, 0, "test subtask")
		assert.Equal(t, "success", result.Status)
		assert.Equal(t, "Subtask result", result.Response)
	})

	t.Run("Agent failure", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orchDeps := gapOrchestratorDeps(mockClient, &budgetLimit)
		orch := New(cfg, orchDeps, OrchestratorOptions{AgentCount: 1, Silent: true})
		pt := NewProgressTracker()
		pt.Initialize(1)
		deps := &AgentRunnerDeps{
			Config:          cfg,
			Orchestrator:    orch,
			UsageTracker:    NewUsageTracker(),
			ProgressTracker: pt,
			Budget:          NewBudgetManager(&budgetLimit),
		}

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(assert.AnError).Once()

		result := RunAgentParallel(ctx, deps, 0, "test subtask")
		assert.Equal(t, "error", result.Status)
		assert.Contains(t, result.Response, "Error")
	})

	t.Run("Cache hit", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orchDeps := gapOrchestratorDeps(mockClient, &budgetLimit)
		orch := New(cfg, orchDeps, OrchestratorOptions{AgentCount: 1, Silent: true})
		pt := NewProgressTracker()
		pt.Initialize(1)
		deps := &AgentRunnerDeps{
			Config:          cfg,
			Orchestrator:    orch,
			UsageTracker:    NewUsageTracker(),
			ProgressTracker: pt,
			Budget:          NewBudgetManager(&budgetLimit),
		}

		mockCache := &MockCache{Data: make(map[string]string)}
		llmCache := cache.NewLLMCache(mockCache)

		deps.LLMCache = llmCache
		deps.CacheNamespace = "test-ns"
		deps.Config.SystemPrompt = "prompt"

		// Pre-populate cache with the model-aware key used by agent runners.
		_ = llmCache.SetCachedAgentResponse(ctx, "test-ns", "cached subtask", agentCacheSystemPrompt("prompt", cfg.Gateway.Model), "cached response")

		result := RunAgentParallel(ctx, deps, 0, "cached subtask")
		assert.Equal(t, "success", result.Status)
		assert.Equal(t, "cached response", result.Response)

		// Ensure LLM was not called
		mockClient.AssertNotCalled(t, "CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("Generation model skips agent cache", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		genCfg := cfg
		genCfg.Gateway.Model = "google/gemini-2.5-flash-image"
		genCfg.SystemPrompt = "prompt"
		orchDeps := gapOrchestratorDeps(mockClient, &budgetLimit)
		orch := New(genCfg, orchDeps, OrchestratorOptions{AgentCount: 1, Silent: true})
		pt := NewProgressTracker()
		pt.Initialize(1)
		mockCache := &MockCache{Data: make(map[string]string)}
		llmCache := cache.NewLLMCache(mockCache)
		_ = llmCache.SetCachedAgentResponse(ctx, "test-ns", "cached subtask", agentCacheSystemPrompt("prompt", genCfg.Gateway.Model), "stale svg")
		deps := &AgentRunnerDeps{
			Config:          genCfg,
			Orchestrator:    orch,
			UsageTracker:    NewUsageTracker(),
			ProgressTracker: pt,
			Budget:          NewBudgetManager(&budgetLimit),
			LLMCache:        llmCache,
			CacheNamespace:  "test-ns",
		}

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(assert.AnError).Once()

		result := RunAgentParallel(ctx, deps, 0, "cached subtask")
		assert.Equal(t, "error", result.Status)
		assert.Contains(t, result.Response, "Error")
	})

	t.Run("Generated file request skips agent cache", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		fileCfg := cfg
		fileCfg.SystemPrompt = "prompt"
		orchDeps := gapOrchestratorDeps(mockClient, &budgetLimit)
		orch := New(fileCfg, orchDeps, OrchestratorOptions{AgentCount: 1, Silent: true})
		pt := NewProgressTracker()
		pt.Initialize(1)
		mockCache := &MockCache{Data: make(map[string]string)}
		llmCache := cache.NewLLMCache(mockCache)
		prompt := "Create an Excel file called planets.xlsx"
		_ = llmCache.SetCachedAgentResponse(ctx, "test-ns", prompt, agentCacheSystemPrompt("prompt", fileCfg.Gateway.Model), "stale copy/paste answer")
		deps := &AgentRunnerDeps{
			Config:          fileCfg,
			Orchestrator:    orch,
			UsageTracker:    NewUsageTracker(),
			ProgressTracker: pt,
			Budget:          NewBudgetManager(&budgetLimit),
			LLMCache:        llmCache,
			CacheNamespace:  "test-ns",
		}

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(assert.AnError).Once()

		result := RunAgentParallel(ctx, deps, 0, prompt)
		assert.Equal(t, "error", result.Status)
		assert.Contains(t, result.Response, "Error")
	})

	t.Run("Computer use skips agent cache", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		computerCfg := cfg
		computerCfg.SystemPrompt = "prompt"
		orchDeps := gapOrchestratorDeps(mockClient, &budgetLimit)
		orch := New(computerCfg, orchDeps, OrchestratorOptions{
			AgentCount:         1,
			Silent:             true,
			ComputerUseEnabled: true,
		})
		pt := NewProgressTracker()
		pt.Initialize(1)
		mockCache := &MockCache{Data: make(map[string]string)}
		llmCache := cache.NewLLMCache(mockCache)
		_ = llmCache.SetCachedAgentResponse(ctx, "test-ns", "take a screenshot", agentCacheSystemPrompt("prompt", computerCfg.Gateway.Model), "stale desktop response")
		deps := &AgentRunnerDeps{
			Config:          computerCfg,
			Orchestrator:    orch,
			UsageTracker:    NewUsageTracker(),
			ProgressTracker: pt,
			Budget:          NewBudgetManager(&budgetLimit),
			LLMCache:        llmCache,
			CacheNamespace:  "test-ns",
		}

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
			onChunk, ok := args.Get(2).(func(agent.ChatCompletionChunk))
			assert.True(t, ok)
			if !ok {
				return
			}
			onChunk(agent.ChatCompletionChunk{
				Choices: []agent.ChatCompletionChunkChoice{
					{Delta: agent.ChatCompletionChunkDelta{Content: "fresh desktop response"}},
				},
			})
		}).Once()

		result := RunAgentParallel(ctx, deps, 0, "take a screenshot")
		assert.Equal(t, "success", result.Status)
		assert.Equal(t, "fresh desktop response", result.Response)
		mockClient.AssertExpectations(t)
	})

	t.Run("Telemetry enabled", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		mockTel := new(MockTelemetry)
		orchDeps := gapOrchestratorDeps(mockClient, &budgetLimit)
		orch := New(cfg, orchDeps, OrchestratorOptions{AgentCount: 1, Silent: true})
		pt := NewProgressTracker()
		pt.Initialize(1)
		deps := &AgentRunnerDeps{
			Config:          cfg,
			Orchestrator:    orch,
			UsageTracker:    NewUsageTracker(),
			ProgressTracker: pt,
			Budget:          NewBudgetManager(&budgetLimit),
			Telemetry:       mockTel,
		}

		mockTel.On("StartSpan", mock.Anything, "orchestrator.runAgentParallel", "orchestrator.agent", mock.Anything, mock.Anything).Return(nil)
		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil)

		_ = RunAgentParallel(ctx, deps, 0, "test")
		mockTel.AssertExpectations(t)
	})

	t.Run("Full coverage: metrics, temperature, error reporting", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		mockErrReporter := new(MockErrorReporter)

		// Use config with temperature and system prompt
		temp := 0.7
		cfgWithTemp := cfg
		cfgWithTemp.Agent.Temperature = &temp
		cfgWithTemp.SystemPrompt = "prompt"

		tracker := NewUsageTracker()
		orchDeps := OrchestratorDeps{
			Client:       mockClient,
			UsageTracker: tracker,
			Budget:       NewBudgetManager(&budgetLimit),
		}
		orch := New(cfgWithTemp, orchDeps, OrchestratorOptions{AgentCount: 1, Silent: true})
		pt := NewProgressTracker()
		pt.Initialize(1)

		// Setup cache for population test
		mockCache := &MockCache{Data: make(map[string]string)}
		llmCache := cache.NewLLMCache(mockCache)

		deps := &AgentRunnerDeps{
			Config:          cfgWithTemp,
			Orchestrator:    orch,
			UsageTracker:    tracker,
			ProgressTracker: pt,
			Budget:          NewBudgetManager(&budgetLimit),
			ErrorReporter:   mockErrReporter,
			LLMCache:        llmCache,
			CacheNamespace:  "test-ns",
		}

		// 1. Error path with ErrorReporter
		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(assert.AnError).Once()
		mockErrReporter.On("CaptureException", mock.Anything, mock.Anything, mock.Anything).Return().Once()

		result := RunAgentParallel(ctx, deps, 0, "fail")
		assert.Equal(t, "error", result.Status)
		mockErrReporter.AssertExpectations(t)

		// 2. Success path with cache set and metrics
		// Note: We can't easily verify the anonymous logger functions without mocking Internal Agent plumbing
		// or using a real UsageTracker and checking its state.
		// However, we can verifying the Temperature config is passed if we could inspect NewGatewayAgent.
		// For now, we rely on the line execution.

		mockClient.On("CreateChatCompletionStream", mock.Anything, mock.Anything, mock.Anything).Return(nil).Run(func(args mock.Arguments) {
			onChunk, ok := args.Get(2).(func(agent.ChatCompletionChunk))
			assert.True(t, ok)
			if !ok {
				return
			}
			onChunk(agent.ChatCompletionChunk{
				Choices: []agent.ChatCompletionChunkChoice{
					{Delta: agent.ChatCompletionChunkDelta{Content: "result"}},
				},
			})
		}).Once()

		result2 := RunAgentParallel(ctx, deps, 0, "success")
		assert.Equal(t, "success", result2.Status)

		// Verify cache was set - iterate since key generation is complex
		found := false
		for _, v := range mockCache.Data {
			if v == "result" {
				found = true
				break
			}
		}
		assert.True(t, found, "Cache should contain result")
	})
}

// MockErrorReporter
type MockErrorReporter struct {
	mock.Mock
}

func (m *MockErrorReporter) CaptureException(ctx context.Context, err error, tags map[string]string) {
	m.Called(ctx, err, tags)
}

func (m *MockErrorReporter) CaptureMessage(ctx context.Context, msg string, tags map[string]string) {
	m.Called(ctx, msg, tags)
}
