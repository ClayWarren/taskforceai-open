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

func TestStripeWebhookHandler_DoesNotRequireStripeSecretKey(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "")

	dbMock := dbtest.NewMockPool(t)

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(dbMock), nil
	}

	restore(t, &VerifyStripeWebhookSignature)
	VerifyStripeWebhookSignature = func(payload []byte, signature string) (*stripe.Event, error) {
		return &stripe.Event{
			ID:   "evt_no_secret",
			Type: "checkout.session.completed",
		}, nil
	}

	dbMock.ExpectQuery("SELECT EXISTS").WithArgs("evt_no_secret").WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))
	dbMock.ExpectExec("INSERT INTO webhook_events").WithArgs("evt_no_secret", "checkout.session.completed", pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	dbMock.ExpectExec("UPDATE webhook_events").WithArgs("evt_no_secret", pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	StripeWebhookHandler(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"processed":true`)
}

func TestRevenueCatAppUserIDCandidates_DeduplicatesIDs(t *testing.T) {
	payload := RevenueCatPayload{
		revenueCatIdentityFields: revenueCatIdentityFields{AppUserID: " user-1 "},
		Event:                    &revenueCatIdentityFields{AppUserID: "user-1"},
	}

	assert.Equal(t, []string{"user-1"}, revenueCatAppUserIDCandidates(payload))
}

func TestReadPostWebhookPayload_MethodAndSizeBranches(t *testing.T) {
	t.Run("method not allowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/webhook", nil)
		w := httptest.NewRecorder()

		payload, ok := readPostWebhookPayload(w, req)

		assert.False(t, ok)
		assert.Nil(t, payload)
		assert.Equal(t, http.StatusMethodNotAllowed, w.Code)
	})

	t.Run("payload too large", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(strings.Repeat("x", MaxWebhookBodySize+1)))
		w := httptest.NewRecorder()

		payload, ok := readPostWebhookPayload(w, req)

		assert.False(t, ok)
		assert.Nil(t, payload)
		assert.Equal(t, http.StatusRequestEntityTooLarge, w.Code)
	})

	t.Run("read payload reports max bytes error", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(strings.Repeat("x", MaxWebhookBodySize+1)))
		w := httptest.NewRecorder()

		_, err := ReadWebhookPayload(w, req)

		assert.ErrorIs(t, err, ErrPayloadTooLarge)
	})
}

func TestStripeWebhookHandler_InvalidSignatureAndDatabaseBranches(t *testing.T) {
	t.Run("invalid signature", func(t *testing.T) {
		restore(t, &VerifyStripeWebhookSignature)
		VerifyStripeWebhookSignature = func(payload []byte, signature string) (*stripe.Event, error) {
			return nil, assert.AnError
		}
		restore(t, &GetQueries)
		GetQueries = func(context.Context) (*db.Queries, error) {
			t.Fatal("database should not be opened after signature failure")
			return nil, nil
		}

		req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", strings.NewReader("{}"))
		w := httptest.NewRecorder()

		StripeWebhookHandler(w, req)

		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("database unavailable", func(t *testing.T) {
		restore(t, &VerifyStripeWebhookSignature)
		VerifyStripeWebhookSignature = func(payload []byte, signature string) (*stripe.Event, error) {
			return &stripe.Event{ID: "evt_db_unavailable", Type: "checkout.session.completed"}, nil
		}
		restore(t, &GetQueries)
		GetQueries = func(context.Context) (*db.Queries, error) {
			return nil, errors.New("db unavailable")
		}

		req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", strings.NewReader("{}"))
		w := httptest.NewRecorder()

		StripeWebhookHandler(w, req)

		assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	})

	t.Run("invalid event is acknowledged", func(t *testing.T) {
		dbMock := dbtest.NewMockPool(t)
		restore(t, &GetQueries)
		GetQueries = func(context.Context) (*db.Queries, error) {
			return db.New(dbMock), nil
		}
		restore(t, &VerifyStripeWebhookSignature)
		VerifyStripeWebhookSignature = func(payload []byte, signature string) (*stripe.Event, error) {
			return &stripe.Event{
				ID:   "evt_invalid_payload",
				Type: "invoice.payment_succeeded",
				Data: &stripe.EventData{Raw: []byte(`{`)},
			}, nil
		}
		dbMock.ExpectQuery("SELECT EXISTS").WithArgs("evt_invalid_payload").WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))
		dbMock.ExpectExec("INSERT INTO webhook_events").WithArgs("evt_invalid_payload", "invoice.payment_succeeded", pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("INSERT", 1))
		dbMock.ExpectExec("UPDATE webhook_events SET processed_at").WithArgs("evt_invalid_payload", pgxmock.AnyArg()).WillReturnResult(pgxmock.NewResult("UPDATE", 1))

		req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook", strings.NewReader("{}"))
		w := httptest.NewRecorder()

		StripeWebhookHandler(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Contains(t, w.Body.String(), `"processed":false`)
	})
}

func TestRevenueCatWebhookHandler_MissingSecret(t *testing.T) {
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/webhook/revenuecat", strings.NewReader(`{"app_user_id":"user"}`))
	w := httptest.NewRecorder()

	RevenueCatWebhookHandler(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCheckoutHandler_UserLookupErrorRedirectsToLogin(t *testing.T) {
	dbMock := dbtest.NewMockPool(t)
	q := db.New(dbMock)

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)
	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=pro", nil).WithContext(ctx)
	w := httptest.NewRecorder()

	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnError(errors.New("lookup failed"))

	CheckoutHandler(w, req)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.Contains(t, w.Header().Get("Location"), "/login")
}

func TestCheckoutHandler_InvalidPlanAfterAuthentication(t *testing.T) {
	dbMock := dbtest.NewMockPool(t)
	q := db.New(dbMock)

	restore(t, &GetQueries)
	GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)
	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=invalid", nil).WithContext(ctx)
	w := httptest.NewRecorder()

	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(billingAPIUser(dbtest.User{})))

	CheckoutHandler(w, req)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotContains(t, w.Header().Get("Location"), "error=invalid_plan")
}

func TestValidateSubscriptionAndOpenSubscriptionBranches(t *testing.T) {
	require.EqualError(t, validateSubscriptionCancellationChange(&billing.PaymentsAccountUser{}, false), "subscription is not scheduled for cancellation")

	subID := "sub_123"
	assert.True(t, hasOpenSubscription(&billing.PaymentsAccountUser{SubscriptionID: &subID}))
	incomplete := "incomplete"
	assert.False(t, hasOpenSubscription(&billing.PaymentsAccountUser{
		SubscriptionID:     &subID,
		SubscriptionStatus: &incomplete,
	}))
	closed := "canceled"
	assert.False(t, hasOpenSubscription(&billing.PaymentsAccountUser{
		SubscriptionID:     &subID,
		SubscriptionStatus: &closed,
	}))
	revenueCatAppUserID := "rc_123"
	active := "active"
	assert.True(t, hasOpenSubscription(&billing.PaymentsAccountUser{
		Plan:                string(billing.PlanPro),
		RevenueCatAppUserID: &revenueCatAppUserID,
		SubscriptionStatus:  &active,
	}))
}

func TestResolveOrigin_Branches(t *testing.T) {
	t.Setenv("NEXT_PUBLIC_SITE_URL", "https://console.example.com")
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://allowed.example.com")

	assert.Equal(t, "https://console.example.com", resolveOrigin("://bad"))
	assert.Equal(t, "https://allowed.example.com", resolveOrigin("https://allowed.example.com"))
}

func TestSyncSubscription_EarlyReturnBranches(t *testing.T) {
	mockRepo := new(mockPaymentsRepo)
	syncSubscription(context.Background(), mockRepo, nil)
	mockRepo.AssertNotCalled(t, "UpdateSubscription")

	subID := "sub_123"
	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		return nil, assert.AnError
	}

	syncSubscription(context.Background(), mockRepo, &billing.PaymentsAccountUser{ID: 1, SubscriptionID: &subID})
	mockRepo.AssertNotCalled(t, "UpdateSubscription")
}

func TestSyncSubscription_GetSubscriptionError(t *testing.T) {
	mockStripe := new(syncStripeMock)
	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		return mockStripe, nil
	}

	mockRepo := new(mockPaymentsRepo)
	subID := "sub_123"
	mockStripe.On("GetSubscription", mock.Anything, subID, mock.Anything).Return(nil, assert.AnError).Once()

	syncSubscription(context.Background(), mockRepo, &billing.PaymentsAccountUser{ID: 1, SubscriptionID: &subID})

	mockRepo.AssertNotCalled(t, "UpdateSubscription")
	mockStripe.AssertExpectations(t)
}

func TestSubscriptionResponse_Branches(t *testing.T) {
	assert.Nil(t, subscriptionResponse(nil))

	subID := "sub_123"
	start := time.Unix(1700000000, 0)
	end := start.Add(time.Hour)

	resp := subscriptionResponse(&billing.PaymentsAccountUser{
		SubscriptionID:     &subID,
		CurrentPeriodStart: &start,
		CurrentPeriodEnd:   &end,
	}).(map[string]any)

	assert.Equal(t, start.Unix(), resp["current_period_start"])
	assert.Equal(t, end.Unix(), resp["current_period_end"])
	assert.Equal(t, "unknown", resp["status"])

	revenueCatAppUserID := "rc_123"
	active := "active"
	mobileResp := subscriptionResponse(&billing.PaymentsAccountUser{
		Plan:                string(billing.PlanPro),
		RevenueCatAppUserID: &revenueCatAppUserID,
		SubscriptionStatus:  &active,
	}).(map[string]any)
	assert.Equal(t, active, mobileResp["status"])
	assert.NotContains(t, mobileResp, "subscription_id")
}

func TestUpdateSubscriptionCancellationState_StripeBranches(t *testing.T) {
	ctx := context.Background()
	subID := "sub_123"

	t.Run("stripe client unavailable", func(t *testing.T) {
		restore(t, &NewStripeClient)
		NewStripeClient = func() (StripeCustomerClient, error) {
			return nil, assert.AnError
		}

		err := updateSubscriptionCancellationState(ctx, new(mockPaymentsRepo), &billing.PaymentsAccountUser{ID: 1, SubscriptionID: &subID}, true, "CancelSub")

		assert.ErrorIs(t, err, errStripeNotConfigured)
	})

	t.Run("stripe update error", func(t *testing.T) {
		mockStripe := new(syncStripeMock)
		restore(t, &NewStripeClient)
		NewStripeClient = func() (StripeCustomerClient, error) {
			return mockStripe, nil
		}
		mockStripe.On("UpdateSubscription", mock.Anything, subID, mock.Anything).Return(nil, assert.AnError).Once()

		err := updateSubscriptionCancellationState(ctx, new(mockPaymentsRepo), &billing.PaymentsAccountUser{ID: 1, SubscriptionID: &subID}, true, "CancelSub")

		require.Error(t, err)
		mockStripe.AssertExpectations(t)
	})
}

func TestRevenueCatNumericAppUserID_Empty(t *testing.T) {
	id, ok := revenueCatNumericAppUserID("")
	assert.False(t, ok)
	assert.Equal(t, 0, id)
}

func TestSyncRevenueCatWebhookCandidate_UserIDFallbackBranches(t *testing.T) {
	ctx := context.Background()

	// The numeric user-id sync reports the user missing: treat as not-ready
	// without surfacing an error.
	notFound := fakeMobileSubscriptionService{
		appSyncErr: billing.ErrUserNotFound,
		err:        billing.ErrMobileSyncUserNotFound,
	}
	ready, err := syncRevenueCatWebhookCandidate(ctx, notFound, "42")
	require.NoError(t, err)
	assert.False(t, ready)

	// The numeric user-id sync fails with an unexpected error: surface it.
	failed := fakeMobileSubscriptionService{
		appSyncErr: billing.ErrUserNotFound,
		err:        errors.New("user-id sync failed"),
	}
	ready, err = syncRevenueCatWebhookCandidate(ctx, failed, "42")
	require.Error(t, err)
	assert.False(t, ready)
}

func TestLoadBillingUserByEmailFromAuthContext_FindError(t *testing.T) {
	mockRepo := new(mockPaymentsRepo)
	email := "error@example.com"
	user := &auth.AuthenticatedUser{Email: email}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(context.Background(), adapterhandler.UserContextKey, user))
	mockRepo.On("FindUserByEmail", mock.Anything, email).Return(nil, assert.AnError).Once()

	_, foundEmail, err := loadBillingUserByEmailFromAuthContext(req, mockRepo)

	assert.Equal(t, email, foundEmail)
	require.Error(t, err)
	mockRepo.AssertExpectations(t)
}
