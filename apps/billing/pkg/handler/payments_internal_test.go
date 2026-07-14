package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/billing-service/pkg/billing"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

type syncStripeMock struct {
	mock.Mock
}

func TestBuildSubscriptionCheckoutParams_ScopesIdempotencyToAttempt(t *testing.T) {
	first := buildSubscriptionCheckoutParams(42, "cus_123", "price_pro", "https://example.com/success", "https://example.com/cancel", "attempt-1")
	retry := buildSubscriptionCheckoutParams(42, "cus_123", "price_pro", "https://example.com/success", "https://example.com/cancel", "attempt-1")
	newAttempt := buildSubscriptionCheckoutParams(42, "cus_123", "price_pro", "https://example.com/success", "https://example.com/cancel", "attempt-2")
	otherPrice := buildSubscriptionCheckoutParams(42, "cus_123", "price_super", "https://example.com/success", "https://example.com/cancel", "attempt-1")

	require.NotNil(t, first.IdempotencyKey)
	require.NotNil(t, retry.IdempotencyKey)
	require.NotNil(t, otherPrice.IdempotencyKey)
	assert.Equal(t, *first.IdempotencyKey, *retry.IdempotencyKey)
	assert.NotEqual(t, *first.IdempotencyKey, *newAttempt.IdempotencyKey)
	assert.NotEqual(t, *first.IdempotencyKey, *otherPrice.IdempotencyKey)
}

func TestStripeSubscriptionUpdate_ClearsCanceledSubscription(t *testing.T) {
	update := stripeSubscriptionUpdate(&stripe.Subscription{ID: "sub_123", Status: stripe.SubscriptionStatusCanceled})

	assert.True(t, update.ClearSubscription)
	require.NotNil(t, update.Plan)
	assert.Equal(t, string(billing.PlanFree), *update.Plan)
}

func TestStripeSubscriptionUpdate_HandlesMissingItems(t *testing.T) {
	assert.NotPanics(t, func() {
		update := stripeSubscriptionUpdate(&stripe.Subscription{ID: "sub_123", Status: stripe.SubscriptionStatusActive})
		assert.Equal(t, "sub_123", *update.SubscriptionID)
	})
}

func mockResult[T any](args mock.Arguments) (T, error) {
	val, _ := args.Get(0).(T)
	return val, args.Error(1)
}

func (m *syncStripeMock) GetOrCreateCustomer(ctx context.Context, userID, email, customerID string) (*stripe.Customer, error) {
	return mockResult[*stripe.Customer](m.Called(ctx, userID, email, customerID))
}

func (m *syncStripeMock) CreateCheckoutSession(ctx context.Context, params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
	return mockResult[*stripe.CheckoutSession](m.Called(ctx, params))
}

func (m *syncStripeMock) GetSubscription(ctx context.Context, id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	return mockResult[*stripe.Subscription](m.Called(ctx, id, params))
}

func (m *syncStripeMock) UpdateSubscription(ctx context.Context, id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	return mockResult[*stripe.Subscription](m.Called(ctx, id, params))
}

func TestNormalizeOrigin(t *testing.T) {
	tests := []struct {
		name     string
		origin   string
		expected string
		ok       bool
	}{
		{"empty", "", "", false},
		{"valid https", "https://Example.COM", "https://example.com", true},
		{"valid http with slash", "http://localhost:3000/", "http://localhost:3000", true},
		{"invalid scheme", "ftp://example.com", "", false},
		{"missing host", "https://", "", false},
		{"user info", "https://user:pass@example.com", "", false},
		{"query string", "https://example.com?x=1", "", false},
		{"fragment", "https://example.com#frag", "", false},
		{"nested path", "https://example.com/nested", "", false},
		{"unparseable", "://bad", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := normalizeOrigin(tt.origin)
			assert.Equal(t, tt.ok, ok)
			assert.Equal(t, tt.expected, got)
		})
	}
}

func TestShouldSyncStripeSubscription(t *testing.T) {
	subID := "sub_123"
	status := "active"
	source := billing.SourceStripe

	assert.False(t, shouldSyncStripeSubscription(nil, true))
	assert.False(t, shouldSyncStripeSubscription(&billing.PaymentsAccountUser{ID: 1}, true))

	userWithStatus := &billing.PaymentsAccountUser{
		ID:                 1,
		SubscriptionID:     &subID,
		SubscriptionStatus: &status,
		SubscriptionSource: &source,
	}
	assert.False(t, shouldSyncStripeSubscription(userWithStatus, false))
	assert.True(t, shouldSyncStripeSubscription(userWithStatus, true))

	userWithoutStatus := &billing.PaymentsAccountUser{
		ID:                 1,
		SubscriptionID:     &subID,
		SubscriptionSource: &source,
	}
	assert.True(t, shouldSyncStripeSubscription(userWithoutStatus, false))
}

func TestSyncSubscription_Success(t *testing.T) {
	mockStripe := new(syncStripeMock)
	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		return mockStripe, nil
	}

	mockRepo := new(mockPaymentsRepo)
	subID := "sub_123"
	source := billing.SourceStripe
	user := &billing.PaymentsAccountUser{
		ID:                 1,
		SubscriptionID:     &subID,
		SubscriptionSource: &source,
	}

	now := time.Now().Unix()
	mockStripe.On("GetSubscription", mock.Anything, subID, mock.Anything).Return(&stripe.Subscription{
		ID:                subID,
		Status:            stripe.SubscriptionStatusActive,
		CancelAtPeriodEnd: true,
		Items: &stripe.SubscriptionItemList{
			Data: []*stripe.SubscriptionItem{
				{CurrentPeriodStart: now, CurrentPeriodEnd: now + 3600},
			},
		},
	}, nil)
	mockRepo.On("UpdateSubscription", mock.Anything, 1, mock.Anything).Return(nil)

	syncSubscription(context.Background(), mockRepo, user)
	mockStripe.AssertExpectations(t)
	mockRepo.AssertExpectations(t)
}

func TestSyncSubscription_UpdateError(t *testing.T) {
	mockStripe := new(syncStripeMock)
	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		return mockStripe, nil
	}

	mockRepo := new(mockPaymentsRepo)
	subID := "sub_123"
	user := &billing.PaymentsAccountUser{ID: 1, SubscriptionID: &subID}

	mockStripe.On("GetSubscription", mock.Anything, subID, mock.Anything).Return(&stripe.Subscription{
		ID:     subID,
		Status: stripe.SubscriptionStatusActive,
		Items:  &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}, nil)
	mockRepo.On("UpdateSubscription", mock.Anything, 1, mock.Anything).Return(errors.New("update failed"))

	syncSubscription(context.Background(), mockRepo, user)
	mockRepo.AssertExpectations(t)
}

func TestSyncStripeSubscriptionAndReload_RefetchError(t *testing.T) {
	mockStripe := new(syncStripeMock)
	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		return mockStripe, nil
	}

	mockRepo := new(mockPaymentsRepo)
	subID := "sub_123"
	user := &billing.PaymentsAccountUser{ID: 1, SubscriptionID: &subID}

	mockStripe.On("GetSubscription", mock.Anything, subID, mock.Anything).Return(&stripe.Subscription{
		ID:     subID,
		Status: stripe.SubscriptionStatusActive,
		Items:  &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}, nil)
	mockRepo.On("UpdateSubscription", mock.Anything, 1, mock.Anything).Return(nil)
	mockRepo.On("FindUserByID", mock.Anything, 1).Return(nil, errors.New("refetch failed"))

	result := syncStripeSubscriptionAndReload(context.Background(), mockRepo, user)
	assert.Equal(t, user, result)
}

func TestSyncStripeSubscriptionAndReload_RefetchNotFound(t *testing.T) {
	mockStripe := new(syncStripeMock)
	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		return mockStripe, nil
	}

	mockRepo := new(mockPaymentsRepo)
	subID := "sub_123"
	user := &billing.PaymentsAccountUser{ID: 1, SubscriptionID: &subID}

	mockStripe.On("GetSubscription", mock.Anything, subID, mock.Anything).Return(&stripe.Subscription{
		ID:     subID,
		Status: stripe.SubscriptionStatusActive,
		Items:  &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}, nil)
	mockRepo.On("UpdateSubscription", mock.Anything, 1, mock.Anything).Return(nil)
	mockRepo.On("FindUserByID", mock.Anything, 1).Return(nil, billing.ErrBillingUserNotFound)

	result := syncStripeSubscriptionAndReload(context.Background(), mockRepo, user)
	assert.Equal(t, user, result)
}

func TestSyncStripeSubscriptionAndReload_Success(t *testing.T) {
	mockStripe := new(syncStripeMock)
	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		return mockStripe, nil
	}

	mockRepo := new(mockPaymentsRepo)
	subID := "sub_123"
	source := billing.SourceStripe
	user := &billing.PaymentsAccountUser{
		ID:                 1,
		SubscriptionID:     &subID,
		SubscriptionSource: &source,
	}
	updated := &billing.PaymentsAccountUser{
		ID:                 1,
		SubscriptionID:     &subID,
		SubscriptionSource: &source,
	}

	mockStripe.On("GetSubscription", mock.Anything, subID, mock.Anything).Return(&stripe.Subscription{
		ID:     subID,
		Status: stripe.SubscriptionStatusActive,
		Items:  &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}, nil)
	mockRepo.On("UpdateSubscription", mock.Anything, 1, mock.Anything).Return(nil)
	mockRepo.On("FindUserByID", mock.Anything, 1).Return(updated, nil)

	result := syncStripeSubscriptionAndReload(context.Background(), mockRepo, user)
	assert.Equal(t, updated, result)
}

func TestIsStripeManagedSubscription(t *testing.T) {
	subID := "sub_123"
	stripeSource := billing.SourceStripe
	mobileSource := billing.SourceAppStore
	revenueCatAppUserID := "rc_123"

	assert.False(t, isStripeManagedSubscription(nil))
	assert.True(t, isStripeManagedSubscription(&billing.PaymentsAccountUser{SubscriptionID: &subID}))
	assert.False(t, isStripeManagedSubscription(&billing.PaymentsAccountUser{RevenueCatAppUserID: &revenueCatAppUserID}))
	assert.True(t, isStripeManagedSubscription(&billing.PaymentsAccountUser{
		SubscriptionID:     &subID,
		SubscriptionSource: &stripeSource,
	}))
	assert.False(t, isStripeManagedSubscription(&billing.PaymentsAccountUser{
		SubscriptionID:     &subID,
		SubscriptionSource: &mobileSource,
	}))
}

func TestPersistStripeCustomerIDIfChanged(t *testing.T) {
	mockRepo := new(mockPaymentsRepo)
	customerID := "cus_123"

	persistStripeCustomerIDIfChanged(context.Background(), mockRepo, 1, customerID, customerID, "test")
	mockRepo.AssertNotCalled(t, "UpdateCustomerID")

	mockRepo.On("UpdateCustomerID", mock.Anything, 1, "cus_new").Return(nil)
	persistStripeCustomerIDIfChanged(context.Background(), mockRepo, 1, customerID, "cus_new", "test")
	mockRepo.AssertExpectations(t)
}

func TestPersistStripeCustomerIDIfChanged_Error(t *testing.T) {
	mockRepo := new(mockPaymentsRepo)

	mockRepo.On("UpdateCustomerID", mock.Anything, 1, "cus_new").Return(errors.New("update failed"))
	persistStripeCustomerIDIfChanged(context.Background(), mockRepo, 1, "", "cus_new", "test")
	mockRepo.AssertExpectations(t)
}

func TestReadWebhookPayload_ReadError(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/webhook", &errorReader{})
	w := httptest.NewRecorder()

	_, err := ReadWebhookPayload(w, req)
	require.Error(t, err)
	assert.NotErrorIs(t, err, ErrPayloadTooLarge)
}

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) { return 0, errors.New("read failed") }
func (errorReader) Close() error             { return nil }

type mockPaymentsRepo struct {
	mock.Mock
}

func (m *mockPaymentsRepo) FindUserByID(ctx context.Context, userID int) (*billing.PaymentsAccountUser, error) {
	args := m.Called(ctx, userID)
	val, _ := args.Get(0).(*billing.PaymentsAccountUser)
	return val, args.Error(1)
}

func (m *mockPaymentsRepo) FindUserByEmail(ctx context.Context, email string) (*billing.PaymentsAccountUser, error) {
	args := m.Called(ctx, email)
	val, _ := args.Get(0).(*billing.PaymentsAccountUser)
	return val, args.Error(1)
}

func (m *mockPaymentsRepo) UpdateCustomerID(ctx context.Context, userID int, customerID string) error {
	args := m.Called(ctx, userID, customerID)
	return args.Error(0)
}

func (m *mockPaymentsRepo) UpdateSubscription(ctx context.Context, userID int, update billing.SubscriptionUpdate) error {
	args := m.Called(ctx, userID, update)
	return args.Error(0)
}

func TestLoadBillingUserByEmailFromAuthContext(t *testing.T) {
	mockRepo := new(mockPaymentsRepo)
	email := "user@example.com"
	user := &auth.AuthenticatedUser{Email: email}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(context.Background(), adapterhandler.UserContextKey, user))

	dbUser := &billing.PaymentsAccountUser{ID: 1, Email: email}
	mockRepo.On("FindUserByEmail", mock.Anything, email).Return(dbUser, nil)

	found, foundEmail, err := loadBillingUserByEmailFromAuthContext(req, mockRepo)
	require.NoError(t, err)
	assert.Equal(t, email, foundEmail)
	assert.Equal(t, dbUser, found)
}

func TestLoadBillingUserByEmailFromAuthContext_Unauthorized(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	_, _, err := loadBillingUserByEmailFromAuthContext(req, new(mockPaymentsRepo))
	assert.ErrorIs(t, err, errAuthRequired)
}

func TestLoadBillingUserByEmailFromAuthContext_NotFound(t *testing.T) {
	mockRepo := new(mockPaymentsRepo)
	email := "missing@example.com"
	user := &auth.AuthenticatedUser{Email: email}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(context.Background(), adapterhandler.UserContextKey, user))

	mockRepo.On("FindUserByEmail", mock.Anything, email).Return(nil, billing.ErrBillingUserNotFound)

	_, _, err := loadBillingUserByEmailFromAuthContext(req, mockRepo)
	require.Error(t, err)
}

func TestUpdateSubscriptionCancellationState_UpdateError(t *testing.T) {
	mockStripe := new(syncStripeMock)
	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		return mockStripe, nil
	}

	mockRepo := new(mockPaymentsRepo)
	subID := "sub_123"
	dbUser := &billing.PaymentsAccountUser{ID: 1, SubscriptionID: &subID}

	mockStripe.On("UpdateSubscription", mock.Anything, subID, mock.Anything).Return(&stripe.Subscription{
		ID:     subID,
		Status: stripe.SubscriptionStatusActive,
	}, nil)
	mockRepo.On("UpdateSubscription", mock.Anything, 1, mock.Anything).Return(errors.New("db failed"))

	err := updateSubscriptionCancellationState(context.Background(), mockRepo, dbUser, true, "CancelSub")
	assert.Error(t, err)
}

func TestGetSubscriptionResponse_ForceSyncReloadsUser(t *testing.T) {
	mockStripe := new(syncStripeMock)
	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		return mockStripe, nil
	}

	mockRepo := new(mockPaymentsRepo)
	subID := "sub_123"
	source := billing.SourceStripe
	status := "active"
	dbUser := &billing.PaymentsAccountUser{
		ID:                 1,
		SubscriptionID:     &subID,
		SubscriptionSource: &source,
	}
	updated := &billing.PaymentsAccountUser{
		ID:                 1,
		SubscriptionID:     &subID,
		SubscriptionSource: &source,
		SubscriptionStatus: &status,
	}

	mockRepo.On("FindUserByID", mock.Anything, 1).Return(dbUser, nil).Once()
	mockStripe.On("GetSubscription", mock.Anything, subID, mock.Anything).Return(&stripe.Subscription{
		ID:     subID,
		Status: stripe.SubscriptionStatusActive,
		Items:  &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}, nil)
	mockRepo.On("UpdateSubscription", mock.Anything, 1, mock.Anything).Return(nil).Once()
	mockRepo.On("FindUserByID", mock.Anything, 1).Return(updated, nil).Once()

	subscription, err := getSubscriptionResponse(context.Background(), mockRepo, 1, true)
	require.NoError(t, err)
	require.True(t, subscription.UserFound)
	assert.Equal(t, map[string]any{
		"subscription_id":      "sub_123",
		"status":               "active",
		"cancel_at_period_end": false,
	}, subscription.Subscription)
}

func TestGetSubscriptionResponse_MissingUser(t *testing.T) {
	for _, testCase := range []struct {
		name string
		err  error
	}{
		{name: "not found error", err: billing.ErrBillingUserNotFound},
		{name: "legacy nil result"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			mockRepo := new(mockPaymentsRepo)
			mockRepo.On("FindUserByID", mock.Anything, 1).Return(nil, testCase.err).Once()

			lookup, err := getSubscriptionResponse(context.Background(), mockRepo, 1, false)

			require.NoError(t, err)
			assert.False(t, lookup.UserFound)
			assert.Nil(t, lookup.Subscription)
			mockRepo.AssertExpectations(t)
		})
	}
}

func TestGetSubscriptionResponse_ForceSyncSkipsNonStripeSubscription(t *testing.T) {
	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		t.Fatal("force sync should not create a Stripe client for non-Stripe subscriptions")
		return nil, nil
	}

	mockRepo := new(mockPaymentsRepo)
	subID := "sub_123"
	source := billing.SourceAppStore
	dbUser := &billing.PaymentsAccountUser{
		ID:                 1,
		SubscriptionID:     &subID,
		SubscriptionSource: &source,
	}

	mockRepo.On("FindUserByID", mock.Anything, 1).Return(dbUser, nil).Once()

	subscription, err := getSubscriptionResponse(context.Background(), mockRepo, 1, true)
	require.NoError(t, err)
	require.True(t, subscription.UserFound)
	assert.Equal(t, map[string]any{
		"subscription_id":      "sub_123",
		"status":               "unknown",
		"cancel_at_period_end": false,
	}, subscription.Subscription)
	mockRepo.AssertNotCalled(t, "UpdateSubscription")
	mockRepo.AssertExpectations(t)
}

func TestStripeWebhookHandler_ReadBodyError(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", &errorReader{})
	w := httptest.NewRecorder()
	StripeWebhookHandler(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestStripeWebhookHandler_Returns500OnRetryableError(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_123")

	dbMock := dbtest.NewMockPool(t)

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(dbMock), nil
	}

	restore(t, &VerifyStripeWebhookSignature)
	VerifyStripeWebhookSignature = func(payload []byte, signature string) (*stripe.Event, error) {
		return &stripe.Event{ID: "evt_db_fail", Type: "invoice.payment_failed"}, nil
	}

	dbMock.ExpectQuery("SELECT EXISTS").WithArgs("evt_db_fail").WillReturnError(errors.New("db down"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	StripeWebhookHandler(w, req)
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestRevenueCatWebhookHandler_ReadBodyError(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", &errorReader{})
	w := httptest.NewRecorder()
	RevenueCatWebhookHandler(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestRevenueCatWebhookHandler_InvalidBearerToken(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(`{"app_user_id":"user"}`))
	req.Header.Set("Authorization", "Bearer wrong")
	w := httptest.NewRecorder()
	RevenueCatWebhookHandler(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestRevenueCatWebhookHandler_SuccessWithNestedAppUserID(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	var syncedAppUserIDs []string
	restore(t, &NewMobileSubscriptionService)
	NewMobileSubscriptionService = func(repo billing.MobileSubscriptionRepository) MobileSubscriptionService {
		return fakeMobileSubscriptionService{appUserIDs: &syncedAppUserIDs}
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(`{"app_user_id":"outer","event":{"app_user_id":"nested"}}`))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"received":true`)
	assert.Equal(t, []string{"nested", "outer"}, syncedAppUserIDs)
}

func TestRevenueCatWebhookHandler_SyncsOriginalAndAliasIDs(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	var syncedAppUserIDs []string
	restore(t, &NewMobileSubscriptionService)
	NewMobileSubscriptionService = func(repo billing.MobileSubscriptionRepository) MobileSubscriptionService {
		return fakeMobileSubscriptionService{
			appUserIDs: &syncedAppUserIDs,
			appSyncErrByID: map[string]billing.MobileSyncError{
				"current": "",
			},
		}
	}

	body := `{"event":{"app_user_id":"current","original_app_user_id":"original","aliases":["alias"]}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, []string{"current", "original", "alias"}, syncedAppUserIDs)
}

func TestRevenueCatWebhookHandler_AcceptsTransferDestinationWithoutAppUserID(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	var syncedAppUserID string
	restore(t, &NewMobileSubscriptionService)
	NewMobileSubscriptionService = func(repo billing.MobileSubscriptionRepository) MobileSubscriptionService {
		return fakeMobileSubscriptionService{appUserID: &syncedAppUserID}
	}

	body := `{"event":{"transferred_to":["destination"]}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "destination", syncedAppUserID)
}

func TestRevenueCatWebhookHandler_SyncsTransferSourceAndDestination(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	var syncedAppUserIDs []string
	restore(t, &NewMobileSubscriptionService)
	NewMobileSubscriptionService = func(repo billing.MobileSubscriptionRepository) MobileSubscriptionService {
		return fakeMobileSubscriptionService{appUserIDs: &syncedAppUserIDs}
	}

	body := `{"app_user_id":"outer","event":{"transferred_from":["source"],"transferred_to":["destination"]}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, []string{"source", "destination", "outer"}, syncedAppUserIDs)
}

func TestRevenueCatWebhookHandler_UserNotFoundReturnsRetryableError(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	restore(t, &NewMobileSubscriptionService)
	NewMobileSubscriptionService = func(repo billing.MobileSubscriptionRepository) MobileSubscriptionService {
		return fakeMobileSubscriptionService{appSyncErr: billing.ErrUserNotFound}
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(`{"app_user_id":"missing"}`))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "User not ready for subscription sync")
}

func TestRevenueCatWebhookHandler_NumericAppUserIDFallsBackToUserID(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	var fallbackUserID int
	var syncedAppUserIDs []string
	restore(t, &NewMobileSubscriptionService)
	NewMobileSubscriptionService = func(repo billing.MobileSubscriptionRepository) MobileSubscriptionService {
		return fakeMobileSubscriptionService{
			userID:     &fallbackUserID,
			appUserIDs: &syncedAppUserIDs,
			appSyncErr: billing.ErrUserNotFound,
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(`{"app_user_id":"42"}`))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"received":true`)
	assert.Equal(t, []string{"42"}, syncedAppUserIDs)
	assert.Equal(t, 42, fallbackUserID)
}

func TestRevenueCatWebhookHandler_SyncFailureReturnsServerError(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	restore(t, &NewMobileSubscriptionService)
	NewMobileSubscriptionService = func(repo billing.MobileSubscriptionRepository) MobileSubscriptionService {
		return fakeMobileSubscriptionService{appSyncErr: billing.ErrSyncFailed}
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(`{"app_user_id":"user"}`))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.Contains(t, w.Body.String(), "Sync failed")
}

func TestRevenueCatWebhookHandler_InvalidPayload(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(`{`))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "Invalid payload")
}

func TestRevenueCatWebhookHandler_MissingAppUserID(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(`{"event":{}}`))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "Missing app_user_id")
}

func TestRevenueCatWebhookHandler_DatabaseUnavailable(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "secret")

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(`{"app_user_id":"user"}`))
	req.Header.Set("Authorization", "Bearer secret")
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "Database unavailable")
}

func TestGetEnv(t *testing.T) {
	t.Setenv("TEST_BILLING_ENV_KEY", " value ")
	assert.Equal(t, "value", GetEnv("TEST_BILLING_ENV_KEY", "fallback"))
	assert.Equal(t, "fallback", GetEnv("TEST_BILLING_ENV_MISSING", "fallback"))
}

func TestResolveHostedCheckoutPriceID(t *testing.T) {
	restore(t, &billing.BillingPlans)

	t.Run("invalid plan selection", func(t *testing.T) {
		priceID, err := resolveHostedCheckoutPriceID("invalid")
		require.ErrorIs(t, err, errInvalidHostedPlanSelection)
		assert.Empty(t, priceID)
	})

	t.Run("plan not configured", func(t *testing.T) {
		priceID := "price_pro"
		billing.BillingPlans = []billing.BillingPlanDefinition{
			{Plan: billing.PlanPro, StripePriceID: nil},
			{Plan: billing.PlanSuper, StripePriceID: &priceID},
		}

		resolvedPriceID, err := resolveHostedCheckoutPriceID("pro")
		require.ErrorIs(t, err, errHostedPlanNotConfigured)
		assert.Empty(t, resolvedPriceID)
	})

	t.Run("success", func(t *testing.T) {
		priceID := "price_pro"
		superPriceID := "price_super"
		billing.BillingPlans = []billing.BillingPlanDefinition{
			{Plan: billing.PlanPro, StripePriceID: &priceID},
			{Plan: billing.PlanSuper, StripePriceID: &superPriceID},
		}

		resolvedPriceID, err := resolveHostedCheckoutPriceID("pro")
		require.NoError(t, err)
		assert.Equal(t, priceID, resolvedPriceID)
	})
}

func TestValidateAPICheckoutPriceSelection(t *testing.T) {
	restore(t, &billing.BillingPlans)

	priceID := "price_pro"
	superPriceID := "price_super"
	billing.BillingPlans = []billing.BillingPlanDefinition{
		{Plan: billing.PlanPro, StripePriceID: &priceID},
		{Plan: billing.PlanSuper, StripePriceID: &superPriceID},
	}

	_, err := resolveAPICheckoutPlanByPriceID("price_pro")
	require.NoError(t, err)
	_, err = resolveAPICheckoutPlanByPriceID("missing")
	assert.ErrorIs(t, err, errInvalidAPICheckoutPriceSelection)
}

func TestNewStripeClientVar(t *testing.T) {
	_, err := NewStripeClient()
	assert.Error(t, err)
}

func TestNewMobileSubscriptionServiceVar(t *testing.T) {
	svc := NewMobileSubscriptionService(nil)
	assert.NotNil(t, svc)
}

func TestCheckoutHandler_CORS(t *testing.T) {
	assertCORSPreflight(t, CheckoutHandler, "/api/v1/checkout", http.MethodGet)
}

func assertCORSPreflight(t *testing.T, fn http.HandlerFunc, path, method string) {
	t.Helper()

	req := httptest.NewRequest(http.MethodOptions, path, nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", method)
	w := httptest.NewRecorder()

	fn(w, req)
	assert.Equal(t, http.StatusNoContent, w.Code)
}

func TestStripeWebhookHandler_SuccessWithResend(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_123")
	t.Setenv("RESEND_API_KEY", "re_test")

	dbMock := dbtest.NewMockPool(t)

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(dbMock), nil
	}

	restore(t, &VerifyStripeWebhookSignature)
	VerifyStripeWebhookSignature = func(payload []byte, signature string) (*stripe.Event, error) {
		return &stripe.Event{
			ID:   "evt_success",
			Type: "checkout.session.completed",
		}, nil
	}

	dbMock.ExpectQuery("SELECT EXISTS").WithArgs("evt_success").WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))
	dbMock.ExpectExec("INSERT INTO webhook_events").WithArgs("evt_success", "checkout.session.completed", pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	dbMock.ExpectExec("UPDATE webhook_events").WithArgs("evt_success", pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	StripeWebhookHandler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"processed":true`)
}
