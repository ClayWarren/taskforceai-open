package orchestrator

import (
	"testing"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/stretchr/testify/assert"
)

func TestValidator(t *testing.T) {
	t.Run("BuildValidatorConfig", func(t *testing.T) {
		cfg := config.Config{}
		cfg.Agent.MaxIterations = 5

		vCfg := BuildValidatorConfig(cfg, true)
		assert.Equal(t, MathPrompt, vCfg.SystemPrompt)
		assert.Equal(t, 2, vCfg.Agent.MaxIterations)

		vCfg2 := BuildValidatorConfig(cfg, false)
		assert.Equal(t, GenPrompt, vCfg2.SystemPrompt)
	})

	t.Run("BuildAgentResponsesSection", func(t *testing.T) {
		rs := []string{"res1", "res2"}
		got := BuildAgentResponsesSection(rs)
		assert.Contains(t, got, "=== Agent 1 Response ===\nres1")
		assert.Contains(t, got, "=== Agent 2 Response ===\nres2")
	})

	t.Run("CollectSearchEvidence", func(t *testing.T) {
		ev := []agent.ToolEvent{
			{ToolName: "search_web", Success: true, Arguments: "query1", ResultPreview: "preview1"},
		}
		got := CollectSearchEvidence(ev, true)
		assert.Contains(t, got, "query=\"query1\" -> preview1")

		got2 := CollectSearchEvidence(nil, true)
		assert.Contains(t, got2, "No successful search_web")
	})

	t.Run("BuildValidationPrompt", func(t *testing.T) {
		p := ValidationPromptParams{
			UserInput:       "q",
			CandidateAnswer: "a",
			IsMathEval:      true,
		}
		got := BuildValidationPrompt(p)
		assert.Contains(t, got, "QUESTION:\nq")
		assert.Contains(t, got, "ANSWER:\na")
		assert.Contains(t, got, "Ensure the final result is prominent")
	})

	t.Run("AppendMathFormatting", func(t *testing.T) {
		v := "The result is Final Answer: 42"
		got := AppendMathFormatting(v, true)
		assert.Equal(t, v, got)

		v2 := "Already \\boxed{42}"
		assert.Equal(t, v2, AppendMathFormatting(v2, true))
	})
}

func TestValidatorGapCoverage(t *testing.T) {
	t.Run("CollectSearchEvidence Required But Empty", func(t *testing.T) {
		events := []agent.ToolEvent{}
		res := CollectSearchEvidence(events, true)
		assert.Contains(t, res, "No successful search_web calls recorded")
	})

	t.Run("CollectSearchEvidence Empty Preview", func(t *testing.T) {
		events := []agent.ToolEvent{
			{
				ToolName:      "search_web",
				Success:       true,
				Arguments:     map[string]any{"query": "test"},
				ResultPreview: "",
			},
		}
		res := CollectSearchEvidence(events, true)
		assert.Contains(t, res, "see tool output")
	})

	t.Run("AppendMathFormatting Already Boxed", func(t *testing.T) {
		input := "Final Answer: 42. \\boxed{42}"
		res := AppendMathFormatting(input, true)
		assert.Equal(t, input, res)
	})

	t.Run("AppendMathFormatting No Capture", func(t *testing.T) {
		// "Final Answer:" present but no value after?
		input := "Final Answer:"
		res := AppendMathFormatting(input, true)
		assert.Equal(t, input, res)
	})

	t.Run("AppendMathFormatting Not Math", func(t *testing.T) {
		input := "Final Answer: 42"
		res := AppendMathFormatting(input, false)
		assert.Equal(t, input, res)
	})
}
