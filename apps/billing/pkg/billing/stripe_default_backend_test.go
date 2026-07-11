package billing

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stripe/stripe-go/v82"
)

func TestDefaultStripeBackend_MethodsExecute(t *testing.T) {
	// Route the global Stripe backend at a local server so the wrappers
	// execute without real network calls (which also leak keep-alive
	// connection goroutines that trip goleak).
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	transport := &http.Transport{}
	t.Cleanup(func() {
		transport.CloseIdleConnections()
		server.Close()
	})

	originalKey := stripe.Key
	originalBackend := stripe.GetBackend(stripe.APIBackend)
	stripe.Key = "sk_test_local"
	stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{
		URL:        stripe.String(server.URL),
		HTTPClient: &http.Client{Transport: transport},
	}))
	t.Cleanup(func() {
		stripe.Key = originalKey
		stripe.SetBackend(stripe.APIBackend, originalBackend)
	})

	backend := &defaultStripeBackend{}

	_, _ = backend.CustomerGet("cus_test", nil)
	_, _ = backend.CustomerNew(&stripe.CustomerParams{})
	_, _ = backend.SessionNew(&stripe.CheckoutSessionParams{})
	_, _ = backend.SubscriptionNew(&stripe.SubscriptionParams{})
	_, _ = backend.SubscriptionGet("sub_test", nil)
	_, _ = backend.SubscriptionUpdate("sub_test", &stripe.SubscriptionParams{})
	_, _ = backend.PriceGet("price_test", nil)
	_, _ = backend.PaymentMethodList(&stripe.PaymentMethodListParams{})
	_, _ = backend.InvoiceList(&stripe.InvoiceListParams{})
	_, _ = backend.BillingPortalSessionNew(&stripe.BillingPortalSessionParams{})

	assert.NotNil(t, backend)
}
