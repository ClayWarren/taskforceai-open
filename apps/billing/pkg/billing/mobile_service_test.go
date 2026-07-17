package billing

import (
	"context"
	"testing"
	"time"

	"github.com/claywarren/revenuecat"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

// mobileUser returns the canonical MobileSyncUser fixture (id 1,
// user@example.com) with the given plan.
func mobileUser(plan string) *MobileSyncUser {
	return &MobileSyncUser{ID: 1, Email: "user@example.com", Plan: plan}
}

func TestRevenueCatAppUserIDForMobileSync_StableUserIDFallback(t *testing.T) {
	user := &MobileSyncUser{
		ID:    1,
		Email: " Test@Example.com ",
		Plan:  "free",
	}

	appUserID := revenueCatAppUserIDForMobileSync(user)

	assert.Equal(t, "1", appUserID)
}

func TestRevenueCatAppUserIDForMobileSync_NilUser(t *testing.T) {
	assert.Empty(t, revenueCatAppUserIDForMobileSync(nil))
}

func TestRevenueCatAppUserIDForMobileSync_PrefersStoredAppUserID(t *testing.T) {
	storedAppUserID := " RC_User_123 "
	user := &MobileSyncUser{
		ID:                  1,
		Email:               "test@example.com",
		RevenueCatAppUserID: &storedAppUserID,
		Plan:                "free",
	}

	appUserID := revenueCatAppUserIDForMobileSync(user)

	assert.Equal(t, "RC_User_123", appUserID)
}

func TestRevenueCatAppUserIDForMobileSync_BlankStoredAppUserIDFallsBackToStableUserID(t *testing.T) {
	storedAppUserID := " "
	user := &MobileSyncUser{
		ID:                  1,
		Email:               " Test@Example.com ",
		RevenueCatAppUserID: &storedAppUserID,
		Plan:                "free",
	}

	appUserID := revenueCatAppUserIDForMobileSync(user)

	assert.Equal(t, "1", appUserID)
}

func TestRevenueCatAppUserIDForMobileSync_DoesNotFallbackToEmail(t *testing.T) {
	user := &MobileSyncUser{
		ID:    0,
		Email: " Test@Example.com ",
		Plan:  "free",
	}

	appUserID := revenueCatAppUserIDForMobileSync(user)

	assert.Empty(t, appUserID)
}

func TestResolveMobileSubscriptionSource_PreservesExistingMobileSource(t *testing.T) {
	source := SourcePlayStore
	user := mobileUser("pro")
	user.SubscriptionSource = &source

	resolved := resolveMobileSubscriptionSource(user, nil, nil, "unknown-product")

	require.NotNil(t, resolved)
	assert.Equal(t, SourcePlayStore, *resolved)
}

func TestHasMobileSubscriptionProvenance_NilUser(t *testing.T) {
	assert.False(t, hasMobileSubscriptionProvenance(nil))
}

// MockMobileSubscriptionRepository implements MobileSubscriptionRepository for testing
type MockMobileSubscriptionRepository struct {
	mock.Mock
}

func (m *MockMobileSubscriptionRepository) FindUserByID(ctx context.Context, id int) (*MobileSyncUser, error) {
	args := m.Called(ctx, id)
	val, _ := args.Get(0).(*MobileSyncUser)
	return val, args.Error(1)
}

func (m *MockMobileSubscriptionRepository) FindUserByAppUserID(ctx context.Context, appUserID string) (*MobileSyncUser, error) {
	args := m.Called(ctx, appUserID)
	val, _ := args.Get(0).(*MobileSyncUser)
	return val, args.Error(1)
}

func (m *MockMobileSubscriptionRepository) UpdateUser(ctx context.Context, id int, update MobileSubscriptionUpdate) (*MobileSyncUser, error) {
	args := m.Called(ctx, id, update)
	val, _ := args.Get(0).(*MobileSyncUser)
	return val, args.Error(1)
}

// MockRevenueCatFetcher implements RevenueCatFetcher for testing
type MockRevenueCatFetcher struct {
	mock.Mock
}

func (m *MockRevenueCatFetcher) FetchSubscriber(ctx context.Context, appUserID string) (*revenuecat.Subscriber, RevenueCatError) {
	args := m.Called(ctx, appUserID)
	sub, _ := args.Get(0).(*revenuecat.Subscriber)
	err, _ := args.Get(1).(RevenueCatError)
	return sub, err
}

func TestDefaultRevenueCatFetcher(t *testing.T) {
	t.Setenv("REVENUECAT_SECRET_KEY", "")
	fetcher := &DefaultRevenueCatFetcher{}
	_, rcErr := fetcher.FetchSubscriber(context.Background(), "app_user_123")
	assert.NotEmpty(t, rcErr)
}

func TestFormatSyncResult_EmptyPlan(t *testing.T) {
	user := mobileUser("")

	result := formatSyncResult(user)

	assert.Equal(t, "free", result.Plan)
}

func TestFormatSyncResult_NilOptionalFields(t *testing.T) {
	user := mobileUser("pro")

	result := formatSyncResult(user)

	assert.Equal(t, "pro", result.Plan)
	assert.Nil(t, result.SubscriptionStatus)
	assert.Nil(t, result.SubscriptionSource)
	assert.Nil(t, result.CurrentPeriodEnd)
}

func TestFormatSyncResult_WithAllFields(t *testing.T) {
	source := SourceAppStore
	status := "active"
	periodEnd := time.Now().Add(30 * 24 * time.Hour)

	user := &MobileSyncUser{
		ID:                 1,
		Email:              "user@example.com",
		Plan:               "pro",
		SubscriptionSource: &source,
		SubscriptionStatus: &status,
		CurrentPeriodEnd:   &periodEnd,
	}

	result := formatSyncResult(user)

	assert.Equal(t, "pro", result.Plan)
	assert.Equal(t, "active", *result.SubscriptionStatus)
	assert.Equal(t, "APP_STORE", *result.SubscriptionSource)
	assert.NotNil(t, result.CurrentPeriodEnd)
}

func TestMobileSources_Contains(t *testing.T) {
	assert.True(t, mobileSources[SourceAppStore])
	assert.True(t, mobileSources[SourcePlayStore])
	assert.False(t, mobileSources[SourceStripe])
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_Basic(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	user := mobileUser("free")

	futureExpiry := time.Now().Add(30 * 24 * time.Hour)
	entitlement := &revenuecat.Entitlement{
		ProductIdentifier: "com.app.pro",
		ExpiresDate:       &futureExpiry,
	}

	subscriber := &revenuecat.Subscriber{
		Subscriptions: map[string]revenuecat.Subscription{
			"com.app.pro": {
				Store:              revenuecat.AppStore,
				PurchaseDate:       time.Now(),
				StoreTransactionID: "txn_123",
			},
		},
	}

	planDef := &BillingPlanDefinition{
		Plan: "pro",
	}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	assert.Equal(t, "pro", *update.Plan)
	assert.Equal(t, "active", *update.SubscriptionStatus)
	assert.NotNil(t, update.SubscriptionSource)
	assert.Equal(t, "txn_123", *update.SubscriptionID)
	assert.Equal(t, "app_user_123", *update.RevenueCatAppUserID)
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_ExpiredStatus(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	user := mobileUser("")

	pastExpiry := time.Now().Add(-24 * time.Hour)
	entitlement := &revenuecat.Entitlement{
		ProductIdentifier: "com.app.pro",
		ExpiresDate:       &pastExpiry,
	}

	subscriber := &revenuecat.Subscriber{}

	planDef := &BillingPlanDefinition{
		Plan: "pro",
	}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	assert.Equal(t, "expired", *update.SubscriptionStatus)
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_FallbackSourceFromAppStoreProduct(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	user := mobileUser("free")

	futureExpiry := time.Now().Add(30 * 24 * time.Hour)
	entitlement := &revenuecat.Entitlement{
		ProductIdentifier: "com.app.pro",
		ExpiresDate:       &futureExpiry,
	}

	subscriber := &revenuecat.Subscriber{}
	appStoreProductID := "com.app.pro"
	playStoreProductID := "com.app.super"
	planDef := &BillingPlanDefinition{
		Plan:               "pro",
		AppStoreProductID:  &appStoreProductID,
		PlayStoreProductID: &playStoreProductID,
	}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	assert.NotNil(t, update.SubscriptionSource)
	assert.Equal(t, SourceAppStore, *update.SubscriptionSource)
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_FallbackSourceFromPlayStoreProduct(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	user := mobileUser("free")

	futureExpiry := time.Now().Add(30 * 24 * time.Hour)
	entitlement := &revenuecat.Entitlement{
		ProductIdentifier: "com.app.super",
		ExpiresDate:       &futureExpiry,
	}

	subscriber := &revenuecat.Subscriber{}
	appStoreProductID := "com.app.pro"
	playStoreProductID := "com.app.super"
	planDef := &BillingPlanDefinition{
		Plan:               "super",
		AppStoreProductID:  &appStoreProductID,
		PlayStoreProductID: &playStoreProductID,
	}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	assert.NotNil(t, update.SubscriptionSource)
	assert.Equal(t, SourcePlayStore, *update.SubscriptionSource)
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_GracePeriod(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	user := mobileUser("")

	gracePeriod := time.Now().Add(7 * 24 * time.Hour)
	entitlement := &revenuecat.Entitlement{
		ProductIdentifier:      "com.app.pro",
		ExpiresDate:            nil, // No regular expiry
		GracePeriodExpiresDate: &gracePeriod,
	}

	subscriber := &revenuecat.Subscriber{}

	planDef := &BillingPlanDefinition{
		Plan: "pro",
	}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	assert.Equal(t, gracePeriod, *update.CurrentPeriodEnd)
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_GracePeriodAfterExpiryStaysActive(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	user := mobileUser("")

	pastExpiry := time.Now().Add(-24 * time.Hour)
	gracePeriod := time.Now().Add(7 * 24 * time.Hour)
	entitlement := &revenuecat.Entitlement{
		ProductIdentifier:      "com.app.pro",
		ExpiresDate:            &pastExpiry,
		GracePeriodExpiresDate: &gracePeriod,
	}

	subscriber := &revenuecat.Subscriber{}
	planDef := &BillingPlanDefinition{Plan: "pro"}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	assert.Equal(t, "active", *update.SubscriptionStatus)
	assert.Equal(t, gracePeriod, *update.CurrentPeriodEnd)
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_NoSubscriptionDetail(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	subID := "existing_sub"
	periodStart := time.Now().Add(-24 * time.Hour)
	periodEnd := time.Now().Add(30 * 24 * time.Hour)
	user := &MobileSyncUser{
		ID:                 1,
		Email:              "user@example.com",
		Plan:               "free",
		SubscriptionID:     &subID,
		CurrentPeriodStart: &periodStart,
		CurrentPeriodEnd:   &periodEnd,
	}

	futureExpiry := time.Now().Add(30 * 24 * time.Hour)
	entitlement := &revenuecat.Entitlement{
		ProductIdentifier: "com.app.pro",
		ExpiresDate:       &futureExpiry,
	}

	subscriber := &revenuecat.Subscriber{
		Subscriptions: nil, // No subscriptions map
	}

	planDef := &BillingPlanDefinition{
		Plan: "pro",
	}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	assert.Equal(t, "pro", *update.Plan)
	// Should fall back to user's subscription ID
	assert.Equal(t, "existing_sub", *update.SubscriptionID)
	// Should fall back to user's period dates
	assert.Equal(t, periodStart, *update.CurrentPeriodStart)
	assert.Equal(t, futureExpiry, *update.CurrentPeriodEnd) // Uses entitlement expiry
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_FallsBackToExistingPeriodEnd(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	periodEnd := time.Now().Add(30 * 24 * time.Hour)
	user := mobileUser("free")
	user.CurrentPeriodEnd = &periodEnd

	entitlement := &revenuecat.Entitlement{
		ProductIdentifier: "com.app.pro",
	}
	subscriber := &revenuecat.Subscriber{}
	planDef := &BillingPlanDefinition{Plan: "pro"}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	require.NotNil(t, update.CurrentPeriodEnd)
	assert.Equal(t, periodEnd, *update.CurrentPeriodEnd)
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_SubscriptionExpiryFromDetail(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	user := mobileUser("")

	// Entitlement without expiry, but subscription detail has expiry
	entitlement := &revenuecat.Entitlement{
		ProductIdentifier: "com.app.pro",
		ExpiresDate:       nil,
	}

	futureExpiry := time.Now().Add(30 * 24 * time.Hour)
	subscriber := &revenuecat.Subscriber{
		Subscriptions: map[string]revenuecat.Subscription{
			"com.app.pro": {
				Store:        revenuecat.AppStore,
				PurchaseDate: time.Now(),
				ExpiresDate:  &futureExpiry,
			},
		},
	}

	planDef := &BillingPlanDefinition{
		Plan: "pro",
	}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	// Should use subscription detail's expiry since entitlement has none
	assert.NotNil(t, update.CurrentPeriodEnd)
	assert.Equal(t, futureExpiry, *update.CurrentPeriodEnd)
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_UnknownStore(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	user := &MobileSyncUser{ID: 1, Email: "user@example.com", Plan: "free"}
	futureExpiry := time.Now().Add(24 * time.Hour)
	entitlement := &revenuecat.Entitlement{
		ProductIdentifier: "com.app.pro",
		ExpiresDate:       &futureExpiry,
	}
	subscriber := &revenuecat.Subscriber{
		Subscriptions: map[string]revenuecat.Subscription{
			"com.app.pro": {
				Store:        revenuecat.StripeStore,
				PurchaseDate: time.Now(),
			},
		},
	}
	appStoreID := "com.app.pro"
	planDef := &BillingPlanDefinition{
		Plan:              PlanPro,
		AppStoreProductID: &appStoreID,
	}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	assert.NotNil(t, update.SubscriptionSource)
	assert.Equal(t, SourceAppStore, *update.SubscriptionSource)
}

func TestMobileSubscriptionService_BuildSubscriptionUpdate_Unsubscribed(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	user := mobileUser("")

	futureExpiry := time.Now().Add(30 * 24 * time.Hour)
	entitlement := &revenuecat.Entitlement{
		ProductIdentifier: "com.app.pro",
		ExpiresDate:       &futureExpiry,
	}

	unsubscribeTime := time.Now()
	subscriber := &revenuecat.Subscriber{
		Subscriptions: map[string]revenuecat.Subscription{
			"com.app.pro": {
				Store:                 revenuecat.AppStore,
				PurchaseDate:          time.Now(),
				UnsubscribeDetectedAt: &unsubscribeTime,
			},
		},
	}

	planDef := &BillingPlanDefinition{
		Plan: "pro",
	}

	update := svc.buildSubscriptionUpdate(user, subscriber, entitlement, "app_user_123", planDef)

	assert.True(t, *update.CancelAtPeriodEnd)
}

func TestMobileSubscriptionService_DetermineActiveEntitlement_Empty(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	entitlements := map[string]revenuecat.Entitlement{}

	id, entitlement := svc.determineActiveEntitlement(entitlements)

	assert.Empty(t, id)
	assert.Nil(t, entitlement)
}

func TestMobileSubscriptionService_DetermineActiveEntitlement_Expired(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	pastExpiry := time.Now().Add(-24 * time.Hour)
	entitlements := map[string]revenuecat.Entitlement{
		"pro": {
			ProductIdentifier: "com.app.pro",
			ExpiresDate:       &pastExpiry,
		},
	}

	id, entitlement := svc.determineActiveEntitlement(entitlements)

	assert.Empty(t, id)
	assert.Nil(t, entitlement)
}

func TestMobileSubscriptionService_DetermineActiveEntitlement_GracePeriod(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	pastExpiry := time.Now().Add(-24 * time.Hour)
	futureGracePeriodExpiry := time.Now().Add(24 * time.Hour)
	entitlements := map[string]revenuecat.Entitlement{
		"pro": {
			ProductIdentifier:      "com.app.pro",
			ExpiresDate:            &pastExpiry,
			GracePeriodExpiresDate: &futureGracePeriodExpiry,
		},
	}

	id, entitlement := svc.determineActiveEntitlement(entitlements)

	assert.Equal(t, "pro", id)
	assert.NotNil(t, entitlement)
}

func TestMobileSubscriptionService_DetermineActiveEntitlement_FutureExpiry(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	futureExpiry := time.Now().Add(24 * time.Hour)
	entitlements := map[string]revenuecat.Entitlement{
		"pro": {
			ProductIdentifier: "com.app.pro",
			ExpiresDate:       &futureExpiry,
		},
	}

	id, entitlement := svc.determineActiveEntitlement(entitlements)

	assert.Equal(t, "pro", id)
	assert.NotNil(t, entitlement)
}

func TestMobileSubscriptionService_DetermineActiveEntitlement_NoExpiry(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	entitlements := map[string]revenuecat.Entitlement{
		"lifetime": {
			ProductIdentifier: "com.app.lifetime",
			ExpiresDate:       nil, // Lifetime, no expiry
		},
	}

	id, entitlement := svc.determineActiveEntitlement(entitlements)

	assert.Equal(t, "lifetime", id)
	assert.NotNil(t, entitlement)
}

func TestMobileSubscriptionService_DetermineActiveEntitlement_FreeRank(t *testing.T) {
	originalPlans := BillingPlans
	t.Cleanup(func() { BillingPlans = originalPlans })
	freeEntitlement := "free"
	BillingPlans = []BillingPlanDefinition{{Plan: PlanFree, RevenueCatEntitlement: &freeEntitlement}}

	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	futureExpiry := time.Now().Add(24 * time.Hour)
	entitlements := map[string]revenuecat.Entitlement{
		"free": {
			ProductIdentifier: "com.app.free",
			ExpiresDate:       &futureExpiry,
		},
	}

	id, entitlement := svc.determineActiveEntitlement(entitlements)

	assert.Equal(t, "free", id)
	assert.NotNil(t, entitlement)
}

func TestMobileSubscriptionService_DetermineActiveEntitlement_PrefersHigherRank(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)

	futureExpiry := time.Now().Add(24 * time.Hour)
	entitlements := map[string]revenuecat.Entitlement{
		"pro": {
			ProductIdentifier: "com.app.pro",
			ExpiresDate:       &futureExpiry,
		},
		"super": {
			ProductIdentifier: "com.app.super",
			ExpiresDate:       &futureExpiry,
		},
	}

	id, entitlement := svc.determineActiveEntitlement(entitlements)

	assert.Equal(t, "super", id)
	assert.NotNil(t, entitlement)
}

func TestMobileSubscriptionService_DetermineActiveEntitlement_PrefersNoExpiryForSameRank(t *testing.T) {
	originalPlans := BillingPlans
	t.Cleanup(func() { BillingPlans = originalPlans })
	entitlementA := "a"
	entitlementB := "b"
	BillingPlans = []BillingPlanDefinition{
		{Plan: PlanPro, RevenueCatEntitlement: &entitlementA},
		{Plan: PlanPro, RevenueCatEntitlement: &entitlementB},
	}

	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	futureExpiry := time.Now().Add(24 * time.Hour)
	entitlements := map[string]revenuecat.Entitlement{
		"a": {ProductIdentifier: "com.app.pro.monthly", ExpiresDate: &futureExpiry},
		"b": {ProductIdentifier: "com.app.pro.lifetime"},
	}

	id, entitlement := svc.determineActiveEntitlement(entitlements)

	assert.Equal(t, "b", id)
	assert.NotNil(t, entitlement)
}

func TestMobileSubscriptionService_DetermineActiveEntitlement_PrefersLaterExpiryForSameRank(t *testing.T) {
	originalPlans := BillingPlans
	t.Cleanup(func() { BillingPlans = originalPlans })
	entitlementA := "a"
	entitlementB := "b"
	BillingPlans = []BillingPlanDefinition{
		{Plan: PlanPro, RevenueCatEntitlement: &entitlementA},
		{Plan: PlanPro, RevenueCatEntitlement: &entitlementB},
	}

	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	soon := time.Now().Add(24 * time.Hour)
	later := time.Now().Add(48 * time.Hour)
	entitlements := map[string]revenuecat.Entitlement{
		"a": {ProductIdentifier: "com.app.pro.monthly", ExpiresDate: &soon},
		"b": {ProductIdentifier: "com.app.pro.annual", ExpiresDate: &later},
	}

	id, entitlement := svc.determineActiveEntitlement(entitlements)

	assert.Equal(t, "b", id)
	assert.NotNil(t, entitlement)
}

func TestMobileSubscriptionService_ResetSubscription_MobileSource(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	ctx := context.Background()

	source := SourceAppStore
	user := mobileUser("pro")
	user.SubscriptionSource = &source

	updatedUser := mobileUser("free")

	mockRepo.On("UpdateUser", ctx, 1, mock.MatchedBy(func(u MobileSubscriptionUpdate) bool {
		return u.ClearSubscription && *u.Plan == "free" && u.SubscriptionID == nil
	})).Return(updatedUser, nil).Once()

	result, err := svc.resetSubscription(ctx, user)

	require.NoError(t, err)
	assert.Equal(t, "free", result.Plan)
	mockRepo.AssertExpectations(t)
}

func TestMobileSubscriptionService_ResetSubscription_NilSource(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	ctx := context.Background()

	user := &MobileSyncUser{
		ID:                 1,
		Email:              "user@example.com",
		Plan:               "pro",
		SubscriptionSource: nil,
	}

	// Should not call UpdateUser for nil source
	result, err := svc.resetSubscription(ctx, user)

	require.NoError(t, err)
	assert.Equal(t, "pro", result.Plan)
	mockRepo.AssertNotCalled(t, "UpdateUser")
}

func TestMobileSubscriptionService_ResetSubscription_NonMobileSource(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	ctx := context.Background()

	source := SourceStripe
	user := mobileUser("pro")
	user.SubscriptionSource = &source
	revenueCatAppUserID := "linked-revenuecat-customer"
	user.RevenueCatAppUserID = &revenueCatAppUserID

	// Stripe remains authoritative even if the account is also linked to RevenueCat.
	result, err := svc.resetSubscription(ctx, user)

	require.NoError(t, err)
	assert.Equal(t, "pro", result.Plan)
	mockRepo.AssertNotCalled(t, "UpdateUser")
}
