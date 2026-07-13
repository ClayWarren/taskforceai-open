package handler

import "testing"

func TestFallbackTextModelMultipliersMatchPricingSnapshot(t *testing.T) {
	expected := map[string]float64{
		"zai/glm-5.2":                   1,
		"xai/grok-4.5":                  1.5,
		"meta/muse-spark-1.1":           1,
		"google/gemini-3.1-pro-preview": 2,
		"google/gemini-3.5-flash":       1.5,
		"google/gemini-3.1-flash-lite":  0.5,
		"openai/gpt-5.6-sol":            5,
		"openai/gpt-5.6-terra":          2.5,
		"openai/gpt-5.6-luna":           1,
		"anthropic/claude-fable-5":      9,
		"anthropic/claude-sonnet-5":     2,
		"anthropic/claude-opus-4.8":     4.5,
		"anthropic/claude-haiku-4.5":    1,
	}

	for _, option := range fallbackModels.Options {
		want, ok := expected[option.ID]
		if !ok {
			continue
		}
		if option.UsageMultiple == nil || *option.UsageMultiple != want {
			t.Errorf("unexpected multiplier for %s: got %v, want %g", option.ID, option.UsageMultiple, want)
		}
		delete(expected, option.ID)
	}
	for modelID := range expected {
		t.Errorf("missing fallback model %s", modelID)
	}
}
