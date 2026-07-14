package payments

import "strings"

var subscriptionModelIDs = map[string]struct{}{
	"google/gemini-3.1-pro-preview": {},
	"openai/gpt-5.6-sol":            {},
	"openai/gpt-5.6-terra":          {},
	"anthropic/claude-fable-5":      {},
	"anthropic/claude-sonnet-5":     {},
	"anthropic/claude-opus-4.8":     {},
	"xai/grok-imagine-video-1.5":    {},
}

// HasPaidModelAccess reports whether a plan unlocks high and very-high cost models.
func HasPaidModelAccess(plan string) bool {
	switch strings.ToLower(strings.TrimSpace(plan)) {
	case string(PlanPro), string(PlanSuper), "enterprise":
		return true
	default:
		return false
	}
}

// ModelRequiresSubscription reports whether a model belongs to a paid cost tier.
func ModelRequiresSubscription(modelID string) bool {
	_, ok := subscriptionModelIDs[strings.ToLower(strings.TrimSpace(modelID))]
	return ok
}

// CanUseModel reports whether a plan may run the requested model.
func CanUseModel(plan, modelID string) bool {
	return !ModelRequiresSubscription(modelID) || HasPaidModelAccess(plan)
}
