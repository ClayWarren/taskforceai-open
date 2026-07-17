package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
)

type LLMReportGenerator struct {
	client agent.ILLMClient
	config config.Config
}

func NewLLMReportGenerator(client agent.ILLMClient, cfg config.Config) *LLMReportGenerator {
	return &LLMReportGenerator{
		client: client,
		config: cfg,
	}
}

func (g *LLMReportGenerator) GenerateReport(ctx context.Context, trace *ExecutionTrace) (*ExecutionReport, error) {
	// 1. Prepare the prompt with trace data
	traceJSON, err := json.MarshalIndent(trace, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal execution trace: %w", err)
	}

	prompt := fmt.Sprintf(`You are a high-level Auditor and Report Generator for an AI Agent Task Force.
Analyze the following Execution Trace and produce a concise, human-readable report.

[EXECUTION TRACE]
%s

[INSTRUCTIONS]
Return a JSON object with the following fields:
- summary: A 2-3 sentence overview of what was accomplished.
- key_steps: An array of objects with {agent, action, observation} for the most impactful actions.
- decisions: An array of objects with {agent, rationale, outcome} for critical forks in logic.
- rubric: An object with:
    - accuracy: 0-5 (How factual/correct is the result?)
    - completeness: 0-5 (Did it answer all parts of the request?)
    - confidence: 0-5 (How sure is the system of this result?)
    - risk: "low", "medium", or "high"
    - human_review: boolean (Should a human check this specific result?)

Focus on clarity and truthfulness. If the agents struggled or failed, reflect that clearly.
ONLY return the JSON object.`, string(traceJSON))

	// 2. Call LLM
	temperature := 0.2
	opts := agent.AgentOptions{
		AgentLabel:      "report-generator",
		RawSystemPrompt: true,
		Temperature:     &temperature,
	}
	a := agent.NewGatewayAgent(g.config, g.client, opts)

	resp, err := a.Run(ctx, prompt, nil)
	if err != nil {
		return nil, fmt.Errorf("report generation: llm call failed: %w", err)
	}

	// 3. Parse result
	var report ExecutionReport
	// Find JSON block if LLM added markdown fluff
	cleanJSON := resp
	if start := strings.Index(resp, "{"); start != -1 {
		if end := strings.LastIndex(resp, "}"); end != -1 {
			cleanJSON = resp[start : end+1]
		}
	}

	if err := json.Unmarshal([]byte(cleanJSON), &report); err != nil {
		return nil, fmt.Errorf("report generation: failed to parse json: %w", err)
	}

	return &report, nil
}
