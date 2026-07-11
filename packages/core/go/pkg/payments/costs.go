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
}

// DefaultModelCost is used when a model is not in the list
var DefaultModelCost = ModelCost{Prompt: 5, Completion: 15}

// BaseModelCosts hardcoded defaults
var BaseModelCosts = map[string]ModelCost{
	"zai/glm-5.2":  {Prompt: 1, Completion: 5},
	"xai/grok-4.5": {Prompt: 5, Completion: 15},
}
var baseModelCostsByID = normalizeCostMap(BaseModelCosts)

// ComputeModelCostUSD calculates the cost for a given model and token usage.
// overrideJSON can be an empty string if no overrides.
func ComputeModelCostUSD(modelID string, promptTokens, completionTokens int, overrideJSON string) float64 {
	cost := DefaultModelCost

	// 1. Check overrides first
	overrideFound := false
	if overrideJSON != "" {
		var overrides map[string]ModelCost
		if err := json.Unmarshal([]byte(overrideJSON), &overrides); err == nil {
			if c, ok := lookupCost(normalizeCostMap(overrides), modelID); ok {
				cost = c
				overrideFound = true
			}
		} else {
			slog.Warn("Failed to parse model cost override JSON", "modelID", modelID, "error", err)
		}
	}

	// 2. Fall back to defaults if no override matched
	if !overrideFound {
		if c, ok := lookupCost(baseModelCostsByID, modelID); ok {
			cost = c
		}
	}

	promptUSD := (float64(promptTokens) / 1_000_000.0) * cost.Prompt
	completionUSD := (float64(completionTokens) / 1_000_000.0) * cost.Completion
	return promptUSD + completionUSD
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
