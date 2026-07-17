package orchestrator

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestHeuristicResponseCompactorNoOpUnderBudget(t *testing.T) {
	c := HeuristicResponseCompactor{MaxTotalChars: 1000}
	responses := []string{"short one", "short two"}
	out := c.Compact(context.Background(), responses, "task-1")
	assert.Equal(t, responses, out)
}

func TestHeuristicResponseCompactorEmptyInput(t *testing.T) {
	c := HeuristicResponseCompactor{}
	assert.Empty(t, c.Compact(context.Background(), nil, "task-1"))
}

func TestHeuristicResponseCompactorTruncatesOverBudget(t *testing.T) {
	c := HeuristicResponseCompactor{MaxTotalChars: 4000}
	responses := []string{strings.Repeat("a", 3000), strings.Repeat("b", 3000)}
	out := c.Compact(context.Background(), responses, "task-1")

	require.Len(t, out, 2)
	for _, r := range out {
		assert.Contains(t, r, "truncated")
		assert.Less(t, len(r), 3000)
	}
}

func TestHeuristicResponseCompactorRespectsMinimumFloor(t *testing.T) {
	// Budget so small relative to response count that a naive division would
	// truncate below minCharsPerResponse - the floor should still apply.
	c := HeuristicResponseCompactor{MaxTotalChars: 10}
	responses := make([]string, 20)
	for i := range responses {
		responses[i] = strings.Repeat("x", 2000)
	}
	out := c.Compact(context.Background(), responses, "task-1")
	require.Len(t, out, 20)
	for _, r := range out {
		assert.GreaterOrEqual(t, len(r), minCharsPerResponse)
	}
}

func TestLLMResponseCompactorNilOrchestratorUsesFallback(t *testing.T) {
	c := &LLMResponseCompactor{}
	responses := []string{strings.Repeat("a", defaultResponseCompactionBudget+1)}
	out := c.Compact(context.Background(), responses, "task-1")
	require.Len(t, out, 1)
	assert.Contains(t, out[0], "truncated")
}

func TestLLMResponseCompactorNoCompactionPromptUsesFallback(t *testing.T) {
	orch := New(testConfig(), gapOrchestratorDeps(nil), OrchestratorOptions{})
	c := &LLMResponseCompactor{Orchestrator: orch}
	responses := []string{strings.Repeat("a", defaultResponseCompactionBudget+1)}
	out := c.Compact(context.Background(), responses, "task-1")
	require.Len(t, out, 1)
	assert.Contains(t, out[0], "truncated")
}

func TestLLMResponseCompactorUnderBudgetIsNoOp(t *testing.T) {
	mockClient := new(MockLLMClient)
	deps := gapOrchestratorDeps(mockClient)
	deps.PromptProvider = testPromptProvider{compaction: "Summarize this."}
	orch := New(testConfig(), deps, OrchestratorOptions{})
	c := &LLMResponseCompactor{Orchestrator: orch}

	responses := []string{"short response one", "short response two"}
	out := c.Compact(context.Background(), responses, "task-1")

	assert.Equal(t, responses, out)
	mockClient.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
}

func TestLLMResponseCompactorSummarizesOverBudgetResponses(t *testing.T) {
	mockClient := new(MockLLMClient)
	deps := gapOrchestratorDeps(mockClient)
	deps.PromptProvider = testPromptProvider{compaction: "Summarize this."}
	orch := New(testConfig(), deps, OrchestratorOptions{})
	c := &LLMResponseCompactor{Orchestrator: orch}

	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "concise summary"}}},
	}, nil)

	long := strings.Repeat("a", defaultResponseCompactionBudget)
	short := "short response"
	out := c.Compact(context.Background(), []string{long, short}, "task-1")

	require.Len(t, out, 2)
	assert.Equal(t, "concise summary", out[0])
	assert.Equal(t, short, out[1], "responses already under the per-response budget are left untouched")
}

func TestLLMResponseCompactorFallsBackPerResponseOnSummarizationError(t *testing.T) {
	mockClient := new(MockLLMClient)
	deps := gapOrchestratorDeps(mockClient)
	deps.PromptProvider = testPromptProvider{compaction: "Summarize this."}
	orch := New(testConfig(), deps, OrchestratorOptions{})
	c := &LLMResponseCompactor{Orchestrator: orch}

	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(nil, errors.New("completion failed"))

	long := strings.Repeat("a", defaultResponseCompactionBudget)
	out := c.Compact(context.Background(), []string{long, long}, "task-1")

	require.Len(t, out, 2)
	for _, r := range out {
		assert.Contains(t, r, "truncated", "a failed summarization call must fall back to heuristic truncation, not drop the response")
	}
}

func TestCompactResponsesNilSafe(t *testing.T) {
	var orch *TaskOrchestrator
	responses := []string{"a", "b"}
	assert.Equal(t, responses, orch.compactResponses(context.Background(), responses, "task-1"))

	orch = &TaskOrchestrator{}
	assert.Equal(t, responses, orch.compactResponses(context.Background(), responses, "task-1"))
}

type spyResponseCompactor struct {
	calls     int
	responses []string
}

func (s *spyResponseCompactor) Compact(_ context.Context, responses []string, _ string) []string {
	s.calls++
	s.responses = responses
	return responses
}

func TestDoAggregateCallsThroughConfiguredCompactor(t *testing.T) {
	mockClient := new(MockLLMClient)
	orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 2})
	spy := &spyResponseCompactor{}
	orch.responseCompactor = spy

	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "synthesized answer"}}},
	}, nil)

	strategy := &ConsensusAggregationStrategy{orch: orch, userInput: "plain question"}
	_, err := strategy.doAggregate(context.Background(), []string{"first", "second"}, "task-1")

	require.NoError(t, err)
	assert.Equal(t, 1, spy.calls)
	assert.Equal(t, []string{"first", "second"}, spy.responses)
}
