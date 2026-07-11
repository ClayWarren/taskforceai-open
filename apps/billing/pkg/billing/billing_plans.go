package billing

import (
	"os"
	"strings"
	"time"

	corepayments "github.com/TaskForceAI/core/pkg/payments"
	"github.com/claywarren/revenuecat"
)

// SubscriptionSource represents the payment platform
type SubscriptionSource string

const (
	SourceStripe    SubscriptionSource = "STRIPE"
	SourceAppStore  SubscriptionSource = "APP_STORE"
	SourcePlayStore SubscriptionSource = "PLAY_STORE"
)

// MobileSyncUser represents user data for mobile subscription sync
type MobileSyncUser struct {
	ID                  int
	Email               string
	RevenueCatAppUserID *string
	Plan                string
	SubscriptionSource  *SubscriptionSource
	SubscriptionID      *string
	SubscriptionStatus  *string
	CurrentPeriodStart  *time.Time
	CurrentPeriodEnd    *time.Time
}

// Plan represents subscription tier
type Plan = corepayments.Plan

const (
	PlanFree  = corepayments.PlanFree
	PlanPro   = corepayments.PlanPro
	PlanSuper = corepayments.PlanSuper
)

// BillingPlanDefinition defines a billing plan with platform-specific IDs
type BillingPlanDefinition = corepayments.BillingPlanDefinition

func getEnvOrNil(key string) *string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return &v
	}
	return nil
}

var proPlan = corepayments.NewBillingPlanDefinition(
	PlanPro,
	getEnvOrNil("STRIPE_PRO_PRICE_ID"),
	getEnvOrNil("REVENUECAT_ENTITLEMENT_PRO"),
	getEnvOrNil("APP_STORE_PRO_PRODUCT_ID"),
	getEnvOrNil("PLAY_STORE_PRO_PRODUCT_ID"),
)

var superPlan = corepayments.NewBillingPlanDefinition(
	PlanSuper,
	getEnvOrNil("STRIPE_SUPER_PRICE_ID"),
	getEnvOrNil("REVENUECAT_ENTITLEMENT_SUPER"),
	getEnvOrNil("APP_STORE_SUPER_PRODUCT_ID"),
	getEnvOrNil("PLAY_STORE_SUPER_PRODUCT_ID"),
)

// BillingPlans contains all available billing plans
var BillingPlans = []BillingPlanDefinition{proPlan, superPlan}

// MapStoreError represents an error from MapStoreToSource
type MapStoreError string

const (
	ErrMissingStore MapStoreError = "MISSING_STORE"
	ErrUnknownStore MapStoreError = "UNKNOWN_STORE"
)

// MapStoreToSource converts a RevenueCat store identifier to SubscriptionSource
func MapStoreToSource(store revenuecat.Store) (*SubscriptionSource, MapStoreError) {
	store = revenuecat.Store(strings.TrimSpace(string(store)))
	if store == "" {
		return nil, ErrMissingStore
	}
	switch store {
	case revenuecat.AppStore, revenuecat.MacAppStore:
		src := SourceAppStore
		return &src, ""
	case revenuecat.PlayStore:
		src := SourcePlayStore
		return &src, ""
	case revenuecat.StripeStore, revenuecat.PromotionalStore:
		// Stripe and promotional subscriptions are not mobile sources
		return nil, ErrUnknownStore
	}
	return nil, ErrUnknownStore
}

// ResolvePlanFromRevenueCat finds a plan by entitlement or product ID
func ResolvePlanFromRevenueCat(entitlementID, productID *string) *BillingPlanDefinition {
	return corepayments.ResolveRevenueCatPlan(BillingPlans, entitlementID, productID)
}

// GetPlanByPriceId finds a plan by Stripe price ID
func GetPlanByPriceId(priceID *string) *BillingPlanDefinition {
	return corepayments.FindPlanByPriceID(BillingPlans, priceID)
}

// GetPlanByName finds a plan by name (e.g., "pro", "super")
func GetPlanByName(name string) *BillingPlanDefinition {
	return corepayments.FindPlanByName(BillingPlans, name)
}
