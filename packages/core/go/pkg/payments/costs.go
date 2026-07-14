package payments

import (
	"encoding/json"
	"log/slog"
	"strings"
)

// ModelCost represents USD cost per 1 million tokens.
type ModelCost struct {
	Prompt     float64 `json:"prompt"`
	Completion float64 `json:"completion"`
	CacheRead  float64 `json:"cacheRead,omitempty"`
}

// DefaultModelCost is used when a model is not in the list
var DefaultModelCost = ModelCost{Prompt: 5, Completion: 15, CacheRead: 5}

// BaseModelCosts hardcoded defaults
var BaseModelCosts = map[string]ModelCost{
	"zai/glm-5.2":                   {Prompt: 1.40, Completion: 4.40, CacheRead: 0.26},
	"xai/grok-4.5":                  {Prompt: 2, Completion: 6, CacheRead: 0.50},
	"meta/muse-spark-1.1":           {Prompt: 1.25, Completion: 4.25, CacheRead: 0.15},
	"google/gemini-3.1-pro-preview": {Prompt: 2, Completion: 12, CacheRead: 0.20},
	"google/gemini-3.5-flash":       {Prompt: 1.50, Completion: 9, CacheRead: 0.15},
	"google/gemini-3.1-flash-lite":  {Prompt: 0.25, Completion: 1.50, CacheRead: 0.03},
	"openai/gpt-5.6-sol":            {Prompt: 5, Completion: 30, CacheRead: 0.50},
	"openai/gpt-5.6-terra":          {Prompt: 2.50, Completion: 15, CacheRead: 0.25},
	"openai/gpt-5.6-luna":           {Prompt: 1, Completion: 6, CacheRead: 0.10},
	"anthropic/claude-fable-5":      {Prompt: 10, Completion: 50, CacheRead: 1},
	"anthropic/claude-sonnet-5":     {Prompt: 2, Completion: 10, CacheRead: 0.20},
	"anthropic/claude-opus-4.8":     {Prompt: 5, Completion: 25, CacheRead: 0.50},
	"anthropic/claude-haiku-4.5":    {Prompt: 1, Completion: 5, CacheRead: 0.10},
	"google/gemini-2.5-flash-image": {Prompt: 0.30, Completion: 2.50, CacheRead: 0.03},
}
var baseModelCostsByID = normalizeCostMap(BaseModelCosts)

// ComputeModelCostUSD calculates the cost for a given model and token usage.
// overrideJSON can be an empty string if no overrides.
func ComputeModelCostUSD(modelID string, promptTokens, completionTokens int, overrideJSON string) float64 {
	return ComputeModelCostWithCacheUSD(modelID, promptTokens, completionTokens, 0, overrideJSON)
}

func ComputeModelCostWithCacheUSD(modelID string, promptTokens, completionTokens, cachedTokens int, overrideJSON string) float64 {
	cost, found := lookupCost(baseModelCostsByID, modelID)
	if !found {
		cost = DefaultModelCost
	}
	if overrideJSON != "" {
		var overrides map[string]ModelCost
		if err := json.Unmarshal([]byte(overrideJSON), &overrides); err != nil {
			slog.Warn("Failed to parse model cost override JSON", "modelID", modelID, "error", err)
		} else if override, ok := lookupCost(normalizeCostMap(overrides), modelID); ok {
			cost = override
		}
	}
	cachedTokens = min(max(cachedTokens, 0), max(promptTokens, 0))
	uncachedPromptTokens := max(0, promptTokens-cachedTokens)
	cacheReadRate := cost.CacheRead
	if cacheReadRate <= 0 {
		cacheReadRate = cost.Prompt
	}
	return float64(uncachedPromptTokens)/1_000_000*cost.Prompt +
		float64(cachedTokens)/1_000_000*cacheReadRate +
		float64(completionTokens)/1_000_000*cost.Completion
}

func normalizeCostMap(m map[string]ModelCost) map[string]ModelCost {
	normalized := make(map[string]ModelCost, len(m))
	for k, v := range m {
		normalized[strings.ToLower(k)] = v
	}
	return normalized
}

func lookupCost(m map[string]ModelCost, modelID string) (ModelCost, bool) {
	cost, ok := m[strings.ToLower(modelID)]
	return cost, ok
}
