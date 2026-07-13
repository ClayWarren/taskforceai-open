package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/TaskForceAI/core/pkg/agent"
	"github.com/TaskForceAI/core/pkg/cache"
	"github.com/TaskForceAI/core/pkg/config"
	"github.com/TaskForceAI/core/pkg/platform"
)

// TaskDecomposerDeps contains the minimal dependencies needed for task decomposition
type TaskDecomposerDeps struct {
	Client         agent.ILLMClient
	Config         config.Config
	Budget         *BudgetManager
	LLMCache       *cache.LLMCache
	CacheNamespace string
}

type TaskDecomposer struct {
	deps TaskDecomposerDeps
}

func NewTaskDecomposer(deps TaskDecomposerDeps) *TaskDecomposer {
	return &TaskDecomposer{deps: deps}
}

func (d *TaskDecomposer) GenerateSubtasks(ctx context.Context, userInput string, numAgents int) ([]string, error) {
	cacheKey := fmt.Sprintf("%s::%d", userInput, numAgents)

	// Skip cache for queries that need current/fresh data
	skipCache := RequiresCurrentData(userInput)

	if !skipCache && d.deps.LLMCache != nil {
		cached := d.deps.LLMCache.GetCachedDecomposition(ctx, d.deps.CacheNamespace, cacheKey)
		if cached.Ok && len(cached.Value) == numAgents {
			platform.GetLogger().Info("Decomposition cache HIT", "userInput", userInput[:min(50, len(userInput))])
			return cached.Value, nil
		}
	}

	if skipCache {
		platform.GetLogger().Info("Decomposition cache SKIPPED (requires current data)", "userInput", userInput[:min(50, len(userInput))])
	}

	promptTemplate := d.deps.Config.Orchestrator.QuestionGenerationPrompt
	generationPrompt := strings.ReplaceAll(promptTemplate, "{user_input}", userInput)
	generationPrompt = strings.ReplaceAll(generationPrompt, "{num_agents}", fmt.Sprintf("%d", numAgents))

	// Subtasks are generated directly via LLM call
	var subtasks []string
	runDecomposition := func() error {
		cfg := d.deps.Config
		cfg.SystemPrompt = ""
		cfg.Agent.MaxIterations = 1
		a := agent.NewGatewayAgent(cfg, d.deps.Client, agent.AgentOptions{
			RawSystemPrompt: true,
			AgentLabel:      "task decomposition",
		})
		content, llmErr := a.Run(ctx, generationPrompt, nil)
		if llmErr != nil {
			return llmErr
		}
		content = strings.TrimSpace(content)
		if content == "" {
			return fmt.Errorf("no response from LLM")
		}

		// Robust JSON extraction: find the first '[' and last ']'
		startIdx := strings.Index(content, "[")
		endIdx := strings.LastIndex(content, "]")
		if startIdx != -1 && endIdx != -1 && endIdx > startIdx {
			content = content[startIdx : endIdx+1]
		}

		if err := json.Unmarshal([]byte(content), &subtasks); err != nil {
			return fmt.Errorf("failed to parse decomposition JSON: %w (content: %q)", err, content)
		}

		if len(subtasks) != numAgents {
			return fmt.Errorf("expected %d questions, got %d", numAgents, len(subtasks))
		}

		return nil
	}

	var budgetErr error
	if d.deps.Budget != nil {
		budgetErr = d.deps.Budget.WithBudget("task decomposition", runDecomposition)
	} else {
		budgetErr = runDecomposition()
	}

	if budgetErr != nil {
		platform.GetLogger().Warn("Decomposition failed, using fallback subtasks", "error", budgetErr)
		subtasks = []string{
			fmt.Sprintf("Use search_web to research current information about: %s", userInput),
			fmt.Sprintf("Use search_web to find and analyze data about: %s", userInput),
			fmt.Sprintf("Use search_web to discover alternative perspectives on: %s", userInput),
			fmt.Sprintf("Use search_web to verify and cross-check facts about: %s", userInput),
		}
		if len(subtasks) > numAgents {
			subtasks = subtasks[:numAgents]
		}
	}

	// Don't cache decompositions for current data queries
	if !skipCache && d.deps.LLMCache != nil {
		if err := d.deps.LLMCache.SetCachedDecomposition(ctx, d.deps.CacheNamespace, cacheKey, subtasks); err != nil {
			platform.GetLogger().Warn("Failed to cache task decomposition", "namespace", d.deps.CacheNamespace, "subtaskCount", len(subtasks), "error", err)
		}
	}

	return subtasks, nil
}
