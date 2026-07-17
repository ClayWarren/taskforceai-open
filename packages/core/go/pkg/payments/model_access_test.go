package payments

import "testing"

func TestModelSubscriptionAccess(t *testing.T) {
	lockedModels := []string{
		"google/gemini-3.1-pro-preview",
		"openai/gpt-5.6-sol",
		"openai/gpt-5.6-terra",
		"anthropic/claude-fable-5",
		"anthropic/claude-sonnet-5",
		"anthropic/claude-opus-4.8",
		"xai/grok-imagine-video-1.5",
	}
	for _, modelID := range lockedModels {
		if !ModelRequiresSubscription("  " + modelID + "  ") {
			t.Errorf("expected %s to require a subscription", modelID)
		}
		if CanUseModel("free", modelID) {
			t.Errorf("expected free plan to reject %s", modelID)
		}
		if !CanUseModel("pro", modelID) || !CanUseModel("super", modelID) {
			t.Errorf("expected paid plans to unlock %s", modelID)
		}
	}
}

func TestMediumAndLowCostModelsRemainFree(t *testing.T) {
	for _, modelID := range []string{
		"zai/glm-5.2",
		"google/gemini-3.1-flash-lite",
		"google/gemini-3.5-flash",
		"google/gemini-2.5-flash-image",
		"xai/grok-4.5",
		"openai/gpt-5.6-luna",
	} {
		if !CanUseModel("free", modelID) {
			t.Errorf("expected free plan to allow %s", modelID)
		}
	}
}

func TestPaidModelAccessPlanNormalization(t *testing.T) {
	for _, plan := range []string{"pro", " SUPER ", "Enterprise"} {
		if !HasPaidModelAccess(plan) {
			t.Errorf("expected %q to have paid model access", plan)
		}
	}
	for _, plan := range []string{"", "free", "starter", "unknown"} {
		if HasPaidModelAccess(plan) {
			t.Errorf("expected %q not to have paid model access", plan)
		}
	}
}
