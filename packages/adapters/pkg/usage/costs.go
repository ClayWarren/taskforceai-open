package usage

import coreusage "github.com/TaskForceAI/core/pkg/usage"

type ModelCost = coreusage.ModelCost

var DefaultModelCost = coreusage.DefaultModelCost

var BaseModelCosts = coreusage.BaseModelCosts

func ComputeModelCostUSD(modelID string, promptTokens, completionTokens int, overrideJSON string) float64 {
	return coreusage.ComputeModelCostUSD(modelID, promptTokens, completionTokens, overrideJSON)
}
