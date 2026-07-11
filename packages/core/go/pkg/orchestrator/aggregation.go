package orchestrator

import (
	"context"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/platform"
)

func (o *TaskOrchestrator) aggregateResults(ctx context.Context, results []AgentResult, q string, taskID string) (string, error) {
	platform.GetLogger().Info("Aggregating results", "numResults", len(results), "agentCount", o.agentCount)
	successStrings := []string{}
	for _, r := range results {
		platform.GetLogger().Debug("Checking agent result",
			"agentId", r.AgentID,
			"agentName", r.AgentName,
			"status", r.Status,
			"responseLen", len(r.Response),
			"hasToolEvents", len(r.ToolEvents) > 0)

		response := strings.TrimSpace(r.Response)
		if r.Status == "success" && response != "" && !isNonUserFacingAnswer(response) {
			successStrings = append(successStrings, response)
		}
	}

	if len(successStrings) == 0 {
		if evidence := toolEvidenceResponse(results); evidence != "" {
			successStrings = append(
				successStrings,
				"Use the collected tool evidence to answer the user's request. Do not return internal team coordination messages.",
				evidence,
			)
		}
	}

	if len(successStrings) == 0 {
		platform.GetLogger().Warn("No usable agent responses found", "numResults", len(results), "agentCount", o.agentCount)
		return "", fmt.Errorf("no usable agent response: all successful agents returned empty results")
	}

	strategy := o.getAggregationStrategy(o.config.Orchestrator.AggregationStrategy, q)
	synthesis, err := strategy.Aggregate(ctx, successStrings, taskID)
	if err != nil {
		platform.GetLogger().Error("Aggregation failed, falling back to joined responses", "error", err)
		synthesis = strings.Join(successStrings, "\n\n")
	}

	if isNonUserFacingAnswer(synthesis) {
		fallback := longestResponse(successStrings)
		if fallback != "" {
			platform.GetLogger().Warn(
				"Synthesis returned a non-user-facing answer, returning longest agent response fallback",
				"fallbackLen", len(fallback),
				"numResults", len(successStrings),
				"taskId", taskID,
			)
			return fallback, nil
		}
	}

	if isGenerationModelID(o.config.Gateway.Model) {
		return synthesis, nil
	}
	if isGeneratedFileRequest(q) {
		return synthesis, nil
	}
	if o.computerUseEnabled {
		return synthesis, nil
	}
	if RequiresCurrentData(q) {
		return synthesis, nil
	}

	validated, err := o.validateAnswer(ctx, q, successStrings, synthesis, taskID)
	if err == nil {
		return validated, nil
	}

	fallback := longestResponse(successStrings)
	platform.GetLogger().Warn(
		"Validation rejected synthesized response, returning longest agent response fallback",
		"error", err,
		"fallbackLen", len(fallback),
		"numResults", len(successStrings),
		"taskId", taskID,
	)
	return fallback, nil
}

func longestResponse(responses []string) string {
	best := ""
	for _, response := range responses {
		if len(response) > len(best) {
			best = response
		}
	}
	return best
}

func isNonUserFacingAnswer(answer string) bool {
	normalized := strings.ToLower(strings.TrimSpace(answer))
	if normalized == "" {
		return false
	}
	return (strings.Contains(normalized, "i'm ready to help") &&
		strings.Contains(normalized, "what can i do for you")) ||
		(strings.Contains(normalized, "empty quotes") &&
			strings.Contains(normalized, "how can i help")) ||
		strings.Contains(normalized, "(no summary provided by model)") ||
		strings.HasPrefix(normalized, "[received message from ") ||
		strings.Contains(normalized, "team - we've been tasked") ||
		strings.Contains(normalized, "i've added ") && strings.Contains(normalized, " tasks to the board") ||
		strings.Contains(normalized, "i'm claiming task ")
}

func toolEvidenceResponse(results []AgentResult) string {
	if evidence := computerUseEvidenceResponse(results); evidence != "" {
		return evidence
	}
	return searchEvidenceResponse(results)
}

func computerUseEvidenceResponse(results []AgentResult) string {
	var lines []string
	for _, result := range results {
		if result.Status != "success" {
			continue
		}
		for _, event := range result.ToolEvents {
			if event.ToolName != "computer_use" || !event.Success {
				continue
			}
			action := strings.TrimSpace(fmt.Sprintf("%v", event.Arguments))
			if action == "" || action == "<nil>" {
				action = "computer action"
			}
			line := "- " + action
			if event.ImageBase64 != "" {
				line += " (captured desktop screenshot)"
			}
			if preview := strings.TrimSpace(event.ResultPreview); preview != "" {
				if len(preview) > 260 {
					preview = preview[:260]
				}
				line += " - " + preview
			}
			lines = append(lines, line)
			if len(lines) >= 12 {
				return "Computer-use evidence collected by agents:\n" + strings.Join(lines, "\n")
			}
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return "Computer-use evidence collected by agents:\n" + strings.Join(lines, "\n")
}

func searchEvidenceResponse(results []AgentResult) string {
	var lines []string
	seen := map[string]bool{}
	for _, result := range results {
		if result.Status != "success" {
			continue
		}
		for _, event := range result.ToolEvents {
			if event.ToolName != "search_web" || !event.Success {
				continue
			}
			for _, source := range event.Sources {
				line := formatSourceEvidence(source)
				if line == "" || seen[line] {
					continue
				}
				seen[line] = true
				lines = append(lines, line)
				if len(lines) >= 12 {
					return "Search evidence collected by agents:\n" + strings.Join(lines, "\n")
				}
			}
			if len(event.Sources) == 0 {
				preview := strings.TrimSpace(event.ResultPreview)
				if preview == "" {
					continue
				}
				if len(preview) > 800 {
					preview = preview[:800]
				}
				line := "- Search result preview: " + preview
				if seen[line] {
					continue
				}
				seen[line] = true
				lines = append(lines, line)
				if len(lines) >= 6 {
					return "Search evidence collected by agents:\n" + strings.Join(lines, "\n")
				}
			}
		}
	}
	if len(lines) == 0 {
		return ""
	}
	return "Search evidence collected by agents:\n" + strings.Join(lines, "\n")
}

func formatSourceEvidence(source agent.SourceReference) string {
	title := strings.TrimSpace(source.Title)
	snippet := strings.TrimSpace(source.Snippet)
	url := strings.TrimSpace(source.URL)
	if title == "" && snippet == "" && url == "" {
		return ""
	}
	if snippet != "" && len(snippet) > 260 {
		snippet = snippet[:260]
	}
	parts := []string{"-"}
	if title != "" {
		parts = append(parts, title)
	}
	if snippet != "" {
		parts = append(parts, "- "+snippet)
	}
	if url != "" {
		parts = append(parts, "("+url+")")
	}
	return strings.Join(parts, " ")
}

type IAggregationStrategy interface {
	Aggregate(ctx context.Context, results []string, taskID string) (string, error)
}

func (o *TaskOrchestrator) getAggregationStrategy(_ string, userInput string) IAggregationStrategy {
	return &ConsensusAggregationStrategy{orch: o, userInput: userInput}
}

type ConsensusAggregationStrategy struct {
	orch      *TaskOrchestrator
	userInput string
}

func (s *ConsensusAggregationStrategy) Aggregate(ctx context.Context, rs []string, taskID string) (string, error) {
	if s.orch.telemetry != nil {
		var result string
		err := s.orch.telemetry.StartSpan(ctx, "aggregateConsensus", "synthesis", nil, func(ctx context.Context) error {
			res, aggErr := s.doAggregate(ctx, rs, taskID)
			result = res
			return aggErr
		})
		return result, err
	}
	return s.doAggregate(ctx, rs, taskID)
}

func (s *ConsensusAggregationStrategy) doAggregate(ctx context.Context, rs []string, taskID string) (string, error) {
	if len(rs) == 1 {
		return rs[0], nil
	}

	skipSynthesisCache := RequiresCurrentData(s.userInput) || isGeneratedFileRequest(s.userInput)
	if s.orch.llmCache != nil && !skipSynthesisCache {
		cached := s.orch.llmCache.GetCachedSynthesis(ctx, s.orch.namespace, rs)
		if cached.Ok {
			return cached.Value, nil
		}
	}

	synthesisPrompt := s.orch.config.Orchestrator.SynthesisPrompt
	synthesisPrompt = strings.ReplaceAll(synthesisPrompt, "{num_responses}", fmt.Sprintf("%d", len(rs)))
	synthesisPrompt = strings.ReplaceAll(synthesisPrompt, "{user_input}", s.userInput)

	agentResponses := BuildAgentResponsesSection(rs)
	synthesisPrompt = strings.ReplaceAll(synthesisPrompt, "{agent_responses}", agentResponses)

	var result string
	err := s.orch.budget.WithBudget("result synthesis", func() error {
		var llmErr error
		result, llmErr = s.orch.runSinglePrompt(ctx, s.orch.config, "result synthesis", synthesisPrompt, taskID)
		if llmErr != nil {
			return llmErr
		}
		if result == "" {
			return fmt.Errorf("synthesis returned empty response")
		}
		return nil
	})

	if err != nil {
		platform.GetLogger().Error("Synthesis failed, using longest response fallback", "error", err)
		best := longestResponse(rs)
		if best == "" {
			return "", fmt.Errorf("all agents failed and synthesis failed")
		}
		return best, nil
	}

	if s.orch.llmCache != nil && !skipSynthesisCache {
		if err := s.orch.llmCache.SetCachedSynthesis(ctx, s.orch.namespace, rs, result); err != nil {
			platform.GetLogger().Warn("Failed to cache synthesis result", "namespace", s.orch.namespace, "resultCount", len(rs), "resultLength", len(result), "error", err)
		}
	}

	return result, nil
}

func (o *TaskOrchestrator) validateAnswer(ctx context.Context, q string, rs []string, ans string, taskID string) (string, error) {
	if IsAnswerEmpty(ans) {
		return "", fmt.Errorf("no usable agent response: all agents returned empty results")
	}

	isMath := IsMathEvaluationQuery(q)
	sci := RequiresScienceReference(q)

	valCfg := BuildValidatorConfig(o.config, isMath)
	prompt := BuildValidationPrompt(ValidationPromptParams{
		IsMathEval:              isMath,
		UserInput:               q,
		CandidateAnswer:         ans,
		AgentResponsesSection:   BuildAgentResponsesSection(rs),
		SearchEvidenceSection:   CollectSearchEvidence(o.usageTracker.GetToolUsage(), sci),
		RequireScienceReference: sci,
	})

	var validatedAns string
	err := o.budget.WithBudget("answer validation", func() error {
		var llmErr error
		validatedAns, llmErr = o.runSinglePrompt(ctx, valCfg, "answer validation", prompt, taskID)
		if llmErr != nil {
			return llmErr
		}
		if validatedAns == "" {
			return fmt.Errorf("validation returned empty response")
		}
		return nil
	})

	if err != nil {
		platform.GetLogger().Warn("Validation failed, returning unvalidated answer", "error", err)
		return ans, nil
	}

	return AppendMathFormatting(validatedAns, isMath), nil
}

func (o *TaskOrchestrator) runSinglePrompt(ctx context.Context, cfg config.Config, stage string, prompt string, taskID string) (string, error) {
	cfg.Agent.MaxIterations = 1
	opts := agent.AgentOptions{
		AgentLabel:       stage,
		RawSystemPrompt:  true,
		TaskID:           taskID,
		ApprovalRegistry: o.approvalReg,
		UsageLogger: agent.UsageLogger(func(p agent.UsagePayload) {
			o.usageTracker.RecordTokenUsage(p.Stage, p.Usage, p.Model)
		}),
	}
	a := agent.NewGatewayAgent(cfg, o.client, opts)
	return a.Run(ctx, prompt, nil)
}
