package payments

import (
	"math"
	"testing"
)

func TestComputeModelCostUSD(t *testing.T) {
	tests := []struct {
		name             string
		modelID          string
		promptTokens     int
		completionTokens int
		overrideJSON     string
		want             float64
	}{
		{
			name:             "unknown model uses default cost",
			modelID:          "unknown-model",
			promptTokens:     1000,
			completionTokens: 1000,
			want:             0.02,
		},
		{
			name:             "base model cost is case insensitive",
			modelID:          "ZAI/GLM-5.2",
			promptTokens:     2000,
			completionTokens: 500,
			want:             0.0045,
		},
		{
			name:             "override takes precedence over base model",
			modelID:          "xai/grok-4.5",
			promptTokens:     1000,
			completionTokens: 1000,
			overrideJSON:     `{"XAI/GROK-4.5":{"prompt":2,"completion":3}}`,
			want:             0.005,
		},
		{
			name:             "override can define custom model",
			modelID:          "custom/model",
			promptTokens:     250,
			completionTokens: 750,
			overrideJSON:     `{"custom/model":{"prompt":4,"completion":8}}`,
			want:             0.007,
		},
		{
			name:             "invalid override falls back to base cost",
			modelID:          "xai/grok-4.5",
			promptTokens:     1000,
			completionTokens: 1000,
			overrideJSON:     `{`,
			want:             0.02,
		},
		{
			name:             "zero tokens cost zero",
			modelID:          "xai/grok-4.5",
			promptTokens:     0,
			completionTokens: 0,
			want:             0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ComputeModelCostUSD(tt.modelID, tt.promptTokens, tt.completionTokens, tt.overrideJSON)
			if math.Abs(got-tt.want) > 1e-12 {
				t.Fatalf("expected cost %v, got %v", tt.want, got)
			}
		})
	}
}
