package handler_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
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

type stripeCustomerClientMock struct {
	mock.Mock
}

func mockResult[T any](ret mock.Arguments) (T, error) {
	value, _ := ret.Get(0).(T)
	return value, ret.Error(1)
}

func (m *stripeCustomerClientMock) GetOrCreateCustomer(ctx context.Context, userID, email, existingCustomerID string) (*stripe.Customer, error) {
	return mockResult[*stripe.Customer](m.Called(ctx, userID, email, existingCustomerID))
}

func (m *stripeCustomerClientMock) CreateCheckoutSession(ctx context.Context, params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
	return mockResult[*stripe.CheckoutSession](m.Called(ctx, params))
}

func (m *stripeCustomerClientMock) GetSubscription(ctx context.Context, id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	return mockResult[*stripe.Subscription](m.Called(ctx, id, params))
}

func (m *stripeCustomerClientMock) UpdateSubscription(ctx context.Context, id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	return mockResult[*stripe.Subscription](m.Called(ctx, id, params))
}

func paymentsUser(u dbtest.User) dbtest.User {
	u.Baseline = dbtest.BaselineBilling
	u.PaymentsStyle = true
	if u.ID == 0 {
		u.ID = 1
	}
	if u.Email == "" {
		u.Email = "test@example.com"
	}
	return u
}

func revenueCatSignature(payload []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

func TestVerifyRevenueCatSignature(t *testing.T) {
	payload := []byte(`{"app_user_id":"user-1"}`)
	secret := "webhook-secret"
	signature := revenueCatSignature(payload, secret)

	assert.True(t, auth_handler.VerifyRevenueCatSignature(payload, signature, secret))
	assert.False(t, auth_handler.VerifyRevenueCatSignature(payload, signature, "wrong-secret"))
	assert.False(t, auth_handler.VerifyRevenueCatSignature(payload, "not-hex", secret))
	assert.False(t, auth_handler.VerifyRevenueCatSignature(payload, "", secret))
	assert.False(t, auth_handler.VerifyRevenueCatSignature(payload, signature, ""))
}

func TestRevenueCatWebhookHandlerRejectsMissingOrInvalidAuthBeforeDatabase(t *testing.T) {
	restore(t, &auth_handler.GetQueries)
	auth_handler.GetQueries = func(context.Context) (*db.Queries, error) {
		t.Fatal("database should not be queried before RevenueCat auth succeeds")
		return nil, assert.AnError
	}
	t.Setenv("REVENUECAT_WEBHOOK_SECRET", "webhook-secret")

	for _, tt := range []struct {
		name   string
		header func(*http.Request)
	}{
		{name: "missing auth", header: func(*http.Request) {}},
		{name: "invalid bearer", header: func(r *http.Request) {
			r.Header.Set("Authorization", "Bearer wrong")
		}},
		{name: "invalid signature", header: func(r *http.Request) {
			r.Header.Set("X-RevenueCat-Signature", revenueCatSignature([]byte(`{"app_user_id":"other"}`), "webhook-secret"))
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/revenuecat", strings.NewReader(`{"app_user_id":"user-1"}`))
			tt.header(req)
			w := httptest.NewRecorder()

			auth_handler.RevenueCatWebhookHandler(w, req)

			assert.Equal(t, http.StatusUnauthorized, w.Code)
		})
	}
}

func TestCheckoutHandler_CheckoutSessionError(t *testing.T) {
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
		m := new(stripeCustomerClientMock)
		m.On("GetOrCreateCustomer", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(&stripe.Customer{ID: "cus_123"}, nil)
		m.On("CreateCheckoutSession", mock.Anything, mock.Anything).Return(nil, assert.AnError)
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
	assert.Contains(t, w.Header().Get("Location"), "error=checkout")
}

func TestCheckoutHandler_CrossSiteRequestRejected(t *testing.T) {
	dbMock := dbtest.NewMockPoolRegexp(t)
	q := db.New(dbMock)

	restore(t, &auth_handler.GetQueries)
	auth_handler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}

	user := &auth_pkg.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)
	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=pro", nil).WithContext(ctx)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	w := httptest.NewRecorder()

	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(paymentsUser(dbtest.User{})))

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusFound, w.Code)
	assert.Contains(t, w.Header().Get("Location"), "error=forbidden")
}

func TestCheckoutHandler_CustomerError(t *testing.T) {
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
		m := new(stripeCustomerClientMock)
		m.On("GetOrCreateCustomer", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil, assert.AnError)
		return m, nil
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
	assert.Contains(t, w.Header().Get("Location"), "error=customer")
}

func TestCheckoutHandler_DatabaseUnavailable(t *testing.T) {
	restore(t, &auth_handler.GetQueries)
	auth_handler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return nil, assert.AnError
	}

	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=pro", nil)
	w := httptest.NewRecorder()

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusFound, w.Code)
}

func TestCheckoutHandler_DisabledUser(t *testing.T) {
	dbMock := dbtest.NewMockPool(t)
	q := db.New(dbMock)

	restore(t, &auth_handler.GetQueries)
	auth_handler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}

	user := &auth_pkg.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)
	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=pro", nil).WithContext(ctx)
	w := httptest.NewRecorder()

	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(paymentsUser(dbtest.User{Disabled: true})))

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusFound, w.Code)
	assert.Contains(t, w.Header().Get("Location"), "error=disabled")
}

func TestCheckoutHandler_InvalidPlanDefinition(t *testing.T) {
	dbMock := dbtest.NewMockPool(t)
	q := db.New(dbMock)

	restore(t, &auth_handler.GetQueries)
	auth_handler.GetQueries = func(ctx context.Context) (*db.Queries, error) {
		return q, nil
	}

	restore(t, &billing.BillingPlans)
	billing.BillingPlans[0].StripePriceID = nil

	user := &auth_pkg.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), adapterhandler.UserContextKey, user)
	req := httptest.NewRequest(http.MethodGet, "/checkout?plan=pro", nil).WithContext(ctx)
	w := httptest.NewRecorder()

	dbMock.ExpectQuery("SELECT .* FROM users WHERE email =").
		WithArgs("test@example.com").
		WillReturnRows(dbtest.UserRow(paymentsUser(dbtest.User{})))

	auth_handler.CheckoutHandler(w, req)
	assert.Equal(t, http.StatusFound, w.Code)
	assert.Contains(t, w.Header().Get("Location"), "error=invalid_plan")
}
