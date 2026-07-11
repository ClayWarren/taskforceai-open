package chat

import (
	"fmt"
	"slices"
	"strings"
)

const (
	ReasoningEffortMinimal = "minimal"
	ReasoningEffortLow     = "low"
	ReasoningEffortMedium  = "medium"
	ReasoningEffortHigh    = "high"
	ReasoningEffortXHigh   = "xhigh"
	ReasoningEffortMax     = "max"
)

type ReasoningEffortConfig struct {
	Levels  []string
	Default string
}

var reasoningEffortByModel = map[string]ReasoningEffortConfig{ //nolint:gochecknoglobals // Product capability catalog.
	"openai/gpt-5.6-sol": {
		Levels:  []string{ReasoningEffortLow, ReasoningEffortMedium, ReasoningEffortHigh, ReasoningEffortXHigh, ReasoningEffortMax},
		Default: ReasoningEffortMedium,
	},
	"openai/gpt-5.6-terra": {
		Levels:  []string{ReasoningEffortLow, ReasoningEffortMedium, ReasoningEffortHigh, ReasoningEffortXHigh},
		Default: ReasoningEffortMedium,
	},
	"openai/gpt-5.6-luna": {
		Levels:  []string{ReasoningEffortLow, ReasoningEffortMedium, ReasoningEffortHigh, ReasoningEffortXHigh},
		Default: ReasoningEffortMedium,
	},
	"xai/grok-4.5": {
		Levels:  []string{ReasoningEffortLow, ReasoningEffortMedium, ReasoningEffortHigh},
		Default: ReasoningEffortHigh,
	},
	"google/gemini-3.1-pro-preview": {
		Levels:  []string{ReasoningEffortLow, ReasoningEffortMedium, ReasoningEffortHigh},
		Default: ReasoningEffortHigh,
	},
	"google/gemini-3.5-flash": {
		Levels:  []string{ReasoningEffortMinimal, ReasoningEffortLow, ReasoningEffortMedium, ReasoningEffortHigh},
		Default: ReasoningEffortMedium,
	},
	"google/gemini-3.1-flash-lite": {
		Levels:  []string{ReasoningEffortMinimal, ReasoningEffortLow, ReasoningEffortMedium, ReasoningEffortHigh},
		Default: ReasoningEffortMinimal,
	},
	"anthropic/claude-fable-5": {
		Levels:  []string{ReasoningEffortLow, ReasoningEffortMedium, ReasoningEffortHigh, ReasoningEffortXHigh, ReasoningEffortMax},
		Default: ReasoningEffortHigh,
	},
	"anthropic/claude-sonnet-5": {
		Levels:  []string{ReasoningEffortLow, ReasoningEffortMedium, ReasoningEffortHigh, ReasoningEffortXHigh},
		Default: ReasoningEffortHigh,
	},
	"anthropic/claude-opus-4.8": {
		Levels:  []string{ReasoningEffortLow, ReasoningEffortMedium, ReasoningEffortHigh, ReasoningEffortXHigh, ReasoningEffortMax},
		Default: ReasoningEffortHigh,
	},
}

func ReasoningEffortConfigForModel(modelID string) (ReasoningEffortConfig, bool) {
	config, ok := reasoningEffortByModel[strings.ToLower(strings.TrimSpace(modelID))]
	if !ok {
		return ReasoningEffortConfig{}, false
	}
	config.Levels = slices.Clone(config.Levels)
	return config, true
}

func ValidateReasoningEffort(modelID, effort string) error {
	effort = strings.ToLower(strings.TrimSpace(effort))
	if effort == "" {
		return nil
	}
	config, ok := ReasoningEffortConfigForModel(modelID)
	if !ok {
		return fmt.Errorf("model %q does not support configurable reasoning effort", modelID)
	}
	if !slices.Contains(config.Levels, effort) {
		return fmt.Errorf("reasoning effort %q is not supported by model %q", effort, modelID)
	}
	return nil
}

func EffectiveReasoningEffort(modelID, requested string) string {
	requested = strings.ToLower(strings.TrimSpace(requested))
	if requested == "" {
		return ""
	}
	config, ok := ReasoningEffortConfigForModel(modelID)
	if !ok || len(config.Levels) == 0 {
		return ""
	}
	if slices.Contains(config.Levels, requested) {
		return requested
	}

	rank := map[string]int{
		ReasoningEffortMinimal: 0,
		ReasoningEffortLow:     1,
		ReasoningEffortMedium:  2,
		ReasoningEffortHigh:    3,
		ReasoningEffortXHigh:   4,
		ReasoningEffortMax:     5,
	}
	requestedRank, ranked := rank[requested]
	if !ranked {
		return config.Default
	}
	best := config.Levels[0]
	for _, level := range config.Levels {
		if rank[level] <= requestedRank {
			best = level
		}
	}
	return best
}
