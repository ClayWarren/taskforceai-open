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

func TestWebhookService_HandleEvent_RecordEventRace_NoSideEffects(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo, GetPlanByPriceID: proPlanByPriceID})
	ctx := context.Background()

	event := stripeSubscriptionEvent("evt_123", "customer.subscription.updated", "sub_123", map[string]string{"userId": "42"})
	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "customer.subscription.updated").Return(false, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Equal(t, ErrDBError, err)
	assert.Nil(t, result)
	mockRepo.AssertNotCalled(t, "FindUserByID", mock.Anything, mock.Anything)
	mockRepo.AssertNotCalled(t, "FindUserByCustomerID", mock.Anything, mock.Anything)
	mockRepo.AssertNotCalled(t, "UpdateUser", mock.Anything, mock.Anything, mock.Anything)
}

func TestWebhookService_HandleEvent_RetryableFailureDeleteError(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{
		Repo: mockRepo,
	})
	ctx := context.Background()

	customerID := "cus_123"
	event := stripeInvoicePaymentEvent("evt_delete_err", "inv_delete_err", customerID, "price_pro", 0)
	expectFreshWebhookEvent(mockRepo, ctx, "evt_delete_err", "invoice.payment_succeeded")
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{ID: 1, Email: "user@example.com"}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 1, mock.Anything).Return(assert.AnError).Once()
	mockRepo.On("DeleteEvent", ctx, "evt_delete_err").Return(assert.AnError).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Equal(t, ErrDBError, err)
	assert.Nil(t, result)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_RetryableFailureReleasesClaim(t *testing.T) {
	plan := string(PlanPro)
	mockRepo := newRetryableFailureRepo(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
		Plan:  &plan,
	})
	svc := NewWebhookService(WebhookDependencies{
		Repo: mockRepo,
	})
	ctx := context.Background()

	customerID := "cus_123"
	event := stripeInvoicePaymentEvent("evt_retry", "inv_123", customerID, "price_pro", 2999)

	firstResult, firstErr := svc.HandleEvent(ctx, event)
	assert.Equal(t, ErrDBError, firstErr)
	assert.Nil(t, firstResult)

	secondResult, secondErr := svc.HandleEvent(ctx, event)
	assert.Empty(t, secondErr)
	assert.NotNil(t, secondResult)
	assert.True(t, secondResult.Processed)
	assert.Equal(t, 2, mockRepo.updateCalls)
	assert.Equal(t, 1, mockRepo.deleteCalls)
}

func TestWebhookService_HandleEvent_SubscriptionCreated(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{
		Repo:             mockRepo,
		GetPlanByPriceID: func(priceID *string) *BillingPlanDefinition { return nil },
	})
	ctx := context.Background()

	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:     "sub_123",
		Status: stripe.SubscriptionStatusActive,
		Customer: &stripe.Customer{
			ID: customerID,
		},
		Items: &stripe.SubscriptionItemList{
			Data: []*stripe.SubscriptionItem{
				{
					CurrentPeriodStart: 1700000000,
					CurrentPeriodEnd:   1703000000,
					Price:              &stripe.Price{ID: "price_pro"},
				},
			},
		},
		Metadata: map[string]string{"userId": "42"},
	}
	rawData, _ := json.Marshal(subData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "customer.subscription.created",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByID", ctx, 42).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return update.Plan != nil && *update.Plan == string(PlanFree) &&
			update.PriceID != nil && *update.PriceID == "price_pro"
	})).Return(nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "customer.subscription.created").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionCreated_WithPlan(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{
		Repo: mockRepo,
		GetPlanByPriceID: func(priceID *string) *BillingPlanDefinition {
			if priceID != nil && *priceID == "price_pro" {
				return &BillingPlanDefinition{Plan: PlanPro}
			}
			return nil
		},
	})
	ctx := context.Background()

	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:       "sub_123",
		Status:   stripe.SubscriptionStatusActive,
		Customer: &stripe.Customer{ID: customerID},
		Items: &stripe.SubscriptionItemList{
			Data: []*stripe.SubscriptionItem{
				{
					CurrentPeriodStart: 1700000000,
					CurrentPeriodEnd:   1703000000,
					Price:              &stripe.Price{ID: "price_pro"},
				},
			},
		},
		Metadata: map[string]string{"userId": "42"},
	}
	rawData, _ := json.Marshal(subData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "customer.subscription.created",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByID", ctx, 42).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return *update.Plan == string(PlanPro)
	})).Return(nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "customer.subscription.created").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionCreated_IncompleteKeepsFreePlan(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo, GetPlanByPriceID: proPlanByPriceID})
	ctx := context.Background()

	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:       "sub_123",
		Status:   stripe.SubscriptionStatus("incomplete"),
		Customer: &stripe.Customer{ID: customerID},
		Items: &stripe.SubscriptionItemList{
			Data: []*stripe.SubscriptionItem{{Price: &stripe.Price{ID: "price_pro"}}},
		},
		Metadata: map[string]string{"userId": "42"},
	}
	rawData, _ := json.Marshal(subData)

	event := &stripe.Event{
		ID:   "evt_incomplete",
		Type: "customer.subscription.created",
		Data: &stripe.EventData{Raw: rawData},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_incomplete").Return(false, nil).Once()
	mockRepo.On("FindUserByID", ctx, 42).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return update.Plan != nil &&
			*update.Plan == string(PlanFree) &&
			update.SubscriptionStatus != nil &&
			*update.SubscriptionStatus == "incomplete"
	})).Return(nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_incomplete", "customer.subscription.created").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionDeleted(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{
		Repo: mockRepo,
	})
	ctx := context.Background()

	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:       "sub_123",
		Status:   stripe.SubscriptionStatusCanceled,
		Customer: &stripe.Customer{ID: customerID},
		Items:    &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}
	rawData, _ := json.Marshal(subData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "customer.subscription.deleted",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:             42,
		Email:          "user@example.com",
		SubscriptionID: stripe.String("sub_123"),
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return update.ClearSubscription &&
			update.SubscriptionID == nil &&
			*update.Plan == string(PlanFree)
	})).Return(nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "customer.subscription.deleted").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionDeletedFailureReleasesClaim(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
	ctx := context.Background()

	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:       "sub_123",
		Customer: &stripe.Customer{ID: customerID},
		Items:    &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}
	rawData, _ := json.Marshal(subData)

	event := &stripe.Event{
		ID:   "evt_delete_fail",
		Type: "customer.subscription.deleted",
		Data: &stripe.EventData{Raw: rawData},
	}

	plan := string(PlanPro)
	mockRepo.On("HasProcessedEvent", ctx, "evt_delete_fail").Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_delete_fail", "customer.subscription.deleted").Return(true, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
		Plan:  &plan,
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.Anything).Return(assert.AnError).Once()
	mockRepo.On("DeleteEvent", ctx, "evt_delete_fail").Return(nil).Once()

	result, err := svc.HandleEvent(ctx, event)
	assert.Equal(t, ErrDBError, err)
	assert.Nil(t, result)
}

func TestWebhookService_HandleEvent_SubscriptionDeleted_IgnoresNonCurrentSubscription(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{
		Repo: mockRepo,
	})
	ctx := context.Background()

	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:       "sub_old",
		Status:   stripe.SubscriptionStatusCanceled,
		Customer: &stripe.Customer{ID: customerID},
		Items:    &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}
	rawData, _ := json.Marshal(subData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "customer.subscription.deleted",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	currentSubID := "sub_current"
	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:             42,
		Email:          "user@example.com",
		SubscriptionID: &currentSubID,
	}, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "customer.subscription.deleted").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
	mockRepo.AssertNotCalled(t, "UpdateUser")
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionDeleted_UserNotFound(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{
		Repo: mockRepo,
	})
	ctx := context.Background()

	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:       "sub_123",
		Status:   stripe.SubscriptionStatusCanceled,
		Customer: &stripe.Customer{ID: customerID},
		Items:    &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}
	rawData, _ := json.Marshal(subData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "customer.subscription.deleted",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(nil, ErrBillingUserNotFound).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "customer.subscription.deleted").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
	mockRepo.AssertNotCalled(t, "UpdateUser")
}

func TestWebhookService_HandleEvent_SubscriptionUpdateInvalidPriceDowngradesPlan(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{
		Repo: mockRepo,
		GetPlanByPriceID: func(*string) *BillingPlanDefinition {
			return nil
		},
	})
	ctx := context.Background()

	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:       "sub_invalid_price",
		Status:   stripe.SubscriptionStatusActive,
		Customer: &stripe.Customer{ID: customerID},
		Items: &stripe.SubscriptionItemList{
			Data: []*stripe.SubscriptionItem{{Price: &stripe.Price{ID: "price_unknown"}}},
		},
	}
	rawData, _ := json.Marshal(subData)

	event := &stripe.Event{
		ID:   "evt_invalid_price",
		Type: "customer.subscription.updated",
		Data: &stripe.EventData{Raw: rawData},
	}

	plan := string(PlanPro)
	mockRepo.On("HasProcessedEvent", ctx, "evt_invalid_price").Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_invalid_price", "customer.subscription.updated").Return(true, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
		Plan:  &plan,
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return update.Plan != nil &&
			*update.Plan == string(PlanFree) &&
			update.PriceID != nil &&
			*update.PriceID == "price_unknown" &&
			update.SubscriptionID != nil &&
			*update.SubscriptionID == "sub_invalid_price"
	})).Return(nil).Once()

	result, err := svc.HandleEvent(ctx, event)
	assert.Empty(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Processed)
}

func TestWebhookService_HandleEvent_SubscriptionUpdated(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo, GetPlanByPriceID: func(*string) *BillingPlanDefinition { return nil }})
	ctx := context.Background()

	event := stripeSubscriptionEvent("evt_123", "customer.subscription.updated", "sub_123", nil)
	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, "cus_123").Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return update.Plan != nil &&
			*update.Plan == string(PlanFree) &&
			update.PriceID != nil &&
			*update.PriceID == "price_pro" &&
			update.SubscriptionID != nil &&
			*update.SubscriptionID == "sub_123"
	})).Return(nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "customer.subscription.updated").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionUpdated_Success(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo, GetPlanByPriceID: proPlanByPriceID})
	ctx := context.Background()

	event := stripeSubscriptionEvent("evt_updated_success", "customer.subscription.updated", "sub_123", map[string]string{"userId": "42"})
	event.Created = 1700000100
	mockRepo.On("HasProcessedEvent", ctx, "evt_updated_success").Return(false, nil).Once()
	mockRepo.On("FindUserByID", ctx, 42).Return(&WebhookUser{ID: 42, Email: "user@example.com"}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return update.StripeSubscriptionEventCreatedAt != nil &&
			update.StripeSubscriptionEventCreatedAt.Equal(time.Unix(1700000100, 0).UTC())
	})).Return(nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_updated_success", "customer.subscription.updated").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionUpdated_IgnoresNonCurrentSubscription(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo, GetPlanByPriceID: proPlanByPriceID})
	ctx := context.Background()

	event := stripeSubscriptionEvent("evt_old_sub_update", "customer.subscription.updated", "sub_old", map[string]string{"userId": "42"})
	event.Created = 1700000300
	currentSubID := "sub_current"
	mockRepo.On("HasProcessedEvent", ctx, "evt_old_sub_update").Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_old_sub_update", "customer.subscription.updated").Return(true, nil).Once()
	mockRepo.On("FindUserByID", ctx, 42).Return(&WebhookUser{
		ID:             42,
		Email:          "user@example.com",
		SubscriptionID: &currentSubID,
	}, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Processed)
	mockRepo.AssertNotCalled(t, "UpdateUser", mock.Anything, mock.Anything, mock.Anything)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionUpdated_ReplacesStaleCanceledSubscription(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo, GetPlanByPriceID: proPlanByPriceID})
	ctx := context.Background()

	event := stripeSubscriptionEvent("evt_new_sub_update", "customer.subscription.updated", "sub_new", map[string]string{"userId": "42"})
	event.Created = 1700000300
	staleSubID := "sub_old"
	canceledStatus := "canceled"
	mockRepo.On("HasProcessedEvent", ctx, "evt_new_sub_update").Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_new_sub_update", "customer.subscription.updated").Return(true, nil).Once()
	mockRepo.On("FindUserByID", ctx, 42).Return(&WebhookUser{
		ID:                 42,
		Email:              "user@example.com",
		SubscriptionID:     &staleSubID,
		SubscriptionStatus: &canceledStatus,
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return update.Plan != nil &&
			*update.Plan == string(PlanPro) &&
			update.PriceID != nil &&
			*update.PriceID == "price_pro" &&
			update.SubscriptionID != nil &&
			*update.SubscriptionID == "sub_new" &&
			update.SubscriptionStatus != nil &&
			*update.SubscriptionStatus == string(stripe.SubscriptionStatusActive)
	})).Return(nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionUpdated_SkipsOlderEvent(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo, GetPlanByPriceID: proPlanByPriceID})
	ctx := context.Background()

	lastEventAt := time.Unix(1700000200, 0).UTC()
	event := stripeSubscriptionEvent("evt_older_update", "customer.subscription.updated", "sub_123", map[string]string{"userId": "42"})
	event.Created = 1700000100
	mockRepo.On("HasProcessedEvent", ctx, "evt_older_update").Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_older_update", "customer.subscription.updated").Return(true, nil).Once()
	mockRepo.On("FindUserByID", ctx, 42).Return(&WebhookUser{
		ID:                               42,
		Email:                            "user@example.com",
		StripeSubscriptionEventCreatedAt: &lastEventAt,
	}, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Processed)
	mockRepo.AssertNotCalled(t, "UpdateUser", mock.Anything, mock.Anything, mock.Anything)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionDeleteWatermarkBlocksEqualTimestampUpdate(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo, GetPlanByPriceID: proPlanByPriceID})
	ctx := context.Background()

	currentSubID := "sub_123"
	plan := string(PlanPro)
	deleteEventAt := time.Unix(1700000200, 0).UTC()
	deleteEvent := stripeSubscriptionEvent("evt_delete_newer", "customer.subscription.deleted", currentSubID, nil)
	deleteEvent.Created = deleteEventAt.Unix()
	expectFreshWebhookEvent(mockRepo, ctx, "evt_delete_newer", "customer.subscription.deleted")
	mockRepo.On("FindUserByCustomerID", ctx, "cus_123").Return(&WebhookUser{
		ID:             42,
		Email:          "user@example.com",
		Plan:           &plan,
		SubscriptionID: &currentSubID,
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return update.ClearSubscription &&
			update.StripeSubscriptionEventCreatedAt != nil &&
			update.StripeSubscriptionEventCreatedAt.Equal(deleteEventAt)
	})).Return(nil).Once()

	deleteResult, deleteErr := svc.HandleEvent(ctx, deleteEvent)
	assert.Empty(t, deleteErr)
	require.NotNil(t, deleteResult)
	assert.True(t, deleteResult.Processed)

	updateEvent := stripeSubscriptionEvent("evt_update_equal", "customer.subscription.updated", currentSubID, map[string]string{"userId": "42"})
	updateEvent.Created = deleteEventAt.Unix()
	expectFreshWebhookEvent(mockRepo, ctx, "evt_update_equal", "customer.subscription.updated")
	mockRepo.On("FindUserByID", ctx, 42).Return(&WebhookUser{
		ID:                               42,
		Email:                            "user@example.com",
		StripeSubscriptionEventCreatedAt: &deleteEventAt,
	}, nil).Once()

	updateResult, updateErr := svc.HandleEvent(ctx, updateEvent)
	assert.Empty(t, updateErr)
	require.NotNil(t, updateResult)
	assert.True(t, updateResult.Processed)
	mockRepo.AssertNumberOfCalls(t, "UpdateUser", 1)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_SubscriptionDeleteWinsEqualTimestampUpdate(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo, GetPlanByPriceID: proPlanByPriceID})
	ctx := context.Background()

	currentSubID := "sub_123"
	plan := string(PlanPro)
	eventAt := time.Unix(1700000200, 0).UTC()
	updateEvent := stripeSubscriptionEvent("evt_update_equal", "customer.subscription.updated", currentSubID, map[string]string{"userId": "42"})
	updateEvent.Created = eventAt.Unix()
	expectFreshWebhookEvent(mockRepo, ctx, "evt_update_equal", "customer.subscription.updated")
	mockRepo.On("FindUserByID", ctx, 42).Return(&WebhookUser{ID: 42, Email: "user@example.com"}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return !update.ClearSubscription &&
			update.Plan != nil &&
			*update.Plan == string(PlanPro) &&
			update.StripeSubscriptionEventCreatedAt != nil &&
			update.StripeSubscriptionEventCreatedAt.Equal(eventAt)
	})).Return(nil).Once()

	updateResult, updateErr := svc.HandleEvent(ctx, updateEvent)
	assert.Empty(t, updateErr)
	require.NotNil(t, updateResult)
	assert.True(t, updateResult.Processed)

	deleteEvent := stripeSubscriptionEvent("evt_delete_equal", "customer.subscription.deleted", currentSubID, nil)
	deleteEvent.Created = eventAt.Unix()
	expectFreshWebhookEvent(mockRepo, ctx, "evt_delete_equal", "customer.subscription.deleted")
	mockRepo.On("FindUserByCustomerID", ctx, "cus_123").Return(&WebhookUser{
		ID:                               42,
		Email:                            "user@example.com",
		Plan:                             &plan,
		SubscriptionID:                   &currentSubID,
		StripeSubscriptionEventCreatedAt: &eventAt,
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return update.ClearSubscription &&
			update.Plan != nil &&
			*update.Plan == string(PlanFree) &&
			update.StripeSubscriptionEventCreatedAt != nil &&
			update.StripeSubscriptionEventCreatedAt.Equal(eventAt)
	})).Return(nil).Once()

	result, err := svc.HandleEvent(ctx, deleteEvent)

	assert.Empty(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Processed)
	mockRepo.AssertNumberOfCalls(t, "UpdateUser", 2)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_UnhandledType(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{
		Repo: mockRepo,
	})
	ctx := context.Background()

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "unknown.event.type",
	}

	expectFreshWebhookEvent(mockRepo, ctx, "evt_123", "unknown.event.type")

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
}

func TestWebhookService_HandlePaymentFailed_EmailFailure(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	mockEmail := new(MockEmailService)
	svc := NewWebhookService(WebhookDependencies{
		Repo:         mockRepo,
		EmailService: mockEmail,
	})
	ctx := context.Background()

	customerID := "cus_123"
	plan := string(PlanPro)
	rawData := stripeInvoiceFailedRaw("inv_failed", customerID)

	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
		Plan:  &plan,
	}, nil).Once()
	mockEmail.On("SendSubscriptionFailureEmail", ctx, "user@example.com", "user@example.com", plan, "Payment declined").Return(assert.AnError).Once()

	err := svc.handlePaymentFailed(ctx, rawData)
	assert.Empty(t, err)
	mockEmail.AssertExpectations(t)
}

func TestWebhookService_HandlePaymentFailed_FindUserError(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
	ctx := context.Background()

	customerID := "cus_123"
	rawData := stripeInvoiceFailedRaw("inv_failed", customerID)

	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(nil, assert.AnError).Once()

	err := svc.handlePaymentFailed(ctx, rawData)
	assert.Equal(t, ErrDBError, err)
}

func TestWebhookService_HandlePaymentFailed_SendsEmail(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	mockEmail := new(MockEmailService)
	svc := NewWebhookService(WebhookDependencies{
		Repo:         mockRepo,
		EmailService: mockEmail,
	})
	ctx := context.Background()

	customerID := "cus_123"
	rawData := stripeInvoiceFailedRaw("inv_failed", customerID)

	plan := string(PlanPro)
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
		Plan:  &plan,
	}, nil).Once()
	mockEmail.On("SendSubscriptionFailureEmail", ctx, "user@example.com", "user@example.com", plan, "Payment declined").Return(nil).Once()

	err := svc.handlePaymentFailed(ctx, rawData)
	assert.Empty(t, err)
	mockEmail.AssertExpectations(t)
}

func TestWebhookService_HandlePaymentSucceeded_EmailFailure(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	mockEmail := new(MockEmailService)
	svc := NewWebhookService(WebhookDependencies{
		Repo:         mockRepo,
		EmailService: mockEmail,
	})
	ctx := context.Background()

	customerID := "cus_123"
	plan := string(PlanPro)
	rawData := stripeInvoicePaymentSucceededRaw("inv_123", customerID, "", 2999, stripe.CurrencyUSD)

	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
		Plan:  &plan,
	}, nil).Once()
	mockEmail.On("SendPaymentConfirmationEmail", ctx, "user@example.com", "user@example.com", plan, 29.99, "USD").Return(assert.AnError).Once()

	err := svc.handlePaymentSucceeded(ctx, rawData)
	assert.Empty(t, err)
	mockEmail.AssertExpectations(t)
}

func TestWebhookService_HandlePaymentSucceeded_NoCustomer(t *testing.T) {
	svc := NewWebhookService(WebhookDependencies{Repo: new(MockWebhookRepository)})
	ctx := context.Background()

	invData := stripe.Invoice{ID: "inv_no_customer"}
	rawData, _ := json.Marshal(invData)

	err := svc.handlePaymentSucceeded(ctx, rawData)
	assert.Equal(t, ErrInvalidEvent, err)
}

func TestWebhookService_HandlePaymentSucceeded_SendsEmail(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	mockEmail := new(MockEmailService)
	svc := NewWebhookService(WebhookDependencies{
		Repo:         mockRepo,
		EmailService: mockEmail,
	})
	ctx := context.Background()

	customerID := "cus_123"
	rawData := stripeInvoicePaymentSucceededRaw("inv_123", customerID, "", 2999, stripe.CurrencyUSD)

	plan := string(PlanPro)
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
		Plan:  &plan,
	}, nil).Once()
	mockEmail.On("SendPaymentConfirmationEmail", ctx, "user@example.com", "user@example.com", plan, 29.99, "USD").Return(nil).Once()

	err := svc.handlePaymentSucceeded(ctx, rawData)
	assert.Empty(t, err)
	mockEmail.AssertExpectations(t)
}

func TestWebhookService_HandlePaymentSucceeded_UpdateUserError(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
	ctx := context.Background()

	customerID := "cus_123"
	rawData := stripeInvoicePaymentSucceededRaw("inv_123", customerID, "price_pro", 0, "")

	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{ID: 42, Email: "user@example.com"}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.Anything).Return(assert.AnError).Once()

	err := svc.handlePaymentSucceeded(ctx, rawData)
	assert.Equal(t, ErrDBError, err)
}

func TestWebhookService_HandleSubscriptionDeleted_NonCurrentSubscription(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
	ctx := context.Background()

	customerID := "cus_123"
	currentSubID := "sub_current"
	subData := stripe.Subscription{
		ID:       "sub_old",
		Customer: &stripe.Customer{ID: customerID},
		Items:    &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}
	rawData, _ := json.Marshal(subData)

	plan := string(PlanPro)
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:             42,
		Email:          "user@example.com",
		Plan:           &plan,
		SubscriptionID: &currentSubID,
	}, nil).Once()

	err := svc.handleSubscriptionDeleted(ctx, rawData, nil)
	assert.Empty(t, err)
	mockRepo.AssertNotCalled(t, "UpdateUser", mock.Anything, mock.Anything, mock.Anything)
}

func TestWebhookService_HandleSubscriptionUpdate_UnrecognizedActivePrice(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{
		Repo: mockRepo,
		GetPlanByPriceID: func(*string) *BillingPlanDefinition {
			return nil
		},
	})
	ctx := context.Background()

	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:       "sub_123",
		Status:   stripe.SubscriptionStatusActive,
		Customer: &stripe.Customer{ID: customerID},
		Items: &stripe.SubscriptionItemList{
			Data: []*stripe.SubscriptionItem{{Price: &stripe.Price{ID: "price_unknown"}}},
		},
	}
	rawData, _ := json.Marshal(subData)

	plan := string(PlanPro)
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
		Plan:  &plan,
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.MatchedBy(func(update WebhookUserUpdate) bool {
		return update.Plan != nil && *update.Plan == string(PlanFree)
	})).Return(nil).Once()

	err := svc.handleSubscriptionUpdate(ctx, rawData, nil)
	assert.Empty(t, err)
}
