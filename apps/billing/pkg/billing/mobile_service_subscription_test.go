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

func newMobileSubscriptionServiceWithFetcher(repo MobileSubscriptionRepository, fetcher RevenueCatFetcher) *MobileSubscriptionService {
	return &MobileSubscriptionService{
		repo:              repo,
		revenueCatFetcher: fetcher,
	}
}

func TestMobileSubscriptionService_ResetSubscription_UpdateError(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	ctx := context.Background()

	source := SourceAppStore
	user := mobileUser("pro")
	user.SubscriptionSource = &source

	mockRepo.On("UpdateUser", ctx, 1, mock.Anything).Return(nil, assert.AnError).Once()

	result, err := svc.resetSubscription(ctx, user)

	require.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "failed to reset subscription")
}

func TestMobileSubscriptionService_SyncByAppUserID_MissingUserRecord(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	ctx := context.Background()

	mockRepo.On("FindUserByAppUserID", ctx, "missing_user").Return(nil, ErrBillingUserNotFound).Once()

	result, err := svc.SyncMobileSubscriptionByAppUserID(ctx, "missing_user")

	assert.Equal(t, ErrUserNotFound, err)
	assert.Nil(t, result)
	mockRepo.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByAppUserID_LegacyMissingUserRecord(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	ctx := context.Background()

	mockRepo.On("FindUserByAppUserID", ctx, "missing_user").Return(nil, nil).Once()

	result, err := svc.SyncMobileSubscriptionByAppUserID(ctx, "missing_user")

	assert.Equal(t, ErrUserNotFound, err)
	assert.Nil(t, result)
	mockRepo.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByAppUserID_NonRevenueCatFailure(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	source := SourceAppStore
	user := mobileUser("pro")
	user.SubscriptionSource = &source

	mockRepo.On("FindUserByAppUserID", ctx, "app_user_999").Return(user, nil).Once()
	mockFetcher.On("FetchSubscriber", mock.Anything, "1").Return(nil, ErrRevenueCatNotFound).Once()
	mockRepo.On("UpdateUser", ctx, 1, mock.Anything).Return(nil, assert.AnError).Once()

	result, err := svc.SyncMobileSubscriptionByAppUserID(ctx, "app_user_999")

	assert.Equal(t, ErrSyncFailed, err)
	assert.Nil(t, result)
}

func TestMobileSubscriptionService_SyncByAppUserID_Success(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	source := SourceAppStore
	user := mobileUser("pro")
	user.SubscriptionSource = &source

	updatedUser := mobileUser("free")

	mockRepo.On("FindUserByAppUserID", ctx, "app_user_456").Return(user, nil).Once()
	mockFetcher.On("FetchSubscriber", mock.Anything, "1").Return(nil, ErrRevenueCatNotFound).Once()
	mockRepo.On("UpdateUser", ctx, 1, mock.Anything).Return(updatedUser, nil).Once()

	result, err := svc.SyncMobileSubscriptionByAppUserID(ctx, "app_user_456")

	assert.Empty(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, "free", result.Plan)
	mockRepo.AssertExpectations(t)
	mockFetcher.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByAppUserID_SyncFailed(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	user := mobileUser("free")

	mockRepo.On("FindUserByAppUserID", ctx, "app_user_789").Return(user, nil).Once()
	mockFetcher.On("FetchSubscriber", mock.Anything, "1").Return(nil, RevenueCatError("API_ERROR")).Once()

	result, err := svc.SyncMobileSubscriptionByAppUserID(ctx, "app_user_789")

	assert.Equal(t, ErrRevenueCatError, err)
	assert.Nil(t, result)
}

func TestMobileSubscriptionService_SyncByAppUserID_UserNotFound(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	ctx := context.Background()

	mockRepo.On("FindUserByAppUserID", ctx, "app_user_123").Return(nil, assert.AnError).Once()

	result, err := svc.SyncMobileSubscriptionByAppUserID(ctx, "app_user_123")

	assert.Equal(t, ErrSyncFailed, err)
	assert.Nil(t, result)
	mockRepo.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByUserID_NoActiveEntitlements(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	source := SourceAppStore
	user := mobileUser("pro")
	user.SubscriptionSource = &source

	// Subscriber with expired entitlement
	pastExpiry := time.Now().Add(-24 * time.Hour)
	subscriber := &revenuecat.Subscriber{
		Entitlements: map[string]revenuecat.Entitlement{
			"pro": {
				ProductIdentifier: "com.app.pro",
				ExpiresDate:       &pastExpiry,
			},
		},
	}

	updatedUser := mobileUser("free")

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()
	mockFetcher.On("FetchSubscriber", mock.Anything, "1").Return(subscriber, RevenueCatError("")).Once()
	mockRepo.On("UpdateUser", ctx, 1, mock.Anything).Return(updatedUser, nil).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.NoError(t, err)
	assert.Equal(t, "free", result.Plan)
}

func TestMobileSubscriptionService_SyncByUserID_NoRevenueCatKey(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	// Ensure REVENUECAT_SECRET_KEY is NOT set
	t.Setenv("REVENUECAT_SECRET_KEY", "")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	user := mobileUser("free")

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "REVENUECAT_SECRET_KEY not configured")
	assert.Nil(t, result)
}

func TestMobileSubscriptionService_SyncByUserID_PlanMismatch(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	source := SourceAppStore
	user := mobileUser("pro")
	user.SubscriptionSource = &source

	futureExpiry := time.Now().Add(30 * 24 * time.Hour)
	subscriber := &revenuecat.Subscriber{
		Entitlements: map[string]revenuecat.Entitlement{
			"unknown_entitlement": {
				ProductIdentifier: "com.app.unknown",
				ExpiresDate:       &futureExpiry,
			},
		},
	}
	updatedUser := mobileUser("free")

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()
	mockFetcher.On("FetchSubscriber", mock.Anything, "1").Return(subscriber, RevenueCatError("")).Once()
	mockRepo.On("UpdateUser", ctx, 1, mock.MatchedBy(func(u MobileSubscriptionUpdate) bool {
		return u.ClearSubscription && u.Plan != nil && *u.Plan == "free"
	})).Return(updatedUser, nil).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, "free", result.Plan)
	mockRepo.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByUserID_RevenueCatFetchFailed(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	user := mobileUser("free")

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()
	mockFetcher.On("FetchSubscriber", mock.Anything, "1").Return(nil, RevenueCatError("API_ERROR")).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "RevenueCat fetch failed")
	assert.Nil(t, result)
}

func TestMobileSubscriptionService_SyncByUserID_RevenueCatNotFound(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	source := SourceAppStore
	user := mobileUser("pro")
	user.SubscriptionSource = &source

	freePlan := "free"
	updatedUser := mobileUser("free")

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()
	mockFetcher.On("FetchSubscriber", mock.Anything, "1").Return(nil, ErrRevenueCatNotFound).Once()
	mockRepo.On("UpdateUser", ctx, 1, mock.MatchedBy(func(u MobileSubscriptionUpdate) bool {
		return *u.Plan == freePlan
	})).Return(updatedUser, nil).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, "free", result.Plan)
	mockRepo.AssertExpectations(t)
	mockFetcher.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByUserID_StripeUser(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	// Set env var to pass the initial check
	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	source := SourceStripe
	user := mobileUser("pro")
	user.SubscriptionSource = &source

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, "pro", result.Plan)
	// RevenueCat fetcher should not be called for Stripe users
	mockFetcher.AssertNotCalled(t, "FetchSubscriber")
	mockRepo.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByUserID_StripeUser_WithoutRevenueCatKey(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	source := SourceStripe
	user := mobileUser("pro")
	user.SubscriptionSource = &source

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, "pro", result.Plan)
	mockFetcher.AssertNotCalled(t, "FetchSubscriber")
	mockRepo.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByUserID_UpdateUserError(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	source := SourceAppStore
	user := mobileUser("free")
	user.SubscriptionSource = &source

	futureExpiry := time.Now().Add(30 * 24 * time.Hour)
	subscriber := &revenuecat.Subscriber{
		Entitlements: map[string]revenuecat.Entitlement{
			"pro": {
				ProductIdentifier: "com.app.pro",
				ExpiresDate:       &futureExpiry,
			},
		},
		Subscriptions: map[string]revenuecat.Subscription{
			"com.app.pro": {
				Store:              revenuecat.AppStore,
				PurchaseDate:       time.Now(),
				StoreTransactionID: "txn_123",
			},
		},
	}

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()
	mockFetcher.On("FetchSubscriber", mock.Anything, "1").Return(subscriber, RevenueCatError("")).Once()
	mockRepo.On("UpdateUser", ctx, 1, mock.Anything).Return(nil, assert.AnError).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.Error(t, err)
	assert.Nil(t, result)
}

func TestMobileSubscriptionService_SyncByUserID_UseRevenueCatAppUserID(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	rcAppUserID := "rc_user_123"
	source := SourceAppStore
	user := &MobileSyncUser{
		ID:                  1,
		Email:               "user@example.com",
		RevenueCatAppUserID: &rcAppUserID,
		Plan:                "pro",
		SubscriptionSource:  &source,
	}

	updatedUser := mobileUser("free")

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()
	// Should use RevenueCatAppUserID instead of Email
	mockFetcher.On("FetchSubscriber", mock.Anything, "rc_user_123").Return(nil, ErrRevenueCatNotFound).Once()
	mockRepo.On("UpdateUser", ctx, 1, mock.Anything).Return(updatedUser, nil).Once()

	_, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.NoError(t, err)
	mockFetcher.AssertCalled(t, "FetchSubscriber", mock.Anything, "rc_user_123")
}

func TestMobileSubscriptionService_SyncByUserID_UsesStableUserIDFallback(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	user := &MobileSyncUser{
		ID:    1,
		Email: " Test@Example.com ",
		Plan:  "free",
	}

	futureExpiry := time.Now().Add(30 * 24 * time.Hour)
	subscriber := &revenuecat.Subscriber{
		Entitlements: map[string]revenuecat.Entitlement{
			"pro": {
				ProductIdentifier: "com.app.pro",
				ExpiresDate:       &futureExpiry,
			},
		},
		Subscriptions: map[string]revenuecat.Subscription{
			"com.app.pro": {
				Store:              revenuecat.AppStore,
				PurchaseDate:       time.Now(),
				StoreTransactionID: "txn_123",
			},
		},
	}

	canonicalAppUserID := "1"
	source := SourceAppStore
	status := "active"
	updatedUser := &MobileSyncUser{
		ID:                  1,
		Email:               " Test@Example.com ",
		RevenueCatAppUserID: &canonicalAppUserID,
		Plan:                "pro",
		SubscriptionSource:  &source,
		SubscriptionStatus:  &status,
	}

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()
	mockFetcher.On("FetchSubscriber", mock.Anything, canonicalAppUserID).Return(subscriber, RevenueCatError("")).Once()
	mockRepo.On("UpdateUser", ctx, 1, mock.MatchedBy(func(u MobileSubscriptionUpdate) bool {
		return u.RevenueCatAppUserID != nil &&
			*u.RevenueCatAppUserID == canonicalAppUserID &&
			u.Plan != nil &&
			*u.Plan == string(PlanPro)
	})).Return(updatedUser, nil).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "pro", result.Plan)
	mockRepo.AssertExpectations(t)
	mockFetcher.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByUserID_UserNotFound(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	ctx := context.Background()

	mockRepo.On("FindUserByID", ctx, 1).Return(nil, assert.AnError).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.Error(t, err)
	assert.Nil(t, result)
	mockRepo.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByUserID_UserNotFoundError(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	ctx := context.Background()

	mockRepo.On("FindUserByID", ctx, 99).Return(nil, ErrBillingUserNotFound).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 99)

	require.Error(t, err)
	assert.Nil(t, result)
}

func TestMobileSubscriptionService_SyncByUserID_LegacyMissingUserRecord(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	svc := NewMobileSubscriptionService(mockRepo)
	ctx := context.Background()

	mockRepo.On("FindUserByID", ctx, 99).Return(nil, nil).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 99)

	require.ErrorIs(t, err, ErrMobileSyncUserNotFound)
	assert.Nil(t, result)
	mockRepo.AssertExpectations(t)
}

func TestMobileSubscriptionService_SyncByUserID_WithActiveEntitlement(t *testing.T) {
	mockRepo := new(MockMobileSubscriptionRepository)
	mockFetcher := new(MockRevenueCatFetcher)

	t.Setenv("REVENUECAT_SECRET_KEY", "test_key")

	svc := newMobileSubscriptionServiceWithFetcher(mockRepo, mockFetcher)
	ctx := context.Background()

	user := mobileUser("free")

	futureExpiry := time.Now().Add(30 * 24 * time.Hour)
	subscriber := &revenuecat.Subscriber{
		Entitlements: map[string]revenuecat.Entitlement{
			"pro": {
				ProductIdentifier: "com.app.pro",
				ExpiresDate:       &futureExpiry,
			},
		},
		Subscriptions: map[string]revenuecat.Subscription{
			"com.app.pro": {
				Store:              revenuecat.AppStore,
				PurchaseDate:       time.Now(),
				StoreTransactionID: "txn_123",
			},
		},
	}

	updatedUser := mobileUser("pro")

	mockRepo.On("FindUserByID", ctx, 1).Return(user, nil).Once()
	mockFetcher.On("FetchSubscriber", mock.Anything, "1").Return(subscriber, RevenueCatError("")).Once()
	mockRepo.On("UpdateUser", ctx, 1, mock.Anything).Return(updatedUser, nil).Once()

	result, err := svc.SyncMobileSubscriptionByUserID(ctx, 1)

	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, "pro", result.Plan)
	mockRepo.AssertExpectations(t)
	mockFetcher.AssertExpectations(t)
}

func TestMobileSubscriptionUpdate_Struct(t *testing.T) {
	plan := "pro"
	subID := "sub_123"
	status := "active"
	source := SourceAppStore
	cancelAtEnd := false
	priceID := "price_123"
	appUserID := "app_user_123"
	productID := "com.app.pro"
	txnID := "txn_123"
	now := time.Now()

	update := MobileSubscriptionUpdate{
		Plan:                        &plan,
		SubscriptionID:              &subID,
		SubscriptionStatus:          &status,
		SubscriptionSource:          &source,
		CurrentPeriodStart:          &now,
		CurrentPeriodEnd:            &now,
		CancelAtPeriodEnd:           &cancelAtEnd,
		PriceID:                     &priceID,
		RevenueCatAppUserID:         &appUserID,
		MobileProductID:             &productID,
		MobileOriginalTransactionID: &txnID,
	}

	assert.Equal(t, "pro", *update.Plan)
	assert.Equal(t, "sub_123", *update.SubscriptionID)
	assert.Equal(t, "active", *update.SubscriptionStatus)
	assert.Equal(t, SourceAppStore, *update.SubscriptionSource)
}

func TestMobileSyncError_Constants(t *testing.T) {
	assert.Equal(t, ErrUserNotFound, MobileSyncError("USER_NOT_FOUND"))
	assert.Equal(t, ErrRevenueCatError, MobileSyncError("REVENUECAT_ERROR"))
	assert.Equal(t, ErrSyncFailed, MobileSyncError("SYNC_FAILED"))
}

func TestMobileSyncResult_Struct(t *testing.T) {
	status := "active"
	source := "APP_STORE"
	periodEnd := "2024-12-31T23:59:59Z"

	result := MobileSyncResult{
		Plan:               "pro",
		SubscriptionStatus: &status,
		SubscriptionSource: &source,
		CurrentPeriodEnd:   &periodEnd,
	}

	assert.Equal(t, "pro", result.Plan)
	assert.Equal(t, "active", *result.SubscriptionStatus)
	assert.Equal(t, "APP_STORE", *result.SubscriptionSource)
	assert.Equal(t, "2024-12-31T23:59:59Z", *result.CurrentPeriodEnd)
}

func TestSourceFromPlanProduct_PlayStore(t *testing.T) {
	playID := "com.android.pro"
	planDef := &BillingPlanDefinition{
		Plan:               PlanPro,
		PlayStoreProductID: &playID,
	}

	source := sourceFromPlanProduct(planDef, playID)
	assert.NotNil(t, source)
	assert.Equal(t, SourcePlayStore, *source)
}

func TestSourceFromPlanProduct_NilOrEmpty(t *testing.T) {
	assert.Nil(t, sourceFromPlanProduct(nil, "com.app.pro"))
	assert.Nil(t, sourceFromPlanProduct(&BillingPlanDefinition{Plan: PlanPro}, ""))
}
