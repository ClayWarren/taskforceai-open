package orchestrator

import (
	"context"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/platform"
)

// compactResponses runs the orchestrator's configured ResponseCompactor,
// falling back to the raw responses if none is configured (e.g. a
// TaskOrchestrator constructed directly in a test without New()).
func (o *TaskOrchestrator) compactResponses(ctx context.Context, responses []string, taskID string) []string {
	if o == nil || o.responseCompactor == nil {
		return responses
	}
	return o.responseCompactor.Compact(ctx, responses, taskID)
}

// ResponseCompactor optionally shrinks a set of agent response strings
// before they're fed into synthesis/validation prompts, keeping those
// prompts within a manageable size regardless of agent count or how long
// any individual agent's response is. BuildAgentResponsesSection has no
// size limit of its own, so this is the only thing standing between a
// large fan-out task and an oversized synthesis prompt.
type ResponseCompactor interface {
	Compact(ctx context.Context, responses []string, taskID string) []string
}

const (
	defaultResponseCompactionBudget = 24_000 // combined chars across all agent responses
	minCharsPerResponse             = 800
)

// HeuristicResponseCompactor deterministically truncates individual
// responses to fit within a combined character budget. It never fails, so
// it's always safe to use directly or as a fallback.
type HeuristicResponseCompactor struct {
	MaxTotalChars int
}

func (h HeuristicResponseCompactor) Compact(_ context.Context, responses []string, _ string) []string {
	if len(responses) == 0 {
		return responses
	}
	budget := h.MaxTotalChars
	if budget <= 0 {
		budget = defaultResponseCompactionBudget
	}
	if totalLen(responses) <= budget {
		return responses
	}

	perResponse := budget / len(responses)
	if perResponse < minCharsPerResponse {
		perResponse = minCharsPerResponse
	}

	out := make([]string, len(responses))
	for i, r := range responses {
		out[i] = truncateResponse(r, perResponse)
	}
	return out
}

func totalLen(responses []string) int {
	total := 0
	for _, r := range responses {
		total += len(r)
	}
	return total
}

func truncateResponse(r string, maxChars int) string {
	runes := []rune(r)
	if len(runes) <= maxChars {
		return r
	}
	dropped := len(runes) - maxChars
	return string(runes[:maxChars]) + fmt.Sprintf("\n... [truncated %d characters]", dropped)
}

// LLMResponseCompactor summarizes over-budget agent responses with an LLM
// call using the CompactionPrompt, falling back to deterministic truncation
// for any response whose summarization call fails or returns empty - so a
// single failed summary never sinks the whole synthesis step.
type LLMResponseCompactor struct {
	Orchestrator *TaskOrchestrator
	Fallback     ResponseCompactor
}

func (c *LLMResponseCompactor) fallback() ResponseCompactor {
	if c.Fallback != nil {
		return c.Fallback
	}
	return HeuristicResponseCompactor{}
}

func (c *LLMResponseCompactor) Compact(ctx context.Context, responses []string, taskID string) []string {
	if len(responses) == 0 {
		return responses
	}
	if totalLen(responses) <= defaultResponseCompactionBudget {
		return responses
	}
	if c.Orchestrator == nil {
		return c.fallback().Compact(ctx, responses, taskID)
	}
	compactionPrompt := loadCompactionPromptFromProvider(c.Orchestrator.promptProvider)
	if compactionPrompt == "" {
		return c.fallback().Compact(ctx, responses, taskID)
	}

	perResponse := defaultResponseCompactionBudget / len(responses)
	if perResponse < minCharsPerResponse {
		perResponse = minCharsPerResponse
	}

	fallbackResponses := c.fallback().Compact(ctx, responses, taskID)
	compactionCfg := c.Orchestrator.config
	compactionCfg.SystemPrompt = compactionPrompt

	out := make([]string, len(responses))
	for i, r := range responses {
		if len(r) <= perResponse {
			out[i] = r
			continue
		}
		summary, err := c.Orchestrator.runSinglePrompt(ctx, compactionCfg, "response compaction", r, taskID)
		if err != nil || strings.TrimSpace(summary) == "" {
			platform.GetLogger().Warn("Response compaction failed, using truncated fallback", "error", err, "taskId", taskID)
			out[i] = fallbackResponses[i]
			continue
		}
		out[i] = summary
	}
	return out
}
