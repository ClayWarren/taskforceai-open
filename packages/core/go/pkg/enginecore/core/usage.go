package core

type UsageDetails struct {
	InputTokens        int
	OutputTokens       int
	TotalTokens        int
	InputTokenDetails  InputTokenDetails
	OutputTokenDetails OutputTokenDetails
	CachedInputTokens  int
	ReasoningTokens    int
}

type InputTokenDetails struct {
	CacheReadTokens  int
	CacheWriteTokens int
	NoCacheTokens    int
}

type OutputTokenDetails struct {
	TextTokens      int
	ReasoningTokens int
}

type ModelLimits struct {
	Context int
	Input   int
	Output  int
}

type ModelCost struct {
	Input  float64
	Output float64
	Cache  CacheCost
}

type CacheCost struct {
	Read  float64
	Write float64
}

type ModelSpec struct {
	ProviderID string
	ModelID    string
	Limits     ModelLimits
	Cost       ModelCost
}

type UsageResult struct {
	Tokens Tokens
	Cost   float64
}

func GetUsage(model ModelSpec, usage UsageDetails, metadata map[string]any) UsageResult {
	tokens := Tokens{
		Input:     nonNegative(usage.InputTokens),
		Output:    nonNegative(usage.OutputTokens),
		Reasoning: nonNegative(usage.ReasoningTokens),
		Cache: CacheInfo{
			Read:  nonNegative(usage.CachedInputTokens),
			Write: 0,
		},
	}
	if tokens.Reasoning == 0 && usage.OutputTokenDetails.ReasoningTokens > 0 {
		tokens.Reasoning = usage.OutputTokenDetails.ReasoningTokens
	}
	if usage.CachedInputTokens > 0 && !isAnthropic(metadata) {
		tokens.Input = nonNegative(usage.InputTokens - usage.CachedInputTokens)
	}
	if meta := anthropicMetadata(metadata); meta != nil {
		if v, ok := meta["cacheCreationInputTokens"].(float64); ok {
			tokens.Cache.Write = nonNegative(int(v))
		} else if v, ok := meta["cacheCreationInputTokens"].(int); ok {
			tokens.Cache.Write = nonNegative(v)
		}
	}

	cost := (float64(tokens.Input) / 1_000_000.0) * model.Cost.Input
	cost += (float64(tokens.Output) / 1_000_000.0) * model.Cost.Output
	cost += (float64(tokens.Cache.Read) / 1_000_000.0) * model.Cost.Cache.Read
	cost += (float64(tokens.Cache.Write) / 1_000_000.0) * model.Cost.Cache.Write

	return UsageResult{Tokens: tokens, Cost: cost}
}

func anthropicMetadata(metadata map[string]any) map[string]any {
	if metadata == nil {
		return nil
	}
	if raw, ok := metadata["anthropic"]; ok {
		if m, ok := raw.(map[string]any); ok {
			return m
		}
	}
	return nil
}

func isAnthropic(metadata map[string]any) bool {
	return anthropicMetadata(metadata) != nil
}

func nonNegative(value int) int {
	if value < 0 {
		return 0
	}
	return value
}
