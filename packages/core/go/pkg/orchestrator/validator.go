package orchestrator

import (
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
)

const MathPrompt = "You are a meticulous math and science validator. Your goal is to ensure the final answer is technically accurate and supported by the reasoning. Present the final result clearly at the end of your response."

const GenPrompt = "You are a helpful assistant reviewing and validating the synthesized response. Check for accuracy, completeness, and clarity."

func BuildValidatorConfig(c config.Config, isMath bool) config.Config {
	newCfg := c
	if isMath {
		newCfg.SystemPrompt = MathPrompt
	} else {
		newCfg.SystemPrompt = GenPrompt
	}

	maxIter := min(c.Agent.MaxIterations, 2)
	newCfg.Agent.MaxIterations = maxIter
	return newCfg
}

func BuildAgentResponsesSection(rs []string) string {
	var sb strings.Builder
	for i, r := range rs {
		if i > 0 {
			sb.WriteString("\n\n")
		}
		fmt.Fprintf(&sb, "=== Agent %d Response ===\n%s", i+1, r)
	}
	return sb.String()
}

func CollectSearchEvidence(evs []agent.ToolEvent, required bool) string {
	if !required {
		return ""
	}

	var searchEvs []string
	count := 1
	for _, e := range evs {
		if e.ToolName == "search_web" && e.Success {
			query := fmt.Sprintf("%v", e.Arguments)
			preview := e.ResultPreview
			if preview == "" {
				preview = "see tool output"
			}
			searchEvs = append(searchEvs, fmt.Sprintf("- Search %d: query=%q -> %s", count, query, preview))
			count++
		}
	}

	if len(searchEvs) == 0 {
		return "[No successful search_web calls recorded for this prompt.]"
	}
	return strings.Join(searchEvs, "\n")
}

type ValidationPromptParams struct {
	IsMathEval              bool
	UserInput               string
	CandidateAnswer         string
	AgentResponsesSection   string
	SearchEvidenceSection   string
	RequireScienceReference bool
}

// IsAnswerEmpty reports whether the candidate answer has no usable content.
func IsAnswerEmpty(ans string) bool {
	return strings.TrimSpace(ans) == ""
}

func BuildValidationPrompt(p ValidationPromptParams) string {
	var task []string
	if p.IsMathEval {
		task = []string{
			"- Verify all reasoning and calculations.",
			"- If the proposed answer is incorrect, correct it.",
			"- Ensure the final result is prominent and easy to find.",
		}
	} else {
		task = []string{
			"- Read the synthesized answer carefully.",
			"- If the answer is accurate, return it as-is.",
			"- If there are factual errors, improve it.",
		}
	}

	var sb strings.Builder
	sb.WriteString("QUESTION:\n")
	sb.WriteString(p.UserInput)
	sb.WriteString("\n\nANSWER:\n")
	sb.WriteString(p.CandidateAnswer)
	sb.WriteString("\n\nTASK:\n")
	for _, t := range task {
		sb.WriteString(t)
		sb.WriteString("\n")
	}

	return sb.String()
}

func AppendMathFormatting(v string, isMath bool) string {
	return v
}
