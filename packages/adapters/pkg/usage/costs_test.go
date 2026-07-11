package usage

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestComputeModelCostUSD(t *testing.T) {
	t.Run("Default cost when model not found", func(t *testing.T) {
		cost := ComputeModelCostUSD("unknown-model", 1000, 1000, "")
		// Default is 5 prompt + 15 completion per 1 million tokens.
		assert.InDelta(t, 0.02, cost, 1e-12)
	})

	t.Run("Base model cost", func(t *testing.T) {
		cost := ComputeModelCostUSD("xai/grok-4.5", 1000, 1000, "")
		assert.InDelta(t, 0.02, cost, 1e-12)
	})

	t.Run("Case insensitive model lookup", func(t *testing.T) {
		cost := ComputeModelCostUSD("ZAI/GLM-5.2", 1000, 1000, "")
		assert.InDelta(t, 0.006, cost, 1e-12)
	})

	t.Run("Global cost overrides", func(t *testing.T) {
		overrides := `{"unknown-model": {"prompt": 1.0, "completion": 2.0}}`
		cost := ComputeModelCostUSD("unknown-model", 1000, 1000, overrides)
		assert.InDelta(t, 0.003, cost, 1e-12)
	})

	t.Run("Global cost overrides with case insensitive lookup", func(t *testing.T) {
		overrides := `{"MY-MODEL": {"prompt": 1.0, "completion": 2.0}}`
		cost := ComputeModelCostUSD("my-model", 1000, 1000, overrides)
		assert.InDelta(t, 0.003, cost, 1e-12)
	})

	t.Run("Partial token usage", func(t *testing.T) {
		cost := ComputeModelCostUSD("xai/grok-4.5", 500, 250, "")
		assert.InDelta(t, 0.00625, cost, 1e-12)
	})

	t.Run("Malformed overrides fallback to defaults", func(t *testing.T) {
		overrides := `invalid json`
		cost := ComputeModelCostUSD("xai/grok-4.5", 1000, 1000, overrides)
		assert.InDelta(t, 0.02, cost, 1e-12)
	})

	t.Run("Zero tokens results in zero cost", func(t *testing.T) {
		cost := ComputeModelCostUSD("any-model", 0, 0, "")
		assert.Equal(t, 0.0, cost)
	})
}
