package billing

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

type mockStripeBackend struct {
	mock.Mock
}

func stripeBackendResult[T any](args mock.Arguments) (T, error) {
	val, _ := args.Get(0).(T)
	return val, args.Error(1)
}

func (m *mockStripeBackend) CustomerGet(id string, params *stripe.CustomerParams) (*stripe.Customer, error) {
	return stripeBackendResult[*stripe.Customer](m.Called(id, params))
}

func (m *mockStripeBackend) CustomerNew(params *stripe.CustomerParams) (*stripe.Customer, error) {
	return stripeBackendResult[*stripe.Customer](m.Called(params))
}

func (m *mockStripeBackend) SessionNew(params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
	return stripeBackendResult[*stripe.CheckoutSession](m.Called(params))
}

func (m *mockStripeBackend) SubscriptionNew(params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	return stripeBackendResult[*stripe.Subscription](m.Called(params))
}

func (m *mockStripeBackend) SubscriptionGet(id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	return stripeBackendResult[*stripe.Subscription](m.Called(id, params))
}

func (m *mockStripeBackend) SubscriptionUpdate(id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	return stripeBackendResult[*stripe.Subscription](m.Called(id, params))
}

func (m *mockStripeBackend) PriceGet(id string, params *stripe.PriceParams) (*stripe.Price, error) {
	return stripeBackendResult[*stripe.Price](m.Called(id, params))
}

func (m *mockStripeBackend) PaymentMethodList(params *stripe.PaymentMethodListParams) ([]*stripe.PaymentMethod, error) {
	return stripeBackendResult[[]*stripe.PaymentMethod](m.Called(params))
}

func (m *mockStripeBackend) InvoiceList(params *stripe.InvoiceListParams) ([]*stripe.Invoice, error) {
	return stripeBackendResult[[]*stripe.Invoice](m.Called(params))
}

func (m *mockStripeBackend) BillingPortalSessionNew(params *stripe.BillingPortalSessionParams) (*stripe.BillingPortalSession, error) {
	return stripeBackendResult[*stripe.BillingPortalSession](m.Called(params))
}

// newStripeTestClient returns a StripeClient backed by a fresh mock and a
// fresh circuit breaker, along with the mock for setting up expectations.
// The breaker must not be shared across tests: error-path tests would feed
// failures into it and trip it open for whichever test runs next.
func newStripeTestClient() (*StripeClient, *mockStripeBackend) {
	mockBackend := new(mockStripeBackend)
	cb := circuitbreaker.New(circuitbreaker.Config{
		Name:             "test_stripe_client",
		FailureThreshold: 5,
		ResetTimeout:     60 * time.Second,
		SuccessThreshold: 2,
		IsTransient:      isStripeTransientError,
	})
	return &StripeClient{backend: mockBackend, cb: cb}, mockBackend
}

func TestStripeClient_GetOrCreateCustomer_ExistingTransientErrorDoesNotCreate(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("CustomerGet", "cus_err", (*stripe.CustomerParams)(nil)).Return((*stripe.Customer)(nil), errors.New("timeout"))

	_, err := client.GetOrCreateCustomer(context.Background(), "user1", "test@example.com", "cus_err")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to retrieve customer")
	mockBackend.AssertNotCalled(t, "CustomerNew", mock.Anything)
}

func TestStripeClient_GetOrCreateCustomer_ExistingMissingCreatesNewCustomer(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	resourceMissing := &stripe.Error{Code: stripe.ErrorCodeResourceMissing}
	expectedCustomer := &stripe.Customer{ID: "cus_new", Deleted: false}
	mockBackend.On("CustomerGet", "cus_missing", (*stripe.CustomerParams)(nil)).Return((*stripe.Customer)(nil), resourceMissing)
	mockBackend.On("CustomerNew", mock.Anything).Return(expectedCustomer, nil)

	cust, err := client.GetOrCreateCustomer(context.Background(), "user1", "test@example.com", "cus_missing")
	require.NoError(t, err)
	assert.Equal(t, "cus_new", cust.ID)
}

func TestStripeClient_CreateCheckoutSession_Error(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("SessionNew", mock.Anything).Return((*stripe.CheckoutSession)(nil), errors.New("stripe error"))

	_, err := client.CreateCheckoutSession(context.Background(), &stripe.CheckoutSessionParams{})
	assert.Error(t, err)
}

func TestStripeClient_CreateCustomer(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	expectedCustomer := &stripe.Customer{ID: "cus_123"}
	mockBackend.On("CustomerNew", mock.Anything).Return(expectedCustomer, nil)

	cust, err := client.CreateCustomer(context.Background(), &stripe.CustomerParams{})
	require.NoError(t, err)
	assert.Equal(t, "cus_123", cust.ID)
}

func TestStripeClient_CreateCustomer_Error(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("CustomerNew", mock.Anything).Return((*stripe.Customer)(nil), errors.New("err"))

	_, err := client.CreateCustomer(context.Background(), &stripe.CustomerParams{})
	assert.Error(t, err)
}

func TestStripeClient_CreateSubscription(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	expectedSub := &stripe.Subscription{ID: "sub_123"}
	mockBackend.On("SubscriptionNew", mock.Anything).Return(expectedSub, nil)

	sub, err := client.CreateSubscription(context.Background(), &stripe.SubscriptionParams{})
	require.NoError(t, err)
	assert.Equal(t, "sub_123", sub.ID)
}

func TestStripeClient_CreateSubscription_Error(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("SubscriptionNew", mock.Anything).Return((*stripe.Subscription)(nil), errors.New("err"))

	_, err := client.CreateSubscription(context.Background(), &stripe.SubscriptionParams{})
	assert.Error(t, err)
}

func TestStripeClient_GetSubscription(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	expectedSub := &stripe.Subscription{ID: "sub_123"}
	mockBackend.On("SubscriptionGet", "sub_123", (*stripe.SubscriptionParams)(nil)).Return(expectedSub, nil)

	sub, err := client.GetSubscription(context.Background(), "sub_123", nil)
	require.NoError(t, err)
	assert.Equal(t, "sub_123", sub.ID)
}

func TestStripeClient_GetSubscription_Error(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("SubscriptionGet", "sub_err", mock.Anything).Return((*stripe.Subscription)(nil), errors.New("err"))

	_, err := client.GetSubscription(context.Background(), "sub_err", nil)
	assert.Error(t, err)
}

func TestStripeClient_UpdateSubscription(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	expectedSub := &stripe.Subscription{ID: "sub_123"}
	mockBackend.On("SubscriptionUpdate", "sub_123", mock.Anything).Return(expectedSub, nil)

	sub, err := client.UpdateSubscription(context.Background(), "sub_123", &stripe.SubscriptionParams{})
	require.NoError(t, err)
	assert.Equal(t, "sub_123", sub.ID)
}

func TestStripeClient_UpdateSubscription_Error(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("SubscriptionUpdate", "sub_err", mock.Anything).Return((*stripe.Subscription)(nil), errors.New("err"))

	_, err := client.UpdateSubscription(context.Background(), "sub_err", &stripe.SubscriptionParams{})
	assert.Error(t, err)
}

func TestStripeClient_GetPrice_Error(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("PriceGet", "p_err", mock.Anything).Return((*stripe.Price)(nil), errors.New("err"))

	_, err := client.GetPrice(context.Background(), "p_err", nil)
	assert.Error(t, err)
}

func TestStripeClient_InitializesNilParamsAndPropagatesContexts(t *testing.T) {
	type contextKey struct{}
	ctx := context.WithValue(context.Background(), contextKey{}, "request-context")
	hasRequestContext := func(ctx context.Context) bool {
		return ctx != nil && ctx.Value(contextKey{}) == "request-context"
	}

	client, backend := newStripeTestClient()
	backend.On("SessionNew", mock.MatchedBy(func(params *stripe.CheckoutSessionParams) bool {
		return params != nil && hasRequestContext(params.Context)
	})).Return(&stripe.CheckoutSession{ID: "cs_123"}, nil).Once()
	_, err := client.CreateCheckoutSession(ctx, nil)
	require.NoError(t, err)

	client, backend = newStripeTestClient()
	backend.On("CustomerNew", mock.MatchedBy(func(params *stripe.CustomerParams) bool {
		return params != nil && hasRequestContext(params.Context)
	})).Return(&stripe.Customer{ID: "cus_123"}, nil).Once()
	_, err = client.CreateCustomer(ctx, nil)
	require.NoError(t, err)

	client, backend = newStripeTestClient()
	backend.On("SubscriptionNew", mock.MatchedBy(func(params *stripe.SubscriptionParams) bool {
		return params != nil && hasRequestContext(params.Context)
	})).Return(&stripe.Subscription{ID: "sub_123"}, nil).Once()
	_, err = client.CreateSubscription(ctx, nil)
	require.NoError(t, err)

	client, backend = newStripeTestClient()
	backend.On("SubscriptionUpdate", "sub_123", mock.MatchedBy(func(params *stripe.SubscriptionParams) bool {
		return params != nil && hasRequestContext(params.Context)
	})).Return(&stripe.Subscription{ID: "sub_123"}, nil).Once()
	_, err = client.UpdateSubscription(ctx, "sub_123", nil)
	require.NoError(t, err)

	client, backend = newStripeTestClient()
	subscriptionParams := &stripe.SubscriptionParams{}
	backend.On("SubscriptionGet", "sub_123", subscriptionParams).Return(&stripe.Subscription{ID: "sub_123"}, nil).Once()
	_, err = client.GetSubscription(ctx, "sub_123", subscriptionParams)
	require.NoError(t, err)
	require.Equal(t, ctx, subscriptionParams.Context)

	client, backend = newStripeTestClient()
	priceParams := &stripe.PriceParams{}
	backend.On("PriceGet", "price_123", priceParams).Return(&stripe.Price{ID: "price_123"}, nil).Once()
	_, err = client.GetPrice(ctx, "price_123", priceParams)
	require.NoError(t, err)
	require.Equal(t, ctx, priceParams.Context)
}

func TestStripeClient_ListPaymentMethods_Error(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("PaymentMethodList", mock.Anything).Return(([]*stripe.PaymentMethod)(nil), errors.New("err"))

	_, err := client.ListPaymentMethods(context.Background(), "cus_123")
	assert.Error(t, err)
}

func TestStripeClient_ListPaymentMethods_EmptyCustomer(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	pms, err := client.ListPaymentMethods(context.Background(), "")

	require.NoError(t, err)
	assert.Nil(t, pms)
	mockBackend.AssertNotCalled(t, "PaymentMethodList", mock.Anything)
}

func TestStripeClient_ListInvoices_Error(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("InvoiceList", mock.Anything).Return(([]*stripe.Invoice)(nil), errors.New("err"))

	_, err := client.ListInvoices(context.Background(), "cus_123")
	assert.Error(t, err)
}

func TestStripeClient_ListInvoices_EmptyCustomer(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	invoices, err := client.ListInvoices(context.Background(), "")

	require.NoError(t, err)
	assert.Nil(t, invoices)
	mockBackend.AssertNotCalled(t, "InvoiceList", mock.Anything)
}

func TestStripeClient_CreateCustomerPortalSession_Error(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("BillingPortalSessionNew", mock.Anything).Return((*stripe.BillingPortalSession)(nil), errors.New("err"))

	_, err := client.CreateCustomerPortalSession(context.Background(), "cus_123", "url")
	assert.Error(t, err)
}

func TestStripeClient_CreateCustomerPortalSession_EmptyCustomer(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	url, err := client.CreateCustomerPortalSession(context.Background(), "", "url")

	require.Error(t, err)
	assert.Empty(t, url)
	mockBackend.AssertNotCalled(t, "BillingPortalSessionNew", mock.Anything)
}

func TestStripeClient_ListPaymentMethods(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	expectedPMs := []*stripe.PaymentMethod{{ID: "pm_123"}}
	mockBackend.On("PaymentMethodList", mock.Anything).Return(expectedPMs, nil)

	pms, err := client.ListPaymentMethods(context.Background(), "cus_123")
	require.NoError(t, err)
	assert.Len(t, pms, 1)
	assert.Equal(t, "pm_123", pms[0].ID)
}

func TestStripeClient_ListInvoices(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	expectedInvoices := []*stripe.Invoice{{ID: "inv_123"}}
	mockBackend.On("InvoiceList", mock.Anything).Return(expectedInvoices, nil)

	invs, err := client.ListInvoices(context.Background(), "cus_123")
	require.NoError(t, err)
	assert.Len(t, invs, 1)
	assert.Equal(t, "inv_123", invs[0].ID)
}

func TestStripeClient_CreateCustomerPortalSession(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	expectedSession := &stripe.BillingPortalSession{URL: "https://stripe.com/portal"}
	mockBackend.On("BillingPortalSessionNew", mock.Anything).Return(expectedSession, nil)

	url, err := client.CreateCustomerPortalSession(context.Background(), "cus_123", "https://example.com/return")
	require.NoError(t, err)
	assert.Equal(t, "https://stripe.com/portal", url)
}

func TestStripeClient_CircuitBreaker(t *testing.T) {
	mockBackend := new(mockStripeBackend)
	cb := getRevenueCatCircuitBreaker()
	// Force failure to open it (assuming threshold is 5)
	for range 6 {
		_ = cb.Execute(context.Background(), func() error { return errors.New("timeout") })
	}

	client := &StripeClient{
		backend: mockBackend,
		cb:      cb,
	}

	_, err := client.GetPrice(context.Background(), "price_123", nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "temporarily unavailable")
}

func TestStripeClient_GetOrCreateCustomer_Existing_Success(t *testing.T) {
	mockBackend := new(mockStripeBackend)
	cb := circuitbreaker.New(circuitbreaker.Config{
		Name:             "test_stripe_customer",
		FailureThreshold: 5,
		ResetTimeout:     60 * time.Second,
		SuccessThreshold: 2,
		IsTransient:      isStripeTransientError,
	})
	client := &StripeClient{
		backend: mockBackend,
		cb:      cb,
	}

	expectedCustomer := &stripe.Customer{ID: "cus_existing", Deleted: false}
	mockBackend.On("CustomerGet", "cus_existing", (*stripe.CustomerParams)(nil)).Return(expectedCustomer, nil)

	cust, err := client.GetOrCreateCustomer(context.Background(), "user1", "test@example.com", "cus_existing")
	require.NoError(t, err)
	assert.NotNil(t, cust)
	assert.Equal(t, "cus_existing", cust.ID)
}

func TestStripeClient_GetOrCreateCustomer_CreatesNewCustomer(t *testing.T) {
	mockBackend := new(mockStripeBackend)
	cb := circuitbreaker.New(circuitbreaker.Config{
		Name:             "test_stripe_customer_create",
		FailureThreshold: 5,
		ResetTimeout:     60 * time.Second,
		SuccessThreshold: 2,
		IsTransient:      isStripeTransientError,
	})
	client := &StripeClient{
		backend: mockBackend,
		cb:      cb,
	}

	expectedCustomer := &stripe.Customer{ID: "cus_new", Deleted: false}
	mockBackend.On("CustomerNew", mock.MatchedBy(func(params *stripe.CustomerParams) bool {
		return params != nil && params.Context != nil && params.IdempotencyKey != nil &&
			*params.IdempotencyKey == "billing-customer-user1"
	})).Return(expectedCustomer, nil)

	cust, err := client.GetOrCreateCustomer(context.Background(), "user1", "test@example.com", "")
	require.NoError(t, err)
	assert.NotNil(t, cust)
	assert.Equal(t, "cus_new", cust.ID)
}

func TestStripeClient_GetOrCreateCustomer_CreateError(t *testing.T) {
	client, mockBackend := newStripeTestClient()

	mockBackend.On("CustomerNew", mock.Anything).Return((*stripe.Customer)(nil), errors.New("create failed"))

	cust, err := client.GetOrCreateCustomer(context.Background(), "user1", "test@example.com", "")

	require.Error(t, err)
	assert.Nil(t, cust)
	assert.Contains(t, err.Error(), "failed to create customer")
	mockBackend.AssertExpectations(t)
}

func TestStripeClient_GetOrCreateCustomer_CircuitOpen(t *testing.T) {
	mockBackend := new(mockStripeBackend)
	client := &StripeClient{
		backend: mockBackend,
		cb:      nil,
	}

	cust, err := client.GetOrCreateCustomer(context.Background(), "user1", "test@example.com", "")

	require.Error(t, err)
	assert.Nil(t, cust)
	assert.Contains(t, err.Error(), "temporarily unavailable")
	mockBackend.AssertNotCalled(t, "CustomerNew", mock.Anything)
}
