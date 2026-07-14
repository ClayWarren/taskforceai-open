package payments

import (
	"testing"
	"time"
)

func TestGetProPlan_UsesDefaultsAndEnvOverrides(t *testing.T) {
	defaultPlan := GetProPlan()
	if defaultPlan.Plan != PlanPro {
		t.Fatalf("expected plan %q, got %q", PlanPro, defaultPlan.Plan)
	}
	if defaultPlan.RevenueCatEntitlement == nil || *defaultPlan.RevenueCatEntitlement != "pro" {
		t.Fatalf("expected default entitlement 'pro', got %#v", defaultPlan.RevenueCatEntitlement)
	}
	if defaultPlan.StripePriceID != nil {
		t.Fatalf("expected nil stripe price by default, got %#v", defaultPlan.StripePriceID)
	}

	entitlement := " pro-premium "
	stripePrice := " price_pro_123 "
	appStoreProduct := " app.pro "
	playStoreProduct := " play.pro "
	overridePlan := NewBillingPlanDefinition(PlanPro, &stripePrice, &entitlement, &appStoreProduct, &playStoreProduct)

	if overridePlan.RevenueCatEntitlement == nil || *overridePlan.RevenueCatEntitlement != "pro-premium" {
		t.Fatalf("expected entitlement override, got %#v", overridePlan.RevenueCatEntitlement)
	}
	if overridePlan.StripePriceID == nil || *overridePlan.StripePriceID != "price_pro_123" {
		t.Fatalf("expected stripe override, got %#v", overridePlan.StripePriceID)
	}
	if overridePlan.AppStoreProductID == nil || *overridePlan.AppStoreProductID != "app.pro" {
		t.Fatalf("expected app store override, got %#v", overridePlan.AppStoreProductID)
	}
	if overridePlan.PlayStoreProductID == nil || *overridePlan.PlayStoreProductID != "play.pro" {
		t.Fatalf("expected play store override, got %#v", overridePlan.PlayStoreProductID)
	}
}

func TestResolvePlanFromRevenueCat(t *testing.T) {
	entPro := "ent_pro"
	entSuper := "ent_super"
	pricePro := "price_pro"
	priceSuper := "price_super"
	iosPro := "ios.pro"
	iosSuper := "ios.super"
	androidPro := "android.pro"
	androidSuper := "android.super"
	plans := []BillingPlanDefinition{
		NewBillingPlanDefinition(PlanPro, &pricePro, &entPro, &iosPro, &androidPro),
		NewBillingPlanDefinition(PlanSuper, &priceSuper, &entSuper, &iosSuper, &androidSuper),
	}

	byEntitlement := ResolveRevenueCatPlan(plans, new(" ent_super "), nil)
	if byEntitlement == nil || byEntitlement.Plan != PlanSuper {
		t.Fatalf("expected entitlement to resolve super plan, got %#v", byEntitlement)
	}

	byIOSProduct := ResolveRevenueCatPlan(plans, nil, new("ios.pro"))
	if byIOSProduct == nil || byIOSProduct.Plan != PlanPro {
		t.Fatalf("expected iOS product to resolve pro plan, got %#v", byIOSProduct)
	}

	byStripeProduct := ResolveRevenueCatPlan(plans, nil, new(" price_super "))
	if byStripeProduct == nil || byStripeProduct.Plan != PlanSuper {
		t.Fatalf("expected stripe price to resolve super plan, got %#v", byStripeProduct)
	}

	notFound := ResolveRevenueCatPlan(plans, new("unknown"), new("unknown"))
	if notFound != nil {
		t.Fatalf("expected nil plan for unknown identifiers, got %#v", notFound)
	}
}

func TestGetPlanByPriceIDAndName(t *testing.T) {
	pricePro := "price_pro"
	priceSuper := "price_super"
	plans := []BillingPlanDefinition{
		NewBillingPlanDefinition(PlanPro, &pricePro, nil, nil, nil),
		NewBillingPlanDefinition(PlanSuper, &priceSuper, nil, nil, nil),
	}

	if got := FindPlanByPriceID(plans, nil); got != nil {
		t.Fatalf("expected nil for nil price id, got %#v", got)
	}
	if got := FindPlanByPriceID(plans, new(" price_pro ")); got == nil || got.Plan != PlanPro {
		t.Fatalf("expected pro plan by price id, got %#v", got)
	}
	if got := FindPlanByPriceID(plans, new("missing")); got != nil {
		t.Fatalf("expected nil for missing price id, got %#v", got)
	}

	if got := FindPlanByName(plans, " super "); got == nil || got.Plan != PlanSuper {
		t.Fatalf("expected super plan by name, got %#v", got)
	}
	if got := FindPlanByName(plans, "missing"); got != nil {
		t.Fatalf("expected nil for missing plan name, got %#v", got)
	}

	if got := GetAllPlans(); len(got) != 2 || got[0].Plan != PlanPro || got[1].Plan != PlanSuper {
		t.Fatalf("unexpected core plan catalog: %#v", got)
	}
	if got := GetSuperPlan(); got.Plan != PlanSuper || got.RevenueCatEntitlement == nil || *got.RevenueCatEntitlement != "super" {
		t.Fatalf("unexpected super plan: %#v", got)
	}
	if got := ResolvePlanFromRevenueCat(new("super"), nil); got == nil || got.Plan != PlanSuper {
		t.Fatalf("expected wrapper to resolve super entitlement, got %#v", got)
	}
	if got := GetPlanByPriceId(new("")); got != nil {
		t.Fatalf("empty price id should not resolve, got %#v", got)
	}
	if got := GetPlanByName("pro"); got == nil || got.Plan != PlanPro {
		t.Fatalf("expected wrapper to resolve pro by name, got %#v", got)
	}
	if got := NewBillingPlanDefinition(PlanFree, nil, nil, nil, nil); got.RevenueCatEntitlement != nil {
		t.Fatalf("free plan should not get a default entitlement, got %#v", got)
	}
	if got := NewBillingPlanDefinition(Plan("legacy"), nil, nil, nil, nil); got.RevenueCatEntitlement != nil {
		t.Fatalf("unknown plan should not get a default entitlement, got %#v", got)
	}
}

func TestAgentLimitForPlan(t *testing.T) {
	tests := []struct {
		name string
		plan string
		want int
	}{
		{name: "free", plan: "free", want: 2},
		{name: "pro", plan: "pro", want: 4},
		{name: "super", plan: "super", want: 16},
		{name: "normalizes case and whitespace", plan: " Super ", want: 16},
		{name: "unknown falls back to free", plan: "enterprise", want: 2},
		{name: "blank falls back to free", plan: "", want: 2},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := AgentLimitForPlan(tt.plan); got != tt.want {
				t.Fatalf("expected agent limit %d, got %d", tt.want, got)
			}
		})
	}
}

func TestTaskTimeoutForPlan(t *testing.T) {
	tests := []struct {
		name string
		plan string
		want time.Duration
	}{
		{name: "free", plan: "free", want: 10 * time.Minute},
		{name: "pro", plan: "pro", want: 10 * time.Minute},
		{name: "super", plan: "super", want: 30 * time.Minute},
		{name: "enterprise", plan: "enterprise", want: 30 * time.Minute},
		{name: "normalizes case and whitespace", plan: " Super ", want: 30 * time.Minute},
		{name: "unknown falls back to base timeout", plan: "unknown", want: 10 * time.Minute},
		{name: "blank falls back to base timeout", plan: "", want: 10 * time.Minute},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := TaskTimeoutForPlan(tt.plan); got != tt.want {
				t.Fatalf("expected timeout %s, got %s", tt.want, got)
			}
		})
	}
}
