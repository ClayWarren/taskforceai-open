package orchestrator

import (
	"context"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestAgentRunnerCallbacksCoverage(t *testing.T) {
	// We want to trigger usageLogger and toolLogger callbacks in doRunAgentParallel
	// They are passed to agent.NewGatewayAgent -> opts.
	// We mock stream to return usage and tool calls.

	mockClient := new(MockLLMClient)
	usageTracker := NewUsageTracker()
	cfg := config.Config{}
	budget := 1000

	deps := &AgentRunnerDeps{
		Config:          cfg,
		UsageTracker:    usageTracker,
		ProgressTracker: NewProgressTracker(),
		Budget:          NewBudgetManager(&budget),
	}
	deps.ProgressTracker.Initialize(1)

	// Helper wrapper:
	mockOrch := &TaskOrchestrator{client: mockClient}
	deps.Orchestrator = mockOrch

	ctx := context.Background()

	// 1. First Call: 2 Messages (System + User). Returns Tool Call.
	mockClient.On("CreateChatCompletionStream", mock.Anything, mock.MatchedBy(func(params agent.ChatCompletionCreateParams) bool {
		return len(params.Messages) == 2
	}), mock.Anything).Return(nil).Run(func(args mock.Arguments) {
		cb, ok := args.Get(2).(func(agent.ChatCompletionChunk))
		assert.True(t, ok)
		if !ok {
			return
		}

		// Send Usage
		cb(agent.ChatCompletionChunk{Usage: &agent.ChatCompletionUsage{TotalTokens: 10}})

		// Send Tool Call
		toolCall := agent.ToolCall{
			Type:     "function",
			Function: agent.ToolCallFunction{Name: "test_tool", Arguments: "{}"},
		}

		cb(agent.ChatCompletionChunk{
			Choices: []agent.ChatCompletionChunkChoice{{
				Delta: agent.ChatCompletionChunkDelta{
					ToolCalls: []agent.ToolCall{toolCall},
				},
			}},
		})
	}).Once()

	// 2. Second Call: 4 Messages (System + User + Asst + Tool). Returns Final Answer.
	mockClient.On("CreateChatCompletionStream", mock.Anything, mock.MatchedBy(func(params agent.ChatCompletionCreateParams) bool {
		return len(params.Messages) >= 3 // Allow flexible exact count if logic changes, but definitely > 2
	}), mock.Anything).Return(nil).Run(func(args mock.Arguments) {
		cb, ok := args.Get(2).(func(agent.ChatCompletionChunk))
		assert.True(t, ok)
		if !ok {
			return
		}
		cb(agent.ChatCompletionChunk{
			Choices: []agent.ChatCompletionChunkChoice{{
				Delta: agent.ChatCompletionChunkDelta{Content: "Final Answer"},
			}},
		})
	}).Once()

	// We can't easily verify the callbacks were called since they update local vars or internal state we can't inspect easily?
	// Wait, deps.UsageTracker IS inspected!
	// We can assertions on usageTracker.

	// Run
	RunAgentParallel(ctx, deps, 0, "subtask")

	// Verify UsageTracker got tokens
	// UsageTracker.GetTokenUsageSummary()
	// Verify UsageTracker got tokens
	records, _ := usageTracker.GetTokenUsageSummary()
	found := false
	for _, r := range records {
		if r.Stage == "agent-1" {
			assert.Equal(t, 10, r.TotalTokens)
			found = true
			break
		}
	}
	assert.True(t, found, "Expected to find usage record for agent-1")

	// Verify Tool Usage
	tools := usageTracker.GetToolUsage()
	assert.NotEmpty(t, tools)
}
