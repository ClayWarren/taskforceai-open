package payments

import (
	"strings"
	"time"
)

// Plan represents subscription tier
type Plan string

const (
	PlanFree  Plan = "free"
	PlanPro   Plan = "pro"
	PlanSuper Plan = "super"
)

var planAgentLimits = map[Plan]int{
	PlanFree:  2,
	PlanPro:   4,
	PlanSuper: 16,
}

// NormalizePlan maps external plan strings into the active core plan set.
func NormalizePlan(plan string) Plan {
	switch Plan(strings.ToLower(strings.TrimSpace(plan))) {
	case PlanFree:
		return PlanFree
	case PlanPro:
		return PlanPro
	case PlanSuper:
		return PlanSuper
	default:
		return PlanFree
	}
}

// AgentLimitForPlan returns the maximum enabled agents for a subscription tier.
func AgentLimitForPlan(plan string) int {
	limit := planAgentLimits[NormalizePlan(plan)]
	if limit <= 0 {
		return 1
	}
	return limit
}

// TaskTimeoutForPlan returns the orchestration timeout allowed for a subscription tier.
func TaskTimeoutForPlan(plan string) time.Duration {
	switch strings.ToLower(strings.TrimSpace(plan)) {
	case "super", "enterprise":
		return 30 * time.Minute
	default:
		return 10 * time.Minute
	}
}

// BillingPlanDefinition defines a billing plan with platform-specific IDs
type BillingPlanDefinition struct {
	Plan                  Plan
	StripePriceID         *string
	RevenueCatEntitlement *string
	AppStoreProductID     *string
	PlayStoreProductID    *string
}

// NewBillingPlanDefinition normalizes caller-provided provider identifiers while
// preserving the core product rule that paid plans use their plan name as the
// default RevenueCat entitlement.
func NewBillingPlanDefinition(plan Plan, stripePriceID, revenueCatEntitlement, appStoreProductID, playStoreProductID *string) BillingPlanDefinition {
	return BillingPlanDefinition{
		Plan:                  plan,
		StripePriceID:         normalizeOptionalString(stripePriceID),
		RevenueCatEntitlement: defaultRevenueCatEntitlement(plan, revenueCatEntitlement),
		AppStoreProductID:     normalizeOptionalString(appStoreProductID),
		PlayStoreProductID:    normalizeOptionalString(playStoreProductID),
	}
}

// GetProPlan returns the core Pro plan definition.
func GetProPlan() BillingPlanDefinition {
	return NewBillingPlanDefinition(PlanPro, nil, nil, nil, nil)
}

// GetSuperPlan returns the core Super plan definition.
func GetSuperPlan() BillingPlanDefinition {
	return NewBillingPlanDefinition(PlanSuper, nil, nil, nil, nil)
}

// GetAllPlans returns all active billing plans
func GetAllPlans() []BillingPlanDefinition {
	return []BillingPlanDefinition{GetProPlan(), GetSuperPlan()}
}

// ResolveRevenueCatPlan finds a plan by entitlement or product ID in the provided catalog.
func ResolveRevenueCatPlan(plans []BillingPlanDefinition, entitlementID, productID *string) *BillingPlanDefinition {
	entitlement := trimPtr(entitlementID)
	product := trimPtr(productID)

	for i := range plans {
		plan := &plans[i]
		if entitlement != "" && trimPtr(plan.RevenueCatEntitlement) == entitlement {
			return plan
		}
		if product != "" {
			if trimPtr(plan.AppStoreProductID) == product ||
				trimPtr(plan.PlayStoreProductID) == product ||
				trimPtr(plan.StripePriceID) == product {
				return plan
			}
		}
	}
	return nil
}

// FindPlanByPriceID finds a plan by Stripe price ID in the provided catalog.
func FindPlanByPriceID(plans []BillingPlanDefinition, priceID *string) *BillingPlanDefinition {
	price := trimPtr(priceID)
	if price == "" {
		return nil
	}
	for i := range plans {
		plan := &plans[i]
		if trimPtr(plan.StripePriceID) == price {
			return plan
		}
	}
	return nil
}

// FindPlanByName finds a plan by name (e.g., "pro", "super") in the provided catalog.
func FindPlanByName(plans []BillingPlanDefinition, name string) *BillingPlanDefinition {
	name = strings.TrimSpace(name)
	for i := range plans {
		plan := &plans[i]
		if string(plan.Plan) == name {
			return plan
		}
	}
	return nil
}

// ResolvePlanFromRevenueCat finds a plan by entitlement or product ID in the core catalog.
func ResolvePlanFromRevenueCat(entitlementID, productID *string) *BillingPlanDefinition {
	return ResolveRevenueCatPlan(GetAllPlans(), entitlementID, productID)
}

// GetPlanByPriceId finds a plan by Stripe price ID in the core catalog.
func GetPlanByPriceId(priceID *string) *BillingPlanDefinition {
	return FindPlanByPriceID(GetAllPlans(), priceID)
}

// GetPlanByName finds a plan by name (e.g., "pro", "super") in the core catalog.
func GetPlanByName(name string) *BillingPlanDefinition {
	return FindPlanByName(GetAllPlans(), name)
}

func defaultRevenueCatEntitlement(plan Plan, entitlement *string) *string {
	if normalized := normalizeOptionalString(entitlement); normalized != nil {
		return normalized
	}
	switch plan {
	case PlanFree:
		return nil
	case PlanPro, PlanSuper:
		value := string(plan)
		return &value
	default:
		return nil
	}
}

func normalizeOptionalString(value *string) *string {
	trimmed := trimPtr(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func trimPtr(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
