package billing

import (
	"testing"

	"github.com/claywarren/revenuecat"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetEnvOrNil_ReturnsTrimmedValue(t *testing.T) {
	t.Setenv("BILLING_TEST_VALUE", " price_123 ")

	value := getEnvOrNil("BILLING_TEST_VALUE")

	assert.NotNil(t, value)
	assert.Equal(t, "price_123", *value)
}

func TestMapStoreToSource_AppStore(t *testing.T) {
	source, err := MapStoreToSource(revenuecat.AppStore)

	assert.Empty(t, err)
	assert.NotNil(t, source)
	assert.Equal(t, SourceAppStore, *source)
}

func TestMapStoreToSource_TrimsStore(t *testing.T) {
	source, err := MapStoreToSource(revenuecat.Store(" app_store "))

	assert.Empty(t, err)
	assert.NotNil(t, source)
	assert.Equal(t, SourceAppStore, *source)
}

func TestMapStoreToSource_MacAppStore(t *testing.T) {
	source, err := MapStoreToSource(revenuecat.MacAppStore)

	assert.Empty(t, err)
	assert.NotNil(t, source)
	assert.Equal(t, SourceAppStore, *source)
}

func TestMapStoreToSource_PlayStore(t *testing.T) {
	source, err := MapStoreToSource(revenuecat.PlayStore)

	assert.Empty(t, err)
	assert.NotNil(t, source)
	assert.Equal(t, SourcePlayStore, *source)
}

func TestMapStoreToSource_Empty(t *testing.T) {
	source, err := MapStoreToSource("")

	assert.Equal(t, ErrMissingStore, err)
	assert.Nil(t, source)
}

func TestMapStoreToSource_Unknown(t *testing.T) {
	source, err := MapStoreToSource("unknown_store")

	assert.Equal(t, ErrUnknownStore, err)
	assert.Nil(t, source)
}

func TestGetPlanByPriceId_Nil(t *testing.T) {
	result := GetPlanByPriceId(nil)
	assert.Nil(t, result)
}

func TestGetPlanByPriceId_NotFound(t *testing.T) {
	nonExistentID := "price_nonexistent"
	result := GetPlanByPriceId(&nonExistentID)
	assert.Nil(t, result)
}

func TestGetPlanByName_Pro(t *testing.T) {
	result := GetPlanByName("pro")

	// proPlan is always in BillingPlans, so this should never be nil
	assert.NotNil(t, result, "pro plan should always exist in BillingPlans")
	assert.Equal(t, PlanPro, result.Plan)
}

func TestGetPlanByName_TrimsInput(t *testing.T) {
	result := GetPlanByName(" pro ")

	assert.NotNil(t, result)
	assert.Equal(t, PlanPro, result.Plan)
}

func TestGetPlanByName_Super(t *testing.T) {
	result := GetPlanByName("super")

	// superPlan is always in BillingPlans, so this should never be nil
	assert.NotNil(t, result, "super plan should always exist in BillingPlans")
	assert.Equal(t, PlanSuper, result.Plan)
}

func TestGetPlanByName_NotFound(t *testing.T) {
	result := GetPlanByName("enterprise")
	assert.Nil(t, result)
}

func TestResolvePlanFromRevenueCat_ByEntitlement(t *testing.T) {
	// Test with the default entitlement ID "pro"
	// RevenueCatEntitlement defaults to "pro" for proPlan, so this should match
	proEntitlement := "pro"
	result := ResolvePlanFromRevenueCat(&proEntitlement, nil)

	assert.NotNil(t, result, "should find pro plan by default entitlement")
	assert.Equal(t, PlanPro, result.Plan)
}

func TestResolvePlanFromRevenueCat_ByEntitlement_Super(t *testing.T) {
	// Test with the default entitlement ID "super"
	superEntitlement := "super"
	result := ResolvePlanFromRevenueCat(&superEntitlement, nil)

	assert.NotNil(t, result, "should find super plan by default entitlement")
	assert.Equal(t, PlanSuper, result.Plan)
}

func TestResolvePlanFromRevenueCat_ByV2EntitlementID(t *testing.T) {
	tests := []struct {
		name          string
		entitlementID string
		wantPlan      Plan
	}{
		{name: "pro", entitlementID: revenueCatEntitlementProID, wantPlan: PlanPro},
		{name: "super", entitlementID: revenueCatEntitlementSuperID, wantPlan: PlanSuper},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ResolvePlanFromRevenueCat(&tt.entitlementID, nil)

			require.NotNil(t, result)
			assert.Equal(t, tt.wantPlan, result.Plan)
		})
	}
}

func TestResolvePlanFromRevenueCat_ByProductID(t *testing.T) {
	originalPlans := BillingPlans
	t.Cleanup(func() { BillingPlans = originalPlans })

	productID := "com.app.pro"
	BillingPlans = []BillingPlanDefinition{
		{Plan: PlanPro, AppStoreProductID: &productID},
	}

	result := ResolvePlanFromRevenueCat(nil, &productID)

	assert.NotNil(t, result)
	assert.Equal(t, PlanPro, result.Plan)
}

func TestResolvePlanFromRevenueCat_TrimsIDs(t *testing.T) {
	originalPlans := BillingPlans
	t.Cleanup(func() { BillingPlans = originalPlans })

	entitlement := "pro-entitlement"
	productID := "com.app.pro"
	inputEntitlement := " pro-entitlement "
	inputProductID := " com.app.pro "
	BillingPlans = []BillingPlanDefinition{
		{
			Plan:                  PlanPro,
			RevenueCatEntitlement: &entitlement,
			AppStoreProductID:     &productID,
		},
	}

	result := ResolvePlanFromRevenueCat(&inputEntitlement, &inputProductID)

	assert.NotNil(t, result)
	assert.Equal(t, PlanPro, result.Plan)
}

func TestGetPlanByPriceId_Match(t *testing.T) {
	priceID := "price_pro"
	originalPlans := BillingPlans
	t.Cleanup(func() { BillingPlans = originalPlans })

	BillingPlans = []BillingPlanDefinition{
		{Plan: PlanPro, StripePriceID: &priceID},
	}

	result := GetPlanByPriceId(&priceID)
	assert.NotNil(t, result)
	assert.Equal(t, PlanPro, result.Plan)
}

func TestGetPlanByPriceId_TrimsInput(t *testing.T) {
	priceID := "price_pro"
	inputPriceID := " price_pro "
	originalPlans := BillingPlans
	t.Cleanup(func() { BillingPlans = originalPlans })

	BillingPlans = []BillingPlanDefinition{
		{Plan: PlanPro, StripePriceID: &priceID},
	}

	result := GetPlanByPriceId(&inputPriceID)

	assert.NotNil(t, result)
	assert.Equal(t, PlanPro, result.Plan)
}

func TestResolvePlanFromRevenueCat_NilInputs(t *testing.T) {
	// Can only test if env vars are set
	// This test verifies the function doesn't panic with nil inputs
	result := ResolvePlanFromRevenueCat(nil, nil)
	assert.Nil(t, result)
}

func TestResolvePlanFromRevenueCat_NotFound(t *testing.T) {
	unknownEntitlement := "unknown"
	unknownProduct := "unknown_product"
	result := ResolvePlanFromRevenueCat(&unknownEntitlement, &unknownProduct)
	assert.Nil(t, result)
}

func TestBillingPlans_ContainsProAndSuper(t *testing.T) {
	var hasPro, hasSuper bool
	for _, plan := range BillingPlans {
		if plan.Plan == PlanPro {
			hasPro = true
		}
		if plan.Plan == PlanSuper {
			hasSuper = true
		}
	}

	assert.True(t, hasPro, "BillingPlans should contain pro plan")
	assert.True(t, hasSuper, "BillingPlans should contain super plan")
}
