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

type failingAggregationTelemetry struct{}

func (failingAggregationTelemetry) StartSpan(context.Context, string, string, map[string]any, func(context.Context) error) error {
	return errors.New("telemetry failed")
}

func TestAggregateResultsEmptySynthesisFallsBackToLongestAgentResponse(t *testing.T) {
	mockClient := new(MockLLMClient)
	orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 2})
	mockClient.On("CreateChatCompletion", mock.Anything, mock.Anything).Return(&agent.ChatCompletion{
		Choices: []agent.ChatCompletionChoice{{Message: agent.ChatCompletionMessage{Content: "   "}}},
	}, nil).Once()

	got, err := orch.aggregateResults(context.Background(), []AgentResult{
		{Status: "success", Response: "ok"},
		{Status: "success", Response: "fine"},
	}, "plain question", "task-validation-error")

	require.NoError(t, err)
	assert.Equal(t, "fine", got)
	mockClient.AssertExpectations(t)
}

func TestAggregateResultsStrategyErrorFallsBackToJoinedResponses(t *testing.T) {
	mockClient := new(MockLLMClient)
	deps := gapOrchestratorDeps(mockClient)
	deps.Telemetry = failingAggregationTelemetry{}
	orch := New(testConfig(), deps, OrchestratorOptions{AgentCount: 2, ComputerUseEnabled: true})

	got, err := orch.aggregateResults(context.Background(), []AgentResult{
		{Status: "success", Response: "first"},
		{Status: "success", Response: "second"},
	}, "inspect the desktop", "task-telemetry-fail")

	require.NoError(t, err)
	assert.Equal(t, "first\n\nsecond", got)
	mockClient.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
}

func TestAggregateResultsBypassesValidationForGenerationAndGeneratedFileRequests(t *testing.T) {
	ctx := context.Background()

	t.Run("generation model", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		cfg := testConfig()
		cfg.Gateway.Model = "gemini-2.5-flash-image-preview"
		orch := New(cfg, gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1})

		got, err := orch.aggregateResults(ctx, []AgentResult{{Status: "success", Response: "generated image ready"}}, "make an image", "task-image")

		require.NoError(t, err)
		assert.Equal(t, "generated image ready", got)
		mockClient.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
	})

	t.Run("generated file request", func(t *testing.T) {
		mockClient := new(MockLLMClient)
		orch := New(testConfig(), gapOrchestratorDeps(mockClient), OrchestratorOptions{AgentCount: 1})

		got, err := orch.aggregateResults(ctx, []AgentResult{{Status: "success", Response: "spreadsheet attached"}}, "create a spreadsheet", "task-file")

		require.NoError(t, err)
		assert.Equal(t, "spreadsheet attached", got)
		mockClient.AssertNotCalled(t, "CreateChatCompletion", mock.Anything, mock.Anything)
	})
}

func TestAggregationEvidenceEdges(t *testing.T) {
	t.Run("non user facing markers", func(t *testing.T) {
		assert.False(t, isNonUserFacingAnswer(""))
		assert.True(t, isNonUserFacingAnswer("Team - we've been tasked with updating the plan"))
		assert.True(t, isNonUserFacingAnswer("I've added 3 tasks to the board"))
		assert.True(t, isNonUserFacingAnswer("I'm claiming task 2 now"))
	})

	t.Run("computer evidence defaults truncates and caps", func(t *testing.T) {
		longPreview := strings.Repeat("x", 300)
		events := make([]agent.ToolEvent, 0, 14)
		events = append(events, agent.ToolEvent{ToolName: "computer_use", Success: true, ResultPreview: longPreview})
		for i := 0; i < 13; i++ {
			events = append(events, agent.ToolEvent{
				ToolName:    "computer_use",
				Success:     true,
				Arguments:   map[string]any{"action": "click"},
				ImageBase64: "screen",
			})
		}

		got := computerUseEvidenceResponse([]AgentResult{{Status: "success", ToolEvents: events}})

		require.Contains(t, got, "Computer-use evidence collected by agents:")
		assert.Contains(t, got, "- computer action - "+strings.Repeat("x", 260))
		assert.Contains(t, got, "(captured desktop screenshot)")
		assert.Len(t, strings.Split(strings.TrimSpace(got), "\n"), 13)
	})

	t.Run("search evidence skips failed and dedupes source lines", func(t *testing.T) {
		source := agent.SourceReference{Title: "Title", Snippet: strings.Repeat("s", 300), URL: "https://example.com"}
		got := searchEvidenceResponse([]AgentResult{
			{Status: "failed", ToolEvents: []agent.ToolEvent{{ToolName: "search_web", Success: true, Sources: []agent.SourceReference{source}}}},
			{Status: "success", ToolEvents: []agent.ToolEvent{
				{ToolName: "search_web", Success: false, Sources: []agent.SourceReference{source}},
				{ToolName: "search_web", Success: true, Sources: []agent.SourceReference{source, source}},
			}},
		})

		require.Contains(t, got, "Search evidence collected by agents:")
		assert.Contains(t, got, strings.Repeat("s", 260))
		assert.Len(t, strings.Split(strings.TrimSpace(got), "\n"), 2)
	})

	t.Run("search evidence caps unique sources", func(t *testing.T) {
		sources := make([]agent.SourceReference, 0, 13)
		for i := 0; i < 13; i++ {
			sources = append(sources, agent.SourceReference{Title: string(rune('A' + i))})
		}

		got := searchEvidenceResponse([]AgentResult{{Status: "success", ToolEvents: []agent.ToolEvent{
			{ToolName: "search_web", Success: true, Sources: sources},
		}}})

		assert.Len(t, strings.Split(strings.TrimSpace(got), "\n"), 13)
		assert.Contains(t, got, "- L")
		assert.NotContains(t, got, "- M")
	})

	t.Run("search preview truncates dedupes and caps", func(t *testing.T) {
		events := make([]agent.ToolEvent, 0, 8)
		events = append(events,
			agent.ToolEvent{ToolName: "search_web", Success: true},
			agent.ToolEvent{ToolName: "search_web", Success: true, ResultPreview: "duplicate preview"},
			agent.ToolEvent{ToolName: "search_web", Success: true, ResultPreview: "duplicate preview"},
		)
		for i := 0; i < 8; i++ {
			preview := strings.Repeat(string(rune('a'+i)), 900)
			events = append(events, agent.ToolEvent{ToolName: "search_web", Success: true, ResultPreview: preview})
		}

		got := searchEvidenceResponse([]AgentResult{{Status: "success", ToolEvents: events}})

		lines := strings.Split(strings.TrimSpace(got), "\n")
		assert.Len(t, lines, 7)
		assert.Contains(t, got, "- Search result preview: "+strings.Repeat("a", 800))
	})

	t.Run("format source falls back to snippet and url", func(t *testing.T) {
		assert.Empty(t, formatSourceEvidence(agent.SourceReference{}))
		assert.Equal(t, "- - snippet only", formatSourceEvidence(agent.SourceReference{Snippet: " snippet only "}))
		assert.Equal(t, "- (https://example.com)", formatSourceEvidence(agent.SourceReference{URL: " https://example.com "}))
	})
}
