package core

import "testing"

func TestUsageReasoningTokens(t *testing.T) {
	model := ModelSpec{
		ProviderID: "test",
		ModelID:    "test",
		Cost:       ModelCost{},
	}
	result := GetUsage(model, UsageDetails{
		InputTokens:  1000,
		OutputTokens: 500,
		TotalTokens:  1500,
		InputTokenDetails: InputTokenDetails{
			CacheReadTokens:  0,
			CacheWriteTokens: 0,
			NoCacheTokens:    900,
		},
		OutputTokenDetails: OutputTokenDetails{
			TextTokens:      900,
			ReasoningTokens: 100,
		},
		ReasoningTokens: 100,
	}, nil)

	if result.Tokens.Reasoning != 100 {
		t.Fatalf("expected reasoning tokens 100, got %d", result.Tokens.Reasoning)
	}
}

func TestUsageHandlesUndefined(t *testing.T) {
	model := ModelSpec{
		ProviderID: "test",
		ModelID:    "test",
		Cost:       ModelCost{},
	}
	result := GetUsage(model, UsageDetails{
		InputTokens:  0,
		OutputTokens: 0,
		TotalTokens:  0,
		InputTokenDetails: InputTokenDetails{
			CacheReadTokens:  0,
			CacheWriteTokens: 0,
			NoCacheTokens:    0,
		},
		OutputTokenDetails: OutputTokenDetails{
			TextTokens:      0,
			ReasoningTokens: 0,
		},
	}, nil)

	if result.Tokens.Input != 0 || result.Tokens.Output != 0 || result.Tokens.Reasoning != 0 {
		t.Fatalf("expected zero tokens, got %+v", result.Tokens)
	}
	if result.Cost != 0 {
		t.Fatalf("expected zero cost, got %f", result.Cost)
	}
}

func TestUsageCostCalculation(t *testing.T) {
	model := ModelSpec{
		ProviderID: "test",
		ModelID:    "test",
		Cost: ModelCost{
			Input:  3,
			Output: 15,
			Cache: CacheCost{
				Read:  0.3,
				Write: 3.75,
			},
		},
	}
	result := GetUsage(model, UsageDetails{
		InputTokens:  1_000_000,
		OutputTokens: 100_000,
		TotalTokens:  1_100_000,
		InputTokenDetails: InputTokenDetails{
			CacheReadTokens:  0,
			CacheWriteTokens: 0,
			NoCacheTokens:    1_000_000,
		},
		OutputTokenDetails: OutputTokenDetails{
			TextTokens:      0,
			ReasoningTokens: 0,
		},
	}, nil)

	if result.Cost != 4.5 {
		t.Fatalf("expected cost 4.5, got %f", result.Cost)
	}
}

func TestUsageAnthropic(t *testing.T) {
	model := ModelSpec{
		Cost: ModelCost{
			Cache: CacheCost{Write: 10},
		},
	}
	metadata := map[string]any{
		"anthropic": map[string]any{
			"cacheCreationInputTokens": float64(100),
		},
	}
	usage := UsageDetails{
		InputTokens:       1000,
		CachedInputTokens: 200,
	}

	result := GetUsage(model, usage, metadata)

	if result.Tokens.Cache.Write != 100 {
		t.Errorf("expected write tokens 100, got %d", result.Tokens.Cache.Write)
	}
	// For Anthropic, we don't subtract CachedInputTokens from Input (different SDK reporting style)
	if result.Tokens.Input != 1000 {
		t.Errorf("expected input tokens 1000, got %d", result.Tokens.Input)
	}
}

func TestUsageCachedInputAndAnthropicIntMetadata(t *testing.T) {
	model := ModelSpec{
		Cost: ModelCost{
			Input:  2,
			Output: 4,
			Cache:  CacheCost{Read: 1, Write: 3},
		},
	}

	regular := GetUsage(model, UsageDetails{
		InputTokens:       1000,
		OutputTokens:      500,
		CachedInputTokens: 200,
		OutputTokenDetails: OutputTokenDetails{
			ReasoningTokens: 25,
		},
	}, map[string]any{})
	if regular.Tokens.Input != 800 {
		t.Fatalf("expected cached input to be subtracted, got %d", regular.Tokens.Input)
	}
	if regular.Tokens.Reasoning != 25 {
		t.Fatalf("expected reasoning fallback, got %d", regular.Tokens.Reasoning)
	}
	if regular.Tokens.Cache.Read != 200 {
		t.Fatalf("expected cache read tokens, got %d", regular.Tokens.Cache.Read)
	}

	anthropic := GetUsage(model, UsageDetails{InputTokens: 1000}, map[string]any{
		"anthropic": map[string]any{"cacheCreationInputTokens": 300},
	})
	if anthropic.Tokens.Cache.Write != 300 {
		t.Fatalf("expected int cache write tokens, got %d", anthropic.Tokens.Cache.Write)
	}
}

func TestUsageClampsInvalidProviderTokenCounts(t *testing.T) {
	model := ModelSpec{
		Cost: ModelCost{
			Input:  2,
			Output: 4,
			Cache:  CacheCost{Read: 1, Write: 3},
		},
	}

	regular := GetUsage(model, UsageDetails{
		InputTokens:       100,
		OutputTokens:      -10,
		ReasoningTokens:   -5,
		CachedInputTokens: 200,
	}, nil)
	if regular.Tokens.Input != 0 {
		t.Fatalf("expected input tokens to clamp to zero, got %d", regular.Tokens.Input)
	}
	if regular.Tokens.Output != 0 {
		t.Fatalf("expected output tokens to clamp to zero, got %d", regular.Tokens.Output)
	}
	if regular.Tokens.Reasoning != 0 {
		t.Fatalf("expected reasoning tokens to clamp to zero, got %d", regular.Tokens.Reasoning)
	}
	if regular.Tokens.Cache.Read != 200 {
		t.Fatalf("expected positive cache read tokens to remain, got %d", regular.Tokens.Cache.Read)
	}
	if regular.Cost < 0 {
		t.Fatalf("expected non-negative cost, got %f", regular.Cost)
	}

	anthropic := GetUsage(model, UsageDetails{InputTokens: 1000}, map[string]any{
		"anthropic": map[string]any{"cacheCreationInputTokens": -300},
	})
	if anthropic.Tokens.Cache.Write != 0 {
		t.Fatalf("expected negative cache write metadata to clamp to zero, got %d", anthropic.Tokens.Cache.Write)
	}
	if anthropic.Cost < 0 {
		t.Fatalf("expected non-negative anthropic cost, got %f", anthropic.Cost)
	}
}
