package handler

import (
	"context"
	"encoding/json"
	"math"
	"math/big"
	"net/http"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/billing-service/pkg/billing"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/stripe/stripe-go/v82"
)

type mockStripeClient struct {
	mock.Mock
}

func (m *mockStripeClient) ListPaymentMethods(ctx context.Context, customerID string) ([]*stripe.PaymentMethod, error) {
	args := m.Called(ctx, customerID)
	val, _ := args.Get(0).([]*stripe.PaymentMethod)
	return val, args.Error(1)
}

func (m *mockStripeClient) GetPrice(ctx context.Context, id string, params *stripe.PriceParams) (*stripe.Price, error) {
	args := m.Called(ctx, id, params)
	val, _ := args.Get(0).(*stripe.Price)
	return val, args.Error(1)
}

func (m *mockStripeClient) ListInvoices(ctx context.Context, customerID string) ([]*stripe.Invoice, error) {
	args := m.Called(ctx, customerID)
	val, _ := args.Get(0).([]*stripe.Invoice)
	return val, args.Error(1)
}

func (m *mockStripeClient) CreateCustomerPortalSession(ctx context.Context, customerID, returnURL string) (string, error) {
	args := m.Called(ctx, customerID, returnURL)
	return args.String(0), args.Error(1)
}

func billingAPIUser(u dbtest.User) dbtest.User {
	u.Baseline = dbtest.BaselineBilling
	if u.ID == 0 {
		u.ID = 1
	}
	if u.Email == "" {
		u.Email = "test@example.com"
	}
	return u
}

func TestGetProducts_StripeNotConfigured(t *testing.T) {
	resetPaymentProductsCache(t)
	withStripeClient(t, nil, assert.AnError)
	h := newBillingAPITest(t, 1)

	w := h.request(http.MethodGet, "/api/v1/payments/products")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetProducts_Success(t *testing.T) {
	resetPaymentProductsCache(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	restore(t, &billing.BillingPlans)
	priceID := "price_pro"
	billing.BillingPlans = []billing.BillingPlanDefinition{{Plan: billing.PlanPro, StripePriceID: &priceID}}
	mockStripe.On("GetPrice", mock.Anything, "price_pro", mock.Anything).Return(&stripe.Price{
		ID:         "price_pro",
		UnitAmount: 1000,
		Currency:   stripe.CurrencyUSD,
		Product:    &stripe.Product{ID: "prod_1", Name: "Pro", Description: "Pro plan"},
	}, nil)

	w := h.request(http.MethodGet, "/api/v1/payments/products")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"products"`)
	assert.Contains(t, w.Body.String(), `"price_id":"price_pro"`)
	mockStripe.AssertExpectations(t)
}

func TestGetProducts_CachesStripePriceResponses(t *testing.T) {
	resetPaymentProductsCache(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	restore(t, &billing.BillingPlans)
	priceID := "price_cached"
	billing.BillingPlans = []billing.BillingPlanDefinition{{Plan: billing.PlanPro, StripePriceID: &priceID}}
	mockStripe.On("GetPrice", mock.Anything, priceID, mock.Anything).Return(&stripe.Price{
		ID:         priceID,
		UnitAmount: 1000,
		Currency:   stripe.CurrencyUSD,
		Product:    &stripe.Product{ID: "prod_1", Name: "Pro", Description: "Pro plan"},
	}, nil).Once()

	first := h.request(http.MethodGet, "/api/v1/payments/products")
	second := h.request(http.MethodGet, "/api/v1/payments/products")

	assert.Equal(t, http.StatusOK, first.Code)
	assert.Equal(t, http.StatusOK, second.Code)
	mockStripe.AssertExpectations(t)
}

func TestGetProducts_PriceFetchFailureReturnsError(t *testing.T) {
	resetPaymentProductsCache(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	restore(t, &billing.BillingPlans)
	priceID := "price_missing"
	billing.BillingPlans = []billing.BillingPlanDefinition{{Plan: billing.PlanPro, StripePriceID: &priceID}}
	mockStripe.On("GetPrice", mock.Anything, "price_missing", mock.Anything).Return((*stripe.Price)(nil), assert.AnError)

	w := h.request(http.MethodGet, "/api/v1/payments/products")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	mockStripe.AssertExpectations(t)
}

func TestGetSubscription_UserNotFound(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	dbMock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnError(pgx.ErrNoRows)

	w := h.request(http.MethodGet, "/api/v1/payments")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"subscription":null`)
}

func TestGetSubscription_Success(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	subID := "sub_123"
	status := "active"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{
			SubscriptionID:     &subID,
			SubscriptionStatus: &status,
		},
	})

	w := h.request(http.MethodGet, "/api/v1/payments")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"subscription_id":"sub_123"`)
}

func TestCreateSubscription_DatabaseUnavailable(t *testing.T) {
	withBillingQueriesError(t, assert.AnError)
	h := newBillingAPITest(t, 1)

	w := h.postJSON("/api/v1/payments/create-subscription", `{"price_id":"price_pro"}`)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestCreateSubscription_InvalidPriceSelection(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(billingAPIUser(dbtest.User{})))

	w := h.postJSON("/api/v1/payments/create-subscription", `{"price_id":"missing"}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateSubscription_Success(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	restore(t, &billing.BillingPlans)
	priceID := "price_pro"
	billing.BillingPlans[0].StripePriceID = &priceID

	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		m := new(syncStripeMock)
		m.On("GetOrCreateCustomer", mock.Anything, "1", "test@example.com", "").Return(&stripe.Customer{ID: "cus_123"}, nil)
		m.On("CreateCheckoutSession", mock.Anything, mock.MatchedBy(func(params *stripe.CheckoutSessionParams) bool {
			if params == nil || params.SubscriptionData == nil || params.SubscriptionData.Metadata == nil {
				return false
			}
			return params.SubscriptionData.Metadata["userId"] == "1" &&
				params.SubscriptionData.Metadata["email"] == "test@example.com" &&
				params.SubscriptionData.Metadata["plan"] == "pro" &&
				params.SubscriptionData.Metadata["customerId"] == "cus_123"
		})).Return(&stripe.CheckoutSession{
			URL:          "https://stripe.test/checkout",
			Subscription: &stripe.Subscription{ID: "sub_123"},
			Status:       stripe.CheckoutSessionStatusOpen,
		}, nil)
		return m, nil
	}

	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(billingAPIUser(dbtest.User{})))
	dbMock.ExpectExec("UPDATE users SET customer_id").
		WithArgs(int32(1), "cus_123").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	w := h.postJSON("/api/v1/payments/create-subscription", `{"price_id":"price_pro"}`)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"checkout_url":"https://stripe.test/checkout"`)
	assert.Contains(t, w.Body.String(), `"subscription_id":"sub_123"`)
}

func TestCreateSubscription_RejectsOpenSubscription(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	restore(t, &billing.BillingPlans)
	priceID := "price_super"
	billing.BillingPlans[1].StripePriceID = &priceID

	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		t.Fatal("create subscription should not create a Stripe client for an existing subscription")
		return nil, nil
	}

	subID := "sub_active"
	status := "trialing"
	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(billingAPIUser(dbtest.User{
			Billing: &dbtest.UserBilling{
				SubscriptionID:     &subID,
				SubscriptionStatus: &status,
			},
		})))

	w := h.postJSON("/api/v1/payments/create-subscription", `{"price_id":"price_super"}`)

	assert.Equal(t, http.StatusConflict, w.Code)
}

func TestCancelSubscription_NoSubscription(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	expectGetUserByID(dbMock, dbtest.User{})

	w := h.postJSON("/api/v1/payments/cancel-subscription", `{}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCancelSubscription_Success(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		m := new(syncStripeMock)
		m.On("UpdateSubscription", mock.Anything, "sub_123", mock.Anything).Return(&stripe.Subscription{Status: stripe.SubscriptionStatusActive}, nil)
		return m, nil
	}

	subID := "sub_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{SubscriptionID: &subID},
	})
	dbMock.ExpectExec("UPDATE users SET").
		WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	w := h.postJSON("/api/v1/payments/cancel-subscription", `{}`)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "Subscription set to cancel")
}

func TestCancelSubscription_RejectsNonStripeSubscription(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	subID := "sub_123"
	source := db.SubscriptionSourceAPPSTORE
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{
			SubscriptionID:     &subID,
			SubscriptionSource: &source,
		},
	})

	w := h.postJSON("/api/v1/payments/cancel-subscription", `{}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "only Stripe subscriptions can be cancelled")
}

func TestReactivateSubscription_NotScheduled(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	subID := "sub_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{SubscriptionID: &subID},
	})

	w := h.postJSON("/api/v1/payments/reactivate-subscription", `{}`)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestValidateSubscriptionCancellationChange_RejectsNonStripeReactivation(t *testing.T) {
	subID := "sub_123"
	source := billing.SourceAppStore

	err := validateSubscriptionCancellationChange(&billing.PaymentsAccountUser{
		SubscriptionID:     &subID,
		SubscriptionSource: &source,
		CancelAtPeriodEnd:  true,
	}, false)

	assert.EqualError(t, err, "only Stripe subscriptions can be reactivated via this endpoint")
}

func TestCreatePortalSession_DatabaseUnavailable(t *testing.T) {
	withBillingQueriesError(t, assert.AnError)
	h := newBillingAPITest(t, 1)
	w := h.request(http.MethodPost, "/api/v1/billing/portal")

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestCreatePortalSession_NoCustomer(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	expectGetUserByID(dbMock, dbtest.User{})

	w := h.request(http.MethodPost, "/api/v1/billing/portal")

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreatePortalSession_StripeError(t *testing.T) {
	dbMock := newBillingDBMock(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	mockStripe.On("CreateCustomerPortalSession", mock.Anything, customerID, mock.Anything).Return("", assert.AnError)

	w := h.request(http.MethodPost, "/api/v1/billing/portal")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCreatePortalSession_StripeNotConfigured(t *testing.T) {
	dbMock := newBillingDBMock(t)
	withStripeClient(t, nil, assert.AnError)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	w := h.request(http.MethodPost, "/api/v1/billing/portal")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCreatePortalSession_Success(t *testing.T) {
	dbMock := newBillingDBMock(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	mockStripe.On("CreateCustomerPortalSession", mock.Anything, customerID, mock.Anything).Return("https://stripe.com/portal", nil)

	w := h.request(http.MethodPost, "/api/v1/billing/portal")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "https://stripe.com/portal")
}

func TestCreatePortalSession_UsesBillingReturnPathForSiteURL(t *testing.T) {
	dbMock := newBillingDBMock(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)
	t.Setenv("SITE_URL", "https://console.example.com")

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	mockStripe.On("CreateCustomerPortalSession", mock.Anything, customerID, "https://console.example.com/billing").Return("https://stripe.com/portal", nil)

	w := h.request(http.MethodPost, "/api/v1/billing/portal")

	assert.Equal(t, http.StatusOK, w.Code)
	mockStripe.AssertExpectations(t)
}

func TestCreatePortalSession_UserIDTooLarge(t *testing.T) {
	withEmptyBillingQueries(t)
	h := newBillingAPITest(t, math.MaxInt32+1)
	w := h.request(http.MethodPost, "/api/v1/billing/portal")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetBillingBalance_DatabaseUnavailable(t *testing.T) {
	withBillingQueriesError(t, assert.AnError)
	h := newBillingAPITest(t, 1)
	w := h.request(http.MethodGet, "/api/v1/billing/balance")

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestGetBillingBalance_FindUserError(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	dbMock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnError(assert.AnError)

	w := h.request(http.MethodGet, "/api/v1/billing/balance")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetBillingBalance_Success(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	expectGetUserByID(dbMock, dbtest.User{})

	w := h.request(http.MethodGet, "/api/v1/billing/balance")

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetBillingBalance_UserIDTooLarge(t *testing.T) {
	withEmptyBillingQueries(t)
	h := newBillingAPITest(t, math.MaxInt32+1)
	w := h.request(http.MethodGet, "/api/v1/billing/balance")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetBillingBalance_UserNotFound(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	dbMock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnError(pgx.ErrNoRows)

	w := h.request(http.MethodGet, "/api/v1/billing/balance")

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestGetBillingBalance_WithAutoRechargeFields(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	now := pgtype.Timestamp{Time: time.Now(), Valid: true}
	end := pgtype.Timestamp{Time: time.Now().Add(24 * time.Hour), Valid: true}

	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{
			CurrentPeriodStart:    now,
			CurrentPeriodEnd:      end,
			CreditBalance:         pgtype.Numeric{Int: big.NewInt(2500), Exp: -2, Valid: true},
			AutoRechargeEnabled:   true,
			AutoRechargeAmount:    pgtype.Numeric{Int: big.NewInt(1000), Exp: -2, Valid: true},
			AutoRechargeThreshold: pgtype.Numeric{Int: big.NewInt(500), Exp: -2, Valid: true},
		},
	})

	w := h.request(http.MethodGet, "/api/v1/billing/balance")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"credit_balance":25`)
	assert.Contains(t, w.Body.String(), `"auto_recharge_enabled":true`)
}

func TestGetInvoices_DatabaseUnavailable(t *testing.T) {
	withBillingQueriesError(t, assert.AnError)
	h := newBillingAPITest(t, 1)
	w := h.request(http.MethodGet, "/api/v1/billing/invoices")

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestGetInvoices_ListError(t *testing.T) {
	dbMock := newBillingDBMock(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	mockStripe.On("ListInvoices", mock.Anything, customerID).Return(([]*stripe.Invoice)(nil), assert.AnError)

	w := h.request(http.MethodGet, "/api/v1/billing/invoices")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetInvoices_NoCustomerID(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	expectGetUserByID(dbMock, dbtest.User{})

	w := h.request(http.MethodGet, "/api/v1/billing/invoices")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

func TestGetInvoices_StripeNotConfigured(t *testing.T) {
	dbMock := newBillingDBMock(t)
	withStripeClient(t, nil, assert.AnError)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	w := h.request(http.MethodGet, "/api/v1/billing/invoices")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetInvoices_Success(t *testing.T) {
	dbMock := newBillingDBMock(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	mockStripe.On("ListInvoices", mock.Anything, customerID).Return([]*stripe.Invoice{
		{
			ID:               "inv_123",
			Number:           "INV-123",
			AmountPaid:       2999,
			Currency:         stripe.CurrencyUSD,
			Status:           stripe.InvoiceStatusPaid,
			Created:          1700000000,
			InvoicePDF:       "https://stripe.com/pdf",
			HostedInvoiceURL: "https://stripe.com/hosted",
		},
	}, nil)

	w := h.request(http.MethodGet, "/api/v1/billing/invoices")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "inv_123")
}

func TestGetInvoices_ZeroDecimalCurrency(t *testing.T) {
	dbMock := newBillingDBMock(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	mockStripe.On("ListInvoices", mock.Anything, customerID).Return([]*stripe.Invoice{
		{
			ID:         "inv_jpy",
			AmountPaid: 500,
			Currency:   stripe.CurrencyJPY,
			Status:     stripe.InvoiceStatusPaid,
			Created:    1700000000,
		},
	}, nil)

	w := h.request(http.MethodGet, "/api/v1/billing/invoices")

	assert.Equal(t, http.StatusOK, w.Code)

	var got []InvoiceResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	if assert.Len(t, got, 1) {
		assert.Equal(t, 500.0, got[0].AmountPaid)
	}
}

func TestGetPaidPlans_IncludesConfiguredSuperPlan(t *testing.T) {
	restore(t, &billing.BillingPlans)
	proPriceID := " price_pro "
	superPriceID := " price_super "
	billing.BillingPlans = []billing.BillingPlanDefinition{
		{Plan: billing.PlanFree},
		{Plan: billing.PlanPro, StripePriceID: &proPriceID},
		{Plan: billing.PlanSuper, StripePriceID: &superPriceID},
	}

	assert.Equal(t, []paidPlan{
		{Plan: "pro", PriceID: "price_pro"},
		{Plan: "super", PriceID: "price_super"},
	}, getPaidPlans())
}

func TestValidateAutoRechargeRequest_Branches(t *testing.T) {
	disabled := false
	enabled := true
	amount := 10.0
	invalidAmount := math.Inf(1)
	invalidThreshold := math.NaN()

	require.Error(t, validateAutoRechargeRequest(AutoRechargeRequest{}))
	require.NoError(t, validateAutoRechargeRequest(AutoRechargeRequest{Enabled: &disabled}))
	require.Error(t, validateAutoRechargeRequest(AutoRechargeRequest{Enabled: &enabled, Amount: &invalidAmount, Threshold: &amount}))
	require.Error(t, validateAutoRechargeRequest(AutoRechargeRequest{Enabled: &enabled, Amount: &amount, Threshold: &invalidThreshold}))
}

func TestGetProducts_MissingExpandedProductReturnsError(t *testing.T) {
	resetPaymentProductsCache(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	restore(t, &billing.BillingPlans)
	priceID := "price_without_product"
	billing.BillingPlans = []billing.BillingPlanDefinition{{Plan: billing.PlanPro, StripePriceID: &priceID}}
	mockStripe.On("GetPrice", mock.Anything, "price_without_product", mock.Anything).Return(&stripe.Price{
		ID:         "price_without_product",
		UnitAmount: 1000,
		Currency:   stripe.CurrencyUSD,
	}, nil)

	w := h.request(http.MethodGet, "/api/v1/payments/products")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	mockStripe.AssertExpectations(t)
}

func TestSubscriptionRoute_DatabaseUnavailableBranches(t *testing.T) {
	withBillingQueriesError(t, assert.AnError)
	h := newBillingAPITest(t, 1)

	assert.Equal(t, http.StatusServiceUnavailable, h.postJSON("/api/v1/payments/cancel-subscription", `{}`).Code)
	assert.Equal(t, http.StatusServiceUnavailable, h.postJSON("/api/v1/payments/reactivate-subscription", `{}`).Code)
	assert.Equal(t, http.StatusServiceUnavailable, h.request(http.MethodGet, "/api/v1/payments").Code)
}

func TestReactivateSubscription_Success(t *testing.T) {
	mockRepo := new(mockPaymentsRepo)

	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		m := new(syncStripeMock)
		m.On("UpdateSubscription", mock.Anything, "sub_123", mock.MatchedBy(func(params *stripe.SubscriptionParams) bool {
			return params != nil && params.CancelAtPeriodEnd != nil && !*params.CancelAtPeriodEnd
		})).Return(&stripe.Subscription{Status: stripe.SubscriptionStatusActive}, nil)
		return m, nil
	}

	subID := "sub_123"
	mockRepo.On("FindUserByID", mock.Anything, 1).Return(&billing.PaymentsAccountUser{
		ID:                1,
		SubscriptionID:    &subID,
		CancelAtPeriodEnd: true,
	}, nil).Once()
	mockRepo.On("UpdateSubscription", mock.Anything, 1, mock.Anything).Return(nil).Once()

	err := changeSubscriptionCancellation(context.Background(), mockRepo, 1, false, "ReactivateSub")

	require.NoError(t, err)
	mockRepo.AssertExpectations(t)
}

func TestReactivateSubscriptionRoute_Success(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	restore(t, &NewStripeClient)
	NewStripeClient = func() (StripeCustomerClient, error) {
		m := new(syncStripeMock)
		m.On("UpdateSubscription", mock.Anything, "sub_123", mock.MatchedBy(func(params *stripe.SubscriptionParams) bool {
			return params != nil && params.CancelAtPeriodEnd != nil && !*params.CancelAtPeriodEnd
		})).Return(&stripe.Subscription{Status: stripe.SubscriptionStatusActive}, nil)
		return m, nil
	}

	subID := "sub_123"
	dbMock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnRows(userRowWithCancelAtPeriodEnd(dbtest.User{
			Billing: &dbtest.UserBilling{SubscriptionID: &subID},
		}, true))
	dbMock.ExpectExec("UPDATE users SET").
		WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	w := h.postJSON("/api/v1/payments/reactivate-subscription", `{}`)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "Subscription reactivated")
}

func userRowWithCancelAtPeriodEnd(u dbtest.User, cancelAtPeriodEnd bool) *pgxmock.Rows {
	values := dbtest.UserValues(billingAPIUser(u))
	values[26] = cancelAtPeriodEnd
	return pgxmock.NewRows(dbtest.UserColumns()).AddRow(values...)
}

func TestGetSubscription_ErrorBranches(t *testing.T) {
	withEmptyBillingQueries(t)
	assert.Equal(t, http.StatusInternalServerError, newBillingAPITest(t, math.MaxInt32+1).request(http.MethodGet, "/api/v1/payments").Code)

	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)
	dbMock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnError(assert.AnError)

	w := h.request(http.MethodGet, "/api/v1/payments")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCreateSubscription_ErrorBranches(t *testing.T) {
	ctx := context.Background()
	restore(t, &billing.BillingPlans)
	priceID := "price_pro"
	billing.BillingPlans = []billing.BillingPlanDefinition{{Plan: billing.PlanPro, StripePriceID: &priceID}}

	t.Run("blank price", func(t *testing.T) {
		_, err := createSubscription(ctx, new(mockPaymentsRepo), "test@example.com", CreateSubscriptionRequest{}, "")
		require.Error(t, err)
	})

	t.Run("missing user", func(t *testing.T) {
		mockRepo := new(mockPaymentsRepo)
		mockRepo.On("FindUserByEmail", mock.Anything, "missing@example.com").Return(nil, billing.ErrBillingUserNotFound).Once()

		_, err := createSubscription(ctx, mockRepo, "missing@example.com", CreateSubscriptionRequest{PriceID: priceID}, "")

		require.Error(t, err)
		mockRepo.AssertExpectations(t)
	})

	t.Run("lookup database error", func(t *testing.T) {
		mockRepo := new(mockPaymentsRepo)
		mockRepo.On("FindUserByEmail", mock.Anything, "error@example.com").Return(nil, assert.AnError).Once()

		_, err := createSubscription(ctx, mockRepo, "error@example.com", CreateSubscriptionRequest{PriceID: priceID}, "")

		require.Error(t, err)
		var statusErr interface{ GetStatus() int }
		require.ErrorAs(t, err, &statusErr)
		assert.Equal(t, http.StatusInternalServerError, statusErr.GetStatus())
		mockRepo.AssertExpectations(t)
	})

	t.Run("disabled user", func(t *testing.T) {
		mockRepo := new(mockPaymentsRepo)
		mockRepo.On("FindUserByEmail", mock.Anything, "disabled@example.com").Return(&billing.PaymentsAccountUser{
			ID:       1,
			Email:    "disabled@example.com",
			Disabled: true,
		}, nil).Once()

		_, err := createSubscription(ctx, mockRepo, "disabled@example.com", CreateSubscriptionRequest{PriceID: priceID}, "")

		require.Error(t, err)
		mockRepo.AssertExpectations(t)
	})

	t.Run("stripe not configured", func(t *testing.T) {
		mockRepo := new(mockPaymentsRepo)
		mockRepo.On("FindUserByEmail", mock.Anything, "test@example.com").Return(&billing.PaymentsAccountUser{ID: 1, Email: "test@example.com"}, nil).Once()
		restore(t, &NewStripeClient)
		NewStripeClient = func() (StripeCustomerClient, error) {
			return nil, assert.AnError
		}

		_, err := createSubscription(ctx, mockRepo, "test@example.com", CreateSubscriptionRequest{PriceID: priceID}, "")

		require.Error(t, err)
		mockRepo.AssertExpectations(t)
	})

	t.Run("customer lookup error", func(t *testing.T) {
		mockRepo := new(mockPaymentsRepo)
		mockRepo.On("FindUserByEmail", mock.Anything, "test@example.com").Return(&billing.PaymentsAccountUser{ID: 1, Email: "test@example.com"}, nil).Once()
		restore(t, &NewStripeClient)
		NewStripeClient = func() (StripeCustomerClient, error) {
			m := new(syncStripeMock)
			m.On("GetOrCreateCustomer", mock.Anything, "1", "test@example.com", "").Return(nil, assert.AnError).Once()
			return m, nil
		}

		_, err := createSubscription(ctx, mockRepo, "test@example.com", CreateSubscriptionRequest{PriceID: priceID}, "")

		require.Error(t, err)
		mockRepo.AssertExpectations(t)
	})

	t.Run("checkout session error", func(t *testing.T) {
		mockRepo := new(mockPaymentsRepo)
		mockRepo.On("FindUserByEmail", mock.Anything, "test@example.com").Return(&billing.PaymentsAccountUser{ID: 1, Email: "test@example.com"}, nil).Once()
		restore(t, &NewStripeClient)
		NewStripeClient = func() (StripeCustomerClient, error) {
			m := new(syncStripeMock)
			m.On("GetOrCreateCustomer", mock.Anything, "1", "test@example.com", "").Return(&stripe.Customer{ID: "cus_123"}, nil).Once()
			m.On("CreateCheckoutSession", mock.Anything, mock.Anything).Return(nil, assert.AnError).Once()
			return m, nil
		}

		_, err := createSubscription(ctx, mockRepo, "test@example.com", CreateSubscriptionRequest{PriceID: priceID}, "")

		require.Error(t, err)
		mockRepo.AssertExpectations(t)
	})
}

func TestChangeSubscriptionCancellation_ErrorBranches(t *testing.T) {
	ctx := context.Background()
	subID := "sub_123"

	t.Run("load error", func(t *testing.T) {
		mockRepo := new(mockPaymentsRepo)
		mockRepo.On("FindUserByID", mock.Anything, 1).Return(nil, assert.AnError).Once()

		err := changeSubscriptionCancellation(ctx, mockRepo, 1, true, "CancelSub")

		require.Error(t, err)
		mockRepo.AssertExpectations(t)
	})

	t.Run("stripe not configured", func(t *testing.T) {
		mockRepo := new(mockPaymentsRepo)
		mockRepo.On("FindUserByID", mock.Anything, 1).Return(&billing.PaymentsAccountUser{ID: 1, SubscriptionID: &subID}, nil).Once()
		restore(t, &NewStripeClient)
		NewStripeClient = func() (StripeCustomerClient, error) {
			return nil, assert.AnError
		}

		err := changeSubscriptionCancellation(ctx, mockRepo, 1, true, "CancelSub")

		require.Error(t, err)
		mockRepo.AssertExpectations(t)
	})

	t.Run("stripe update error", func(t *testing.T) {
		mockRepo := new(mockPaymentsRepo)
		mockRepo.On("FindUserByID", mock.Anything, 1).Return(&billing.PaymentsAccountUser{ID: 1, SubscriptionID: &subID}, nil).Once()
		restore(t, &NewStripeClient)
		NewStripeClient = func() (StripeCustomerClient, error) {
			m := new(syncStripeMock)
			m.On("UpdateSubscription", mock.Anything, subID, mock.Anything).Return(nil, assert.AnError).Once()
			return m, nil
		}

		err := changeSubscriptionCancellation(ctx, mockRepo, 1, true, "CancelSub")

		require.Error(t, err)
		mockRepo.AssertExpectations(t)
	})
}

func TestLoadBillingUserHelpers_ErrorBranches(t *testing.T) {
	ctx := context.Background()

	_, err := loadBillingUserByID(ctx, new(mockPaymentsRepo), math.MaxInt32+1)
	require.Error(t, err)

	mockRepo := new(mockPaymentsRepo)
	mockRepo.On("FindUserByID", mock.Anything, 1).Return(nil, assert.AnError).Once()
	_, err = loadBillingUserByID(ctx, mockRepo, 1)
	require.Error(t, err)
	mockRepo.AssertExpectations(t)

	mockRepo = new(mockPaymentsRepo)
	mockRepo.On("FindUserByID", mock.Anything, 1).Return(nil, billing.ErrBillingUserNotFound).Once()
	_, err = loadBillingUserByID(ctx, mockRepo, 1)
	require.Error(t, err)
	mockRepo.AssertExpectations(t)

	_, err = loadBillingUserByEmail(ctx, new(mockPaymentsRepo), " ")
	require.Error(t, err)

	mockRepo = new(mockPaymentsRepo)
	mockRepo.On("FindUserByEmail", mock.Anything, "error@example.com").Return(nil, assert.AnError).Once()
	_, err = loadBillingUserByEmail(ctx, mockRepo, "error@example.com")
	require.Error(t, err)
	mockRepo.AssertExpectations(t)

	mockRepo = new(mockPaymentsRepo)
	mockRepo.On("FindUserByEmail", mock.Anything, "norows@example.com").Return(nil, pgx.ErrNoRows).Once()
	_, err = loadBillingUserByEmail(ctx, mockRepo, "norows@example.com")
	require.Error(t, err)
	mockRepo.AssertExpectations(t)

	mockRepo = new(mockPaymentsRepo)
	mockRepo.On("FindUserByEmail", mock.Anything, "missing@example.com").Return(nil, billing.ErrBillingUserNotFound).Once()
	_, err = loadBillingUserByEmail(ctx, mockRepo, "missing@example.com")
	require.Error(t, err)
	mockRepo.AssertExpectations(t)
}

func TestBillingPortalReturnURL_AppendsBillingWhenQueryPreventsOriginFastPath(t *testing.T) {
	t.Setenv("SITE_URL", "https://console.example.com?session=leak")

	assert.Equal(t, "https://console.example.com/billing", billingPortalReturnURL())
}
