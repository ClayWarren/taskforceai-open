package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	auth_pkg "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/billing-service/pkg/billing"
	auth_handler "github.com/TaskForceAI/billing-service/pkg/handler"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stripe/stripe-go/v82"
)

func TestCheckoutHandler_InvalidPlanRedirects(t *testing.T) {
	restore(t, &auth_handler.MarketingBaseURL)
	auth_handler.MarketingBaseURL = "https://marketing.example.com"

	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=invalid", nil)
	w := httptest.NewRecorder()

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusFound, w.Code)
	assert.Contains(t, w.Header().Get("Location"), "marketing.example.com")
}

func TestCheckoutHandler_MethodNotAllowed(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/checkout?plan=pro", nil)
	w := httptest.NewRecorder()

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusMethodNotAllowed, w.Code)
}

func TestCheckoutHandler_StripeClientError(t *testing.T) {
	dbMock := dbtest.NewMockPool(t)
	q := db.New(dbMock)

	restore(t, &auth_handler.GetQueries)
	auth_handler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}

	restore(t, &billing.BillingPlans)
	priceID := "price_pro"
	billing.BillingPlans[0].StripePriceID = &priceID

	restore(t, &auth_handler.NewStripeClient)
	auth_handler.NewStripeClient = func() (auth_handler.StripeCustomerClient, error) {
		return nil, assert.AnError
	}

	user := &auth_pkg.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)
	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=pro", nil).WithContext(ctx)
	w := httptest.NewRecorder()

	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(paymentsUser(dbtest.User{})))

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusFound, w.Code)
	assert.Contains(t, w.Header().Get("Location"), "error=config")
}

func TestCheckoutHandler_Success(t *testing.T) {
	dbMock := dbtest.NewMockPoolRegexp(t)
	q := db.New(dbMock)

	restore(t, &auth_handler.GetQueries)
	auth_handler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}

	restore(t, &billing.BillingPlans)
	priceID := "price_pro"
	billing.BillingPlans[0].StripePriceID = &priceID

	restore(t, &auth_handler.NewStripeClient)
	auth_handler.NewStripeClient = func() (auth_handler.StripeCustomerClient, error) {
		m := new(stripeCustomerClientMock)
		m.On("GetOrCreateCustomer", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(&stripe.Customer{ID: "cus_123"}, nil)
		m.On("CreateCheckoutSession", mock.Anything, mock.Anything).Return(&stripe.CheckoutSession{URL: "https://stripe.test/checkout"}, nil)
		return m, nil
	}

	user := &auth_pkg.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)
	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=pro", nil).WithContext(ctx)
	w := httptest.NewRecorder()

	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(paymentsUser(dbtest.User{})))

	dbMock.ExpectExec("UPDATE users SET customer_id").
		WithArgs(int32(1), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "https://stripe.test/checkout", w.Header().Get("Location"))
}

func TestCheckoutHandler_RejectsOpenSubscription(t *testing.T) {
	dbMock := dbtest.NewMockPoolRegexp(t)
	q := db.New(dbMock)

	restore(t, &auth_handler.GetQueries)
	auth_handler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}

	restore(t, &billing.BillingPlans)
	priceID := "price_pro"
	billing.BillingPlans[0].StripePriceID = &priceID

	restore(t, &auth_handler.NewStripeClient)
	auth_handler.NewStripeClient = func() (auth_handler.StripeCustomerClient, error) {
		t.Fatal("checkout should not create a Stripe client for an existing subscription")
		return nil, nil
	}

	user := &auth_pkg.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)
	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=super", nil).WithContext(ctx)
	w := httptest.NewRecorder()

	subID := "sub_active"
	status := "active"
	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(paymentsUser(dbtest.User{
			Billing: &dbtest.UserBilling{
				SubscriptionID:     &subID,
				SubscriptionStatus: &status,
			},
		})))

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusFound, w.Code)
	assert.Contains(t, w.Header().Get("Location"), "error=active_subscription")
}

func TestCheckoutHandler_UntrustedOriginUsesFallbackCheckoutURLs(t *testing.T) {
	dbMock := dbtest.NewMockPoolRegexp(t)
	q := db.New(dbMock)

	restore(t, &auth_handler.GetQueries)
	auth_handler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}

	restore(t, &billing.BillingPlans)
	priceID := "price_pro"
	billing.BillingPlans[0].StripePriceID = &priceID

	t.Setenv("CORS_ALLOWED_ORIGINS", "https://trusted.example.com")
	t.Setenv("NEXT_PUBLIC_SITE_URL", "https://trusted.example.com")

	restore(t, &auth_handler.NewStripeClient)
	auth_handler.NewStripeClient = func() (auth_handler.StripeCustomerClient, error) {
		m := new(stripeCustomerClientMock)
		m.On("GetOrCreateCustomer", mock.Anything, mock.Anything, mock.Anything, mock.Anything).
			Return(&stripe.Customer{ID: "cus_123"}, nil).
			Once()
		m.On("CreateCheckoutSession", mock.Anything, mock.MatchedBy(func(params *stripe.CheckoutSessionParams) bool {
			if params.SuccessURL == nil || params.CancelURL == nil {
				return false
			}

			expectedSuccess := "https://trusted.example.com/home?checkout=success&session_id={CHECKOUT_SESSION_ID}"
			expectedCancel := "https://trusted.example.com/pricing?checkout=cancelled"
			return *params.SuccessURL == expectedSuccess && *params.CancelURL == expectedCancel
		})).Return(&stripe.CheckoutSession{URL: "https://stripe.test/checkout"}, nil).Once()
		return m, nil
	}

	user := &auth_pkg.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)
	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=pro", nil).WithContext(ctx)
	req.Header.Set("Origin", "https://evil.example.com")
	w := httptest.NewRecorder()

	existingCustomerID := "cus_existing"
	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(paymentsUser(dbtest.User{
			Billing: &dbtest.UserBilling{CustomerID: &existingCustomerID},
		})))

	dbMock.ExpectExec("UPDATE users SET customer_id").
		WithArgs(int32(1), "cus_123").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "https://stripe.test/checkout", w.Header().Get("Location"))
}

func TestCheckoutHandler_UserNotAuthenticated(t *testing.T) {
	dbMock := dbtest.NewMockPool(t)
	q := db.New(dbMock)

	restore(t, &auth_handler.GetQueries)
	auth_handler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}

	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=pro", nil)
	w := httptest.NewRecorder()

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusFound, w.Code)
}
