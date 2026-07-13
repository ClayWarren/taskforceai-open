package handler

import (
	"math"
	"net/http"
	"strings"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stripe/stripe-go/v82"
)

func TestGetInvoices_UserIDTooLarge(t *testing.T) {
	withEmptyBillingQueries(t)
	h := newBillingAPITest(t, math.MaxInt32+1)
	w := h.request(http.MethodGet, "/api/v1/billing/invoices")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetPaymentMethods_DatabaseUnavailable(t *testing.T) {
	withBillingQueriesError(t, assert.AnError)
	h := newBillingAPITest(t, 1)
	w := h.request(http.MethodGet, "/api/v1/billing/payment-methods")

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestGetPaymentMethods_ListError(t *testing.T) {
	dbMock := newBillingDBMock(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	mockStripe.On("ListPaymentMethods", mock.Anything, customerID).Return(([]*stripe.PaymentMethod)(nil), assert.AnError)

	w := h.request(http.MethodGet, "/api/v1/billing/payment-methods")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetPaymentMethods_NoCustomerID(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	expectGetUserByID(dbMock, dbtest.User{})

	w := h.request(http.MethodGet, "/api/v1/billing/payment-methods")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "[]")
}

func TestGetPaymentMethods_SkipsNonCardMethods(t *testing.T) {
	dbMock := newBillingDBMock(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	mockStripe.On("ListPaymentMethods", mock.Anything, customerID).Return([]*stripe.PaymentMethod{
		{ID: "pm_no_card"},
		{
			ID: "pm_123",
			Card: &stripe.PaymentMethodCard{
				Brand:    stripe.PaymentMethodCardBrandVisa,
				Last4:    "4242",
				ExpMonth: 12,
				ExpYear:  2025,
			},
		},
	}, nil)

	w := h.request(http.MethodGet, "/api/v1/billing/payment-methods")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "pm_123")
	assert.NotContains(t, w.Body.String(), "pm_no_card")
}

func TestGetPaymentMethods_StripeClientError(t *testing.T) {
	dbMock := newBillingDBMock(t)
	withStripeClient(t, nil, assert.AnError)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	w := h.request(http.MethodGet, "/api/v1/billing/payment-methods")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetPaymentMethods_Success(t *testing.T) {
	dbMock := newBillingDBMock(t)
	mockStripe := newBillingStripeMock(t)
	h := newBillingAPITest(t, 1)

	customerID := "cus_123"
	expectGetUserByID(dbMock, dbtest.User{
		Billing: &dbtest.UserBilling{CustomerID: &customerID},
	})

	mockStripe.On("ListPaymentMethods", mock.Anything, customerID).Return([]*stripe.PaymentMethod{
		{
			ID: "pm_123",
			Card: &stripe.PaymentMethodCard{
				Brand:    stripe.PaymentMethodCardBrandVisa,
				Last4:    "4242",
				ExpMonth: 12,
				ExpYear:  2025,
			},
		},
	}, nil)

	w := h.request(http.MethodGet, "/api/v1/billing/payment-methods")

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "pm_123")
}

func TestGetPaymentMethods_UserIDTooLarge(t *testing.T) {
	withEmptyBillingQueries(t)
	h := newBillingAPITest(t, math.MaxInt32+1)
	w := h.request(http.MethodGet, "/api/v1/billing/payment-methods")

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestNewStripeClientWrapper(t *testing.T) {
	t.Setenv("STRIPE_SECRET_KEY", "")
	_, err := newStripeClient()
	assert.Error(t, err)
}

func TestUpdateAutoRecharge_DatabaseUnavailable(t *testing.T) {
	withBillingQueriesError(t, assert.AnError)
	h := newBillingAPITest(t, 1)
	w := h.postAutoRecharge(strings.NewReader(`{"enabled": false}`))

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
}

func TestUpdateAutoRecharge_EnabledRequiresAmountAndThreshold(t *testing.T) {
	newBillingDBMock(t)
	h := newBillingAPITest(t, 1)
	w := h.postAutoRecharge(strings.NewReader(`{"enabled": true}`))

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUpdateAutoRecharge_InvalidRequest(t *testing.T) {
	newBillingDBMock(t)
	h := newBillingAPITest(t, 1)
	w := h.postAutoRecharge(strings.NewReader(`{}`))

	assert.Equal(t, http.StatusUnprocessableEntity, w.Code)
}

func TestUpdateAutoRecharge_RejectsInvalidAmounts(t *testing.T) {
	newBillingDBMock(t)
	h := newBillingAPITest(t, 1)
	w := h.postAutoRecharge(strings.NewReader(`{"enabled": true, "amount": 5, "threshold": 5}`))

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUpdateAutoRecharge_RejectsAmountAboveCap(t *testing.T) {
	newBillingDBMock(t)
	h := newBillingAPITest(t, 1)
	w := h.postAutoRecharge(strings.NewReader(`{"enabled": true, "amount": 1000000000000, "threshold": 5}`))

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUpdateAutoRecharge_EnableReturnsNotImplemented(t *testing.T) {
	newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	w := h.postAutoRecharge(strings.NewReader(`{"enabled": true, "amount": 10.0, "threshold": 5.0}`))

	assert.Equal(t, http.StatusNotImplemented, w.Code)
}

func TestUpdateAutoRecharge_ReloadFailsAfterUpdate(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	dbMock.ExpectExec("UPDATE users SET auto_recharge_enabled").
		WithArgs(int32(1), false, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	dbMock.ExpectQuery("SELECT .* FROM users WHERE id =").
		WithArgs(int32(1)).
		WillReturnError(assert.AnError)

	w := h.postAutoRecharge(strings.NewReader(`{"enabled": false}`))

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestUpdateAutoRecharge_Success(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	dbMock.ExpectExec("UPDATE users SET auto_recharge_enabled").
		WithArgs(int32(1), false, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	expectGetUserByID(dbMock, dbtest.User{})

	body := `{"enabled": false}`
	w := h.postAutoRecharge(strings.NewReader(body))

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestUpdateAutoRecharge_UpdateError(t *testing.T) {
	dbMock := newBillingDBMock(t)
	h := newBillingAPITest(t, 1)

	dbMock.ExpectExec("UPDATE users SET auto_recharge_enabled").
		WithArgs(int32(1), false, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(assert.AnError)

	w := h.postAutoRecharge(strings.NewReader(`{"enabled": false}`))

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestUpdateAutoRecharge_UserIDTooLarge(t *testing.T) {
	withEmptyBillingQueries(t)
	h := newBillingAPITest(t, math.MaxInt32+1)
	w := h.postAutoRecharge(strings.NewReader(`{"enabled": false}`))

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
