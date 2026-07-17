package billing

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestDefaultStripeBackend_ListMethodsFollowPagination(t *testing.T) {
	var mu sync.Mutex
	calls := map[string]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls[r.URL.Path]++
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		startingAfter := r.URL.Query().Get("starting_after")
		switch r.URL.Path {
		case "/v1/payment_methods":
			if startingAfter == "pm_1" {
				_, _ = fmt.Fprint(w, `{"object":"list","data":[{"id":"pm_2","object":"payment_method"}],"has_more":false,"url":"/v1/payment_methods"}`)
				return
			}
			_, _ = fmt.Fprint(w, `{"object":"list","data":[{"id":"pm_1","object":"payment_method"}],"has_more":true,"url":"/v1/payment_methods"}`)
		case "/v1/invoices":
			if startingAfter == "inv_1" {
				_, _ = fmt.Fprint(w, `{"object":"list","data":[{"id":"inv_2","object":"invoice"}],"has_more":false,"url":"/v1/invoices"}`)
				return
			}
			_, _ = fmt.Fprint(w, `{"object":"list","data":[{"id":"inv_1","object":"invoice"}],"has_more":true,"url":"/v1/invoices"}`)
		default:
			http.NotFound(w, r)
		}
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
	methods, err := backend.PaymentMethodList(&stripe.PaymentMethodListParams{})
	require.NoError(t, err)
	assert.Equal(t, []string{"pm_1", "pm_2"}, []string{methods[0].ID, methods[1].ID})

	invoices, err := backend.InvoiceList(&stripe.InvoiceListParams{})
	require.NoError(t, err)
	assert.Equal(t, []string{"inv_1", "inv_2"}, []string{invoices[0].ID, invoices[1].ID})

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, 2, calls["/v1/payment_methods"])
	assert.Equal(t, 2, calls["/v1/invoices"])
}
