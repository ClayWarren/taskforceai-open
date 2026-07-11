package billing

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

func TestWebhookService_HandleSubscriptionUpdate_UserNotFoundByCustomer(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
	ctx := context.Background()

	customerID := "cus_missing"
	subData := stripe.Subscription{
		ID:       "sub_123",
		Status:   stripe.SubscriptionStatusActive,
		Customer: &stripe.Customer{ID: customerID},
		Items:    &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}
	rawData, _ := json.Marshal(subData)

	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(nil, ErrBillingUserNotFound).Once()

	err := svc.handleSubscriptionUpdate(ctx, rawData, nil)
	assert.Empty(t, err)
}

func TestWebhookUserUpdate_Struct(t *testing.T) {
	subID := "sub_123"
	status := "active"
	plan := "pro"
	priceID := "price_pro"
	brand := "visa"
	last4 := "4242"

	update := WebhookUserUpdate{
		SubscriptionID:     &subID,
		SubscriptionStatus: &status,
		Plan:               &plan,
		PriceID:            &priceID,
		PaymentMethodBrand: &brand,
		PaymentMethodLast4: &last4,
		CancelAtPeriodEnd:  new(false),
	}

	assert.Equal(t, "sub_123", *update.SubscriptionID)
	assert.Equal(t, "active", *update.SubscriptionStatus)
	assert.Equal(t, "pro", *update.Plan)
	assert.Equal(t, "price_pro", *update.PriceID)
	assert.Equal(t, "visa", *update.PaymentMethodBrand)
	assert.Equal(t, "4242", *update.PaymentMethodLast4)
	assert.False(t, *update.CancelAtPeriodEnd)
}

func TestWebhookUser_Struct(t *testing.T) {
	plan := "pro"
	fullName := "John Doe"
	customerID := "cus_123"

	user := WebhookUser{
		ID:         42,
		Email:      "user@example.com",
		Plan:       &plan,
		FullName:   &fullName,
		CustomerID: &customerID,
	}

	assert.Equal(t, 42, user.ID)
	assert.Equal(t, "user@example.com", user.Email)
	assert.Equal(t, "pro", *user.Plan)
	assert.Equal(t, "John Doe", *user.FullName)
	assert.Equal(t, "cus_123", *user.CustomerID)
}

type poisonRepo struct {
	processed map[string]bool
	user      *WebhookUser
	updates   int
}

func newPoisonRepo() *poisonRepo {
	plan := string(PlanFree)
	return &poisonRepo{
		processed: map[string]bool{},
		user: &WebhookUser{
			ID:    42,
			Email: "user@example.com",
			Plan:  &plan,
		},
	}
}

func (r *poisonRepo) HasProcessedEvent(_ context.Context, stripeEventID string) (bool, error) {
	return r.processed[stripeEventID], nil
}

func (r *poisonRepo) RecordEvent(_ context.Context, stripeEventID, _ string) (WebhookClaim, error) {
	if r.processed[stripeEventID] {
		return "", nil
	}
	r.processed[stripeEventID] = true
	return "poison-claim", nil
}

func (r *poisonRepo) CompleteEvent(_ context.Context, stripeEventID string, _ WebhookClaim) error {
	r.processed[stripeEventID] = true
	return nil
}

func (r *poisonRepo) DeleteEvent(_ context.Context, stripeEventID string, _ WebhookClaim) error {
	delete(r.processed, stripeEventID)
	return nil
}

func (r *poisonRepo) FindUserByID(context.Context, int) (*WebhookUser, error) {
	return r.user, nil
}

func (r *poisonRepo) FindUserByCustomerID(context.Context, string) (*WebhookUser, error) {
	return nil, nil
}

func (r *poisonRepo) UpdateUser(context.Context, int, WebhookUserUpdate) error {
	r.updates++
	return nil
}

func TestWebhookService_HandleEvent_UnknownPriceDoesNotLeavePaidPlan(t *testing.T) {
	repo := newPoisonRepo()
	ctx := context.Background()

	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:       "sub_123",
		Status:   stripe.SubscriptionStatusActive,
		Customer: &stripe.Customer{ID: customerID},
		Items: &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{{
			Price: &stripe.Price{ID: "price_new_unmapped"},
		}}},
		Metadata: map[string]string{"userId": "42"},
	}
	rawData, _ := json.Marshal(subData)
	event := &stripe.Event{
		ID:   "evt_poison",
		Type: "customer.subscription.updated",
		Data: &stripe.EventData{Raw: rawData},
	}

	firstSvc := NewWebhookService(WebhookDependencies{
		Repo: repo,
		GetPlanByPriceID: func(priceID *string) *BillingPlanDefinition {
			return nil
		},
	})

	firstResult, firstErr := firstSvc.HandleEvent(ctx, event)
	require.Empty(t, firstErr)
	require.NotNil(t, firstResult)
	assert.True(t, firstResult.Processed)
	require.True(t, repo.processed[event.ID], "processed unknown-price events should not be replayed after downgrading")
	assert.Equal(t, 1, repo.updates)
}

func TestWebhookService_HandleEvent_SubscriptionUpdateFailureReleasesClaim(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
	ctx := context.Background()
	event := &stripe.Event{
		ID:   "evt_bad_subscription_update",
		Type: "customer.subscription.updated",
		Data: &stripe.EventData{Raw: json.RawMessage(`{`)},
	}

	expectFreshWebhookEvent(mockRepo, ctx, event.ID, string(event.Type))
	mockRepo.On("DeleteEvent", ctx, event.ID).Return(nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Equal(t, ErrInvalidEvent, err)
	assert.Nil(t, result)
	mockRepo.AssertExpectations(t)
}

func TestSubscriptionIDField_UnmarshalJSONInvalidObject(t *testing.T) {
	var field subscriptionIDField

	err := field.UnmarshalJSON([]byte(`{"id":`))

	assert.Error(t, err)
}

func TestWebhookService_FindUserForSubscription_ErrorBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("nil subscription", func(t *testing.T) {
		svc := NewWebhookService(WebhookDependencies{Repo: new(MockWebhookRepository)})

		user, werr := svc.findUserForSubscription(ctx, nil)

		assert.Equal(t, ErrInvalidEvent, werr)
		assert.Nil(t, user)
	})

	t.Run("user id lookup error", func(t *testing.T) {
		mockRepo := new(MockWebhookRepository)
		svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
		userID := 42
		mockRepo.On("FindUserByID", ctx, userID).Return(nil, assert.AnError).Once()

		user, werr := svc.findUserForSubscription(ctx, &parsedSubscription{UserID: &userID})

		assert.Equal(t, ErrDBError, werr)
		assert.Nil(t, user)
		mockRepo.AssertExpectations(t)
	})

	t.Run("customer lookup error", func(t *testing.T) {
		mockRepo := new(MockWebhookRepository)
		svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
		customerID := "cus_lookup_error"
		mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(nil, assert.AnError).Once()

		user, werr := svc.findUserForSubscription(ctx, &parsedSubscription{CustomerID: &customerID})

		assert.Equal(t, ErrDBError, werr)
		assert.Nil(t, user)
		mockRepo.AssertExpectations(t)
	})
}

func TestSubscriptionPlanForUpdate_NilSubscription(t *testing.T) {
	svc := NewWebhookService(WebhookDependencies{Repo: new(MockWebhookRepository)})
	assert.Equal(t, string(PlanFree), svc.subscriptionPlanForUpdate(nil, nil))
}

func TestUserIDForLog(t *testing.T) {
	assert.Equal(t, 0, userIDForLog(nil))
	assert.Equal(t, 7, userIDForLog(&WebhookUser{ID: 7}))
}

func TestWebhookService_HandleSubscriptionUpdate_ErrorBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("invalid json", func(t *testing.T) {
		svc := NewWebhookService(WebhookDependencies{Repo: new(MockWebhookRepository)})

		err := svc.handleSubscriptionUpdate(ctx, json.RawMessage(`{`), nil)

		assert.Equal(t, ErrInvalidEvent, err)
	})

	t.Run("find user error", func(t *testing.T) {
		mockRepo := new(MockWebhookRepository)
		svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
		userID := 42
		event := stripeSubscriptionEvent("evt_find_error", "customer.subscription.updated", "sub_find_error", map[string]string{"userId": "42"})
		mockRepo.On("FindUserByID", ctx, userID).Return(nil, assert.AnError).Once()

		err := svc.handleSubscriptionUpdate(ctx, event.Data.Raw, nil)

		assert.Equal(t, ErrDBError, err)
		mockRepo.AssertExpectations(t)
	})

	t.Run("update user error", func(t *testing.T) {
		mockRepo := new(MockWebhookRepository)
		svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
		customerID := "cus_update_error"
		subData := stripe.Subscription{
			ID:       "sub_update_error",
			Status:   stripe.SubscriptionStatusActive,
			Customer: &stripe.Customer{ID: customerID},
			Items:    &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
		}
		rawData, jsonErr := json.Marshal(subData)
		require.NoError(t, jsonErr)
		mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{ID: 42, Email: "user@example.com"}, nil).Once()
		mockRepo.On("UpdateUser", ctx, 42, mock.Anything).Return(assert.AnError).Once()

		err := svc.handleSubscriptionUpdate(ctx, rawData, nil)

		assert.Equal(t, ErrDBError, err)
		mockRepo.AssertExpectations(t)
	})
}

func TestWebhookStatusHelpers_DefaultBranches(t *testing.T) {
	assert.False(t, isActiveSubscriptionStatus("paused"))
	assert.True(t, isOpenSubscriptionStatus("past_due"))
	assert.False(t, isOpenSubscriptionStatus("canceled"))

	currentSubID := "sub_current"
	assert.False(t, blocksSubscriptionReplacement(&WebhookUser{SubscriptionID: &currentSubID}, currentSubID))

	canceled := "canceled"
	assert.False(t, blocksSubscriptionReplacement(&WebhookUser{
		SubscriptionID:     &currentSubID,
		SubscriptionStatus: &canceled,
	}, "sub_new"))
}

func TestWebhookService_HandleSubscriptionDeleted_ErrorBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("invalid json", func(t *testing.T) {
		svc := NewWebhookService(WebhookDependencies{Repo: new(MockWebhookRepository)})

		err := svc.handleSubscriptionDeleted(ctx, json.RawMessage(`{`), nil)

		assert.Equal(t, ErrInvalidEvent, err)
	})

	t.Run("find user error", func(t *testing.T) {
		mockRepo := new(MockWebhookRepository)
		svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
		customerID := "cus_delete_error"
		subData := stripe.Subscription{
			ID:       "sub_delete_error",
			Status:   stripe.SubscriptionStatusCanceled,
			Customer: &stripe.Customer{ID: customerID},
			Items:    &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
		}
		rawData, jsonErr := json.Marshal(subData)
		require.NoError(t, jsonErr)
		mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(nil, assert.AnError).Once()

		err := svc.handleSubscriptionDeleted(ctx, rawData, nil)

		assert.Equal(t, ErrDBError, err)
		mockRepo.AssertExpectations(t)
	})

	t.Run("stale event", func(t *testing.T) {
		mockRepo := new(MockWebhookRepository)
		svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
		customerID := "cus_stale_delete"
		subID := "sub_stale_delete"
		lastEventAt := time.Unix(200, 0).UTC()
		eventAt := time.Unix(100, 0).UTC()
		subData := stripe.Subscription{
			ID:       subID,
			Status:   stripe.SubscriptionStatusCanceled,
			Customer: &stripe.Customer{ID: customerID},
			Items:    &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
		}
		rawData, jsonErr := json.Marshal(subData)
		require.NoError(t, jsonErr)
		mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
			ID:                               42,
			Email:                            "user@example.com",
			SubscriptionID:                   &subID,
			StripeSubscriptionEventCreatedAt: &lastEventAt,
		}, nil).Once()

		err := svc.handleSubscriptionDeleted(ctx, rawData, &eventAt)

		assert.Empty(t, err)
		mockRepo.AssertNotCalled(t, "UpdateUser", mock.Anything, mock.Anything, mock.Anything)
		mockRepo.AssertExpectations(t)
	})
}

func TestWebhookService_HandlePaymentSucceeded_ErrorBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("invalid json", func(t *testing.T) {
		svc := NewWebhookService(WebhookDependencies{Repo: new(MockWebhookRepository)})

		err := svc.handlePaymentSucceeded(ctx, json.RawMessage(`{`))

		assert.Equal(t, ErrInvalidEvent, err)
	})

	t.Run("find user error", func(t *testing.T) {
		mockRepo := new(MockWebhookRepository)
		svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
		customerID := "cus_payment_lookup_error"
		rawData := stripeInvoicePaymentSucceededRaw("inv_lookup_error", customerID, "", 0, "")
		mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(nil, assert.AnError).Once()

		err := svc.handlePaymentSucceeded(ctx, rawData)

		assert.Equal(t, ErrDBError, err)
		mockRepo.AssertExpectations(t)
	})
}

func TestWebhookService_HandlePaymentFailed_EdgeBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("invalid json", func(t *testing.T) {
		svc := NewWebhookService(WebhookDependencies{Repo: new(MockWebhookRepository)})

		err := svc.handlePaymentFailed(ctx, json.RawMessage(`{`))

		assert.Equal(t, ErrInvalidEvent, err)
	})

	t.Run("no customer", func(t *testing.T) {
		svc := NewWebhookService(WebhookDependencies{Repo: new(MockWebhookRepository)})
		rawData, jsonErr := json.Marshal(stripe.Invoice{ID: "inv_no_customer"})
		require.NoError(t, jsonErr)

		err := svc.handlePaymentFailed(ctx, rawData)

		assert.Empty(t, err)
	})

	t.Run("no email service", func(t *testing.T) {
		svc := NewWebhookService(WebhookDependencies{Repo: new(MockWebhookRepository)})

		assert.NotPanics(t, func() {
			svc.sendSubscriptionFailureEmail(ctx, &WebhookUser{ID: 42, Email: "user@example.com"})
		})
	})
}
