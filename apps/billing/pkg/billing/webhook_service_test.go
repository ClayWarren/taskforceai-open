package billing

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

// MockWebhookRepository implements WebhookRepository for testing
type MockWebhookRepository struct {
	mock.Mock
}

func (m *MockWebhookRepository) HasProcessedEvent(ctx context.Context, stripeEventID string) (bool, error) {
	for _, expected := range m.ExpectedCalls {
		if expected.Method == "HasProcessedEvent" {
			args := m.Called(ctx, stripeEventID)
			return args.Bool(0), args.Error(1)
		}
	}

	// Default behavior for tests that don't care about pre-check dedupe.
	return false, nil
}

func (m *MockWebhookRepository) RecordEvent(ctx context.Context, stripeEventID, eventType string) (WebhookClaim, error) {
	for _, expected := range m.ExpectedCalls {
		if expected.Method == "RecordEvent" {
			args := m.Called(ctx, stripeEventID, eventType)
			if !args.Bool(0) {
				return "", args.Error(1)
			}
			return "test-claim", args.Error(1)
		}
	}

	// Default behavior for tests that don't care about persistence of processed events.
	return "test-claim", nil
}

func (m *MockWebhookRepository) CompleteEvent(ctx context.Context, stripeEventID string, _ WebhookClaim) error {
	for _, expected := range m.ExpectedCalls {
		if expected.Method == "CompleteEvent" {
			args := m.Called(ctx, stripeEventID)
			return args.Error(0)
		}
	}
	return nil
}

func (m *MockWebhookRepository) DeleteEvent(ctx context.Context, stripeEventID string, _ WebhookClaim) error {
	for _, expected := range m.ExpectedCalls {
		if expected.Method == "DeleteEvent" {
			args := m.Called(ctx, stripeEventID)
			return args.Error(0)
		}
	}
	return nil
}

func (m *MockWebhookRepository) FindUserByID(ctx context.Context, userID int) (*WebhookUser, error) {
	args := m.Called(ctx, userID)
	val, _ := args.Get(0).(*WebhookUser)
	return val, args.Error(1)
}

func (m *MockWebhookRepository) FindUserByCustomerID(ctx context.Context, customerID string) (*WebhookUser, error) {
	args := m.Called(ctx, customerID)
	val, _ := args.Get(0).(*WebhookUser)
	return val, args.Error(1)
}

func (m *MockWebhookRepository) UpdateUser(ctx context.Context, userID int, update WebhookUserUpdate) error {
	args := m.Called(ctx, userID, update)
	return args.Error(0)
}

// MockEmailService implements email.EmailService for testing
type MockEmailService struct {
	mock.Mock
}

func (m *MockEmailService) SendEmail(ctx context.Context, to, subject, htmlBody string) error {
	args := m.Called(ctx, to, subject, htmlBody)
	return args.Error(0)
}

func (m *MockEmailService) SendApiKeyCreatedEmail(ctx context.Context, to, displayName, keyName, prefix string) error {
	args := m.Called(ctx, to, displayName, keyName, prefix)
	return args.Error(0)
}

func (m *MockEmailService) SendApiKeyRevokedEmail(ctx context.Context, to, displayName, keyName string) error {
	args := m.Called(ctx, to, displayName, keyName)
	return args.Error(0)
}

func (m *MockEmailService) SendPaymentConfirmationEmail(ctx context.Context, to, displayName, plan string, amount float64, currency string) error {
	args := m.Called(ctx, to, displayName, plan, amount, currency)
	return args.Error(0)
}

func (m *MockEmailService) SendSubscriptionFailureEmail(ctx context.Context, to, displayName, plan, reason string) error {
	args := m.Called(ctx, to, displayName, plan, reason)
	return args.Error(0)
}

func (m *MockEmailService) SendIssueReportEmail(ctx context.Context, to, category, description, displayName string, metadata map[string]any) error {
	args := m.Called(ctx, to, category, description, displayName, metadata)
	return args.Error(0)
}

type retryableFailureRepo struct {
	user        *WebhookUser
	processed   map[string]bool
	updateCalls int
	deleteCalls int
}

func newRetryableFailureRepo(user *WebhookUser) *retryableFailureRepo {
	return &retryableFailureRepo{
		user:      user,
		processed: map[string]bool{},
	}
}

func (r *retryableFailureRepo) HasProcessedEvent(_ context.Context, stripeEventID string) (bool, error) {
	return r.processed[stripeEventID], nil
}

func (r *retryableFailureRepo) RecordEvent(_ context.Context, stripeEventID, _ string) (WebhookClaim, error) {
	if r.processed[stripeEventID] {
		return "", nil
	}
	r.processed[stripeEventID] = true
	return "retry-claim", nil
}

func (r *retryableFailureRepo) DeleteEvent(_ context.Context, stripeEventID string, _ WebhookClaim) error {
	delete(r.processed, stripeEventID)
	r.deleteCalls++
	return nil
}

func (r *retryableFailureRepo) CompleteEvent(_ context.Context, stripeEventID string, _ WebhookClaim) error {
	r.processed[stripeEventID] = true
	return nil
}

func (r *retryableFailureRepo) FindUserByID(context.Context, int) (*WebhookUser, error) {
	return nil, nil
}

func (r *retryableFailureRepo) FindUserByCustomerID(context.Context, string) (*WebhookUser, error) {
	return r.user, nil
}

func (r *retryableFailureRepo) UpdateUser(context.Context, int, WebhookUserUpdate) error {
	r.updateCalls++
	if r.updateCalls == 1 {
		return assert.AnError
	}
	return nil
}

func proPlanByPriceID(priceID *string) *BillingPlanDefinition {
	if priceID != nil && *priceID == "price_pro" {
		return &BillingPlanDefinition{Plan: PlanPro}
	}
	return nil
}

func stripeSubscriptionEvent(eventID, eventType, subID string, metadata map[string]string) *stripe.Event {
	subData := stripe.Subscription{
		ID:       subID,
		Status:   stripe.SubscriptionStatusActive,
		Customer: &stripe.Customer{ID: "cus_123"},
		Items: &stripe.SubscriptionItemList{
			Data: []*stripe.SubscriptionItem{{
				CurrentPeriodStart: 1700000000,
				CurrentPeriodEnd:   1703000000,
				Price:              &stripe.Price{ID: "price_pro"},
			}},
		},
		Metadata: metadata,
	}
	rawData, _ := json.Marshal(subData)
	return &stripe.Event{
		ID:   eventID,
		Type: stripe.EventType(eventType),
		Data: &stripe.EventData{Raw: rawData},
	}
}

func expectFreshWebhookEvent(mock *MockWebhookRepository, ctx context.Context, eventID, eventType string) {
	mock.On("HasProcessedEvent", ctx, eventID).Return(false, nil).Once()
	mock.On("RecordEvent", ctx, eventID, eventType).Return(true, nil).Once()
}

func stripeInvoiceFailedRaw(invoiceID, customerID string) []byte {
	invData := stripe.Invoice{
		ID:       invoiceID,
		Customer: &stripe.Customer{ID: customerID},
	}
	rawData, _ := json.Marshal(invData)
	return rawData
}

func stripeInvoicePaymentSucceededRaw(invoiceID, customerID, priceID string, amountPaid int64, currency stripe.Currency) []byte {
	inv := stripe.Invoice{
		ID:         invoiceID,
		Customer:   &stripe.Customer{ID: customerID},
		AmountPaid: amountPaid,
		Currency:   currency,
	}
	if priceID != "" {
		inv.Lines = &stripe.InvoiceLineItemList{
			Data: []*stripe.InvoiceLineItem{{
				Pricing: &stripe.InvoiceLineItemPricing{
					PriceDetails: &stripe.InvoiceLineItemPricingPriceDetails{Price: priceID},
				},
			}},
		}
	}
	rawData, _ := json.Marshal(inv)
	return rawData
}

func stripeInvoicePaymentEvent(eventID, invoiceID, customerID, priceID string, amountPaid int64) *stripe.Event {
	invData := stripe.Invoice{
		ID:         invoiceID,
		Customer:   &stripe.Customer{ID: customerID},
		AmountPaid: amountPaid,
		Lines: &stripe.InvoiceLineItemList{
			Data: []*stripe.InvoiceLineItem{{
				Pricing: &stripe.InvoiceLineItemPricing{
					PriceDetails: &stripe.InvoiceLineItemPricingPriceDetails{Price: priceID},
				},
			}},
		},
	}
	rawData, _ := json.Marshal(invData)
	return &stripe.Event{
		ID:   eventID,
		Type: "invoice.payment_succeeded",
		Data: &stripe.EventData{Raw: rawData},
	}
}

func TestParseInvoice_InvalidJSON(t *testing.T) {
	_, err := parseInvoice(json.RawMessage("invalid json"))

	assert.Equal(t, ErrInvalidEvent, err)
}

func TestParseInvoice_NoLines(t *testing.T) {
	customerID := "cus_123"
	invData := stripe.Invoice{
		ID:         "inv_123",
		Customer:   &stripe.Customer{ID: customerID},
		AmountPaid: 2999,
		Lines:      &stripe.InvoiceLineItemList{Data: []*stripe.InvoiceLineItem{}},
	}
	rawData, _ := json.Marshal(invData)

	result, err := parseInvoice(rawData)

	assert.Empty(t, err)
	assert.Equal(t, "inv_123", *result.ID)
	assert.Nil(t, result.PriceID)
}

func TestParseInvoice_ValidData(t *testing.T) {
	customerID := "cus_123"
	invData := stripe.Invoice{
		ID:         "inv_123",
		Customer:   &stripe.Customer{ID: customerID},
		AmountPaid: 2999,
		Currency:   stripe.CurrencyUSD,
		Lines: &stripe.InvoiceLineItemList{
			Data: []*stripe.InvoiceLineItem{
				{
					Pricing: &stripe.InvoiceLineItemPricing{
						PriceDetails: &stripe.InvoiceLineItemPricingPriceDetails{
							Price: "price_pro",
						},
					},
				},
			},
		},
	}
	rawData, _ := json.Marshal(invData)

	result, err := parseInvoice(rawData)

	assert.Empty(t, err)
	assert.Equal(t, "inv_123", *result.ID)
	assert.Equal(t, customerID, *result.CustomerID)
	assert.Equal(t, int64(2999), *result.AmountPaid)
	assert.Equal(t, "USD", *result.Currency)
	assert.Equal(t, "price_pro", *result.PriceID)
}

func TestParseInvoice_StringCustomerField(t *testing.T) {
	rawData := json.RawMessage(`{
		"id": "inv_123",
		"customer": "cus_123",
		"amount_paid": 2999,
		"currency": "usd",
		"lines": {
			"data": [{
				"pricing": {
					"price_details": {
						"price": "price_pro"
					}
				}
			}]
		}
	}`)

	result, err := parseInvoice(rawData)

	require.Empty(t, err)
	require.NotNil(t, result.CustomerID)
	require.NotNil(t, result.PriceID)
	assert.Equal(t, "cus_123", *result.CustomerID)
	assert.Equal(t, "price_pro", *result.PriceID)
	assert.Equal(t, "USD", *result.Currency)
}

func BenchmarkParseInvoice(b *testing.B) {
	customerID := "cus_123"
	invData := stripe.Invoice{
		ID:         "inv_123",
		Customer:   &stripe.Customer{ID: customerID},
		AmountPaid: 2999,
		Currency:   stripe.CurrencyUSD,
		Lines: &stripe.InvoiceLineItemList{
			Data: []*stripe.InvoiceLineItem{
				{
					Pricing: &stripe.InvoiceLineItemPricing{
						PriceDetails: &stripe.InvoiceLineItemPricingPriceDetails{
							Price: "price_pro",
						},
					},
				},
			},
		},
	}
	rawData, err := json.Marshal(invData)
	require.NoError(b, err)

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		result, werr := parseInvoice(rawData)
		if werr != "" {
			b.Fatal(werr)
		}
		if result.PriceID == nil || *result.PriceID != "price_pro" {
			b.Fatal("price ID was not parsed")
		}
	}
}

func TestParseSubscription_InvalidJSON(t *testing.T) {
	_, err := parseSubscription(json.RawMessage("invalid json"))

	assert.Equal(t, ErrInvalidEvent, err)
}

func TestParseSubscription_NoItems(t *testing.T) {
	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:       "sub_123",
		Status:   stripe.SubscriptionStatusActive,
		Customer: &stripe.Customer{ID: customerID},
		Items:    &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{}},
	}
	rawData, _ := json.Marshal(subData)

	result, err := parseSubscription(rawData)

	assert.Empty(t, err)
	assert.Equal(t, "sub_123", result.ID)
	assert.Nil(t, result.PriceID)
}

func TestParseSubscription_ValidData(t *testing.T) {
	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:                "sub_123",
		Status:            stripe.SubscriptionStatusActive,
		CancelAtPeriodEnd: true,
		Customer:          &stripe.Customer{ID: customerID},
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

	result, err := parseSubscription(rawData)

	assert.Empty(t, err)
	assert.Equal(t, "sub_123", result.ID)
	assert.Equal(t, "active", result.Status)
	assert.True(t, result.CancelAtPeriodEnd)
	assert.Equal(t, customerID, *result.CustomerID)
	assert.Equal(t, 42, *result.UserID)
	assert.Equal(t, int64(1700000000), *result.CurrentPeriodStart)
	assert.Equal(t, int64(1703000000), *result.CurrentPeriodEnd)
	assert.Equal(t, "price_pro", *result.PriceID)
}

func TestParseSubscription_StringIDFields(t *testing.T) {
	rawData := json.RawMessage(`{
		"id": "sub_123",
		"status": "active",
		"customer": "cus_123",
		"metadata": {"userId": "42"},
		"items": {
			"data": [{
				"current_period_start": 1700000000,
				"current_period_end": 1703000000,
				"price": "price_pro"
			}]
		}
	}`)

	result, err := parseSubscription(rawData)

	require.Empty(t, err)
	require.NotNil(t, result.CustomerID)
	require.NotNil(t, result.PriceID)
	assert.Equal(t, "cus_123", *result.CustomerID)
	assert.Equal(t, "price_pro", *result.PriceID)
}

func BenchmarkParseSubscription(b *testing.B) {
	customerID := "cus_123"
	subData := stripe.Subscription{
		ID:                "sub_123",
		Status:            stripe.SubscriptionStatusActive,
		CancelAtPeriodEnd: true,
		Customer:          &stripe.Customer{ID: customerID},
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
	rawData, err := json.Marshal(subData)
	require.NoError(b, err)

	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		result, werr := parseSubscription(rawData)
		if werr != "" {
			b.Fatal(werr)
		}
		if result.PriceID == nil || *result.PriceID != "price_pro" {
			b.Fatal("price ID was not parsed")
		}
	}
}

func TestPtrOr(t *testing.T) {
	// Test with nil
	assert.Equal(t, "default", ptrOr[string](nil, "default"))

	// Test with value
	val := "actual"
	assert.Equal(t, "actual", ptrOr(&val, "default"))

	// Test with int
	num := 42
	assert.Equal(t, 42, ptrOr(&num, 0))
	assert.Equal(t, 0, ptrOr[int](nil, 0))
}

func TestTimestampToDate(t *testing.T) {
	// Zero timestamp returns nil
	result := TimestampToDate(0)
	assert.Nil(t, result)

	// Valid timestamp
	result = TimestampToDate(1700000000)
	assert.NotNil(t, result)
	assert.Equal(t, int64(1700000000), result.Unix())
}

func TestWebhookService_FindUserForSubscription_ByUserID(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
	ctx := context.Background()

	mockRepo.On("FindUserByID", ctx, 42).Return(&WebhookUser{ID: 42, Email: "user@example.com"}, nil).Once()

	user, werr := svc.findUserForSubscription(ctx, &parsedSubscription{UserID: new(42)})
	assert.Empty(t, werr)
	assert.Equal(t, 42, user.ID)
}

func TestWebhookService_FindUserForSubscription_NoCustomerID(t *testing.T) {
	svc := NewWebhookService(WebhookDependencies{Repo: new(MockWebhookRepository)})

	user, werr := svc.findUserForSubscription(context.Background(), &parsedSubscription{})
	assert.Equal(t, ErrInvalidEvent, werr)
	assert.Nil(t, user)
}

func TestWebhookService_HandleEvent_CheckoutSessionCompleted(t *testing.T) {
	svc, mockRepo, ctx := newWebhookTest()

	sessionData := stripe.CheckoutSession{
		ID:       "cs_123",
		Mode:     stripe.CheckoutSessionModeSubscription,
		Customer: &stripe.Customer{ID: "cus_123"},
	}
	rawData, _ := json.Marshal(sessionData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "checkout.session.completed",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "checkout.session.completed").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
}

func TestWebhookService_HandleEvent_DBErrorOnDedupeCheck(t *testing.T) {
	svc, mockRepo, ctx := newWebhookTest()

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "unknown.event.type",
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, assert.AnError).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Equal(t, ErrDBError, err)
	assert.Nil(t, result)
	mockRepo.AssertNotCalled(t, "RecordEvent")
}

func TestWebhookService_HandleEvent_DBErrorOnRecord(t *testing.T) {
	svc, mockRepo, ctx := newWebhookTest()

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "unknown.event.type",
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "unknown.event.type").Return(false, assert.AnError).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Equal(t, ErrDBError, err)
	assert.Nil(t, result)
}

func TestWebhookService_HandleEvent_DuplicateEvent(t *testing.T) {
	svc, mockRepo, ctx := newWebhookTest()

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "customer.subscription.created",
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.False(t, result.Processed)
	mockRepo.AssertNotCalled(t, "RecordEvent")
}

func TestWebhookService_HandleEvent_InvalidEvent(t *testing.T) {
	svc, mockRepo, ctx := newWebhookTest()

	result, err := svc.HandleEvent(ctx, &stripe.Event{Type: "invoice.payment_failed"})

	assert.Equal(t, ErrInvalidEvent, err)
	assert.Nil(t, result)
	mockRepo.AssertNotCalled(t, "HasProcessedEvent")
	mockRepo.AssertNotCalled(t, "RecordEvent")
}

func TestWebhookService_HandleEvent_PaymentFailed(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	mockEmail := new(MockEmailService)

	plan := string(PlanPro)
	fullName := "John Doe"
	svc := NewWebhookService(WebhookDependencies{
		Repo:         mockRepo,
		EmailService: mockEmail,
	})
	ctx := context.Background()

	customerID := "cus_123"
	invData := stripe.Invoice{
		ID:       "inv_123",
		Customer: &stripe.Customer{ID: customerID},
	}
	rawData, _ := json.Marshal(invData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "invoice.payment_failed",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:       42,
		Email:    "user@example.com",
		FullName: &fullName,
		Plan:     &plan,
	}, nil).Once()
	mockEmail.On("SendSubscriptionFailureEmail", ctx, "user@example.com", fullName, plan, "Payment declined").Return(nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "invoice.payment_failed").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
	mockEmail.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_PaymentFailed_HandlerError(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	svc := NewWebhookService(WebhookDependencies{Repo: mockRepo})
	ctx := context.Background()

	customerID := "cus_123"
	invData := stripe.Invoice{
		ID:       "inv_failed",
		Customer: &stripe.Customer{ID: customerID},
	}
	rawData, _ := json.Marshal(invData)

	event := &stripe.Event{
		ID:   "evt_payment_failed",
		Type: "invoice.payment_failed",
		Data: &stripe.EventData{Raw: rawData},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_payment_failed").Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_payment_failed", "invoice.payment_failed").Return(true, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(nil, assert.AnError).Once()

	result, err := svc.HandleEvent(ctx, event)
	assert.Equal(t, ErrDBError, err)
	assert.Nil(t, result)
}

func TestWebhookService_HandleEvent_PaymentFailed_UserNotFound(t *testing.T) {
	svc, mockRepo, ctx := newWebhookTest()

	customerID := "cus_123"
	invData := stripe.Invoice{
		ID:       "inv_123",
		Customer: &stripe.Customer{ID: customerID},
	}
	rawData, _ := json.Marshal(invData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "invoice.payment_failed",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(nil, ErrBillingUserNotFound).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "invoice.payment_failed").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
}

func TestWebhookService_HandleEvent_PaymentSucceeded(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	mockEmail := new(MockEmailService)

	plan := string(PlanPro)
	svc := NewWebhookService(WebhookDependencies{
		Repo:         mockRepo,
		EmailService: mockEmail,
	})
	ctx := context.Background()

	customerID := "cus_123"
	invData := stripe.Invoice{
		ID:         "inv_123",
		Customer:   &stripe.Customer{ID: customerID},
		AmountPaid: 2999, // $29.99 in cents
		Currency:   stripe.CurrencyUSD,
		Lines: &stripe.InvoiceLineItemList{
			Data: []*stripe.InvoiceLineItem{
				{
					Pricing: &stripe.InvoiceLineItemPricing{
						PriceDetails: &stripe.InvoiceLineItemPricingPriceDetails{
							Price: "price_pro",
						},
					},
				},
			},
		},
	}
	rawData, _ := json.Marshal(invData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "invoice.payment_succeeded",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
		Plan:  &plan,
	}, nil).Once()
	mockRepo.On("UpdateUser", ctx, 42, mock.Anything).Return(nil).Once()
	mockEmail.On("SendPaymentConfirmationEmail", ctx, "user@example.com", "user@example.com", plan, 29.99, "USD").Return(nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "invoice.payment_succeeded").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
	mockEmail.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_PaymentSucceeded_UserNotFound(t *testing.T) {
	svc, mockRepo, ctx := newWebhookTest()

	customerID := "cus_123"
	invData := stripe.Invoice{
		ID:         "inv_123",
		Customer:   &stripe.Customer{ID: customerID},
		AmountPaid: 2999,
		Lines: &stripe.InvoiceLineItemList{
			Data: []*stripe.InvoiceLineItem{},
		},
	}
	rawData, _ := json.Marshal(invData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "invoice.payment_succeeded",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(nil, ErrBillingUserNotFound).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Equal(t, ErrInvalidEvent, err)
	assert.Nil(t, result)
}

func TestWebhookService_HandleEvent_PaymentSucceeded_ZeroDecimalCurrency(t *testing.T) {
	mockRepo := new(MockWebhookRepository)
	mockEmail := new(MockEmailService)

	plan := string(PlanPro)
	svc := NewWebhookService(WebhookDependencies{
		Repo:         mockRepo,
		EmailService: mockEmail,
	})
	ctx := context.Background()

	customerID := "cus_123"
	invData := stripe.Invoice{
		ID:         "inv_123",
		Customer:   &stripe.Customer{ID: customerID},
		AmountPaid: 500, // JPY 500
		Currency:   stripe.CurrencyJPY,
	}
	rawData, _ := json.Marshal(invData)

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "invoice.payment_succeeded",
		Data: &stripe.EventData{
			Raw: rawData,
		},
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("FindUserByCustomerID", ctx, customerID).Return(&WebhookUser{
		ID:    42,
		Email: "user@example.com",
		Plan:  &plan,
	}, nil).Once()
	mockEmail.On("SendPaymentConfirmationEmail", ctx, "user@example.com", "user@example.com", plan, 500.0, "JPY").Return(nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "invoice.payment_succeeded").Return(true, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Empty(t, err)
	assert.True(t, result.Processed)
	mockRepo.AssertExpectations(t)
	mockEmail.AssertExpectations(t)
}

func TestWebhookService_HandleEvent_RecordEventRace(t *testing.T) {
	svc, mockRepo, ctx := newWebhookTest()

	event := &stripe.Event{
		ID:   "evt_123",
		Type: "unknown.event.type",
	}

	mockRepo.On("HasProcessedEvent", ctx, "evt_123").Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, "evt_123", "unknown.event.type").Return(false, nil).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Equal(t, ErrDBError, err)
	assert.Nil(t, result)
}

func TestWebhookService_HandleEvent_CompletionFailureKeepsClaimForLeaseRetry(t *testing.T) {
	svc, mockRepo, ctx := newWebhookTest()
	event := &stripe.Event{ID: "evt_complete_failure", Type: "unknown.event.type"}

	mockRepo.On("HasProcessedEvent", ctx, event.ID).Return(false, nil).Once()
	mockRepo.On("RecordEvent", ctx, event.ID, "unknown.event.type").Return(true, nil).Once()
	mockRepo.On("CompleteEvent", ctx, event.ID).Return(assert.AnError).Once()

	result, err := svc.HandleEvent(ctx, event)

	assert.Nil(t, result)
	assert.Equal(t, ErrDBError, err)
	mockRepo.AssertNotCalled(t, "DeleteEvent", mock.Anything, mock.Anything)
}
