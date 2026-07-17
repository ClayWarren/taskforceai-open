package billing

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/TaskForceAI/adapters/pkg/observability"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/circuitbreaker"
	"github.com/TaskForceAI/infrastructure/resilience/pkg/upstream"
	"github.com/stripe/stripe-go/v82"
	billingportalsession "github.com/stripe/stripe-go/v82/billingportal/session"
	"github.com/stripe/stripe-go/v82/checkout/session"
	"github.com/stripe/stripe-go/v82/customer"
	"github.com/stripe/stripe-go/v82/invoice"
	"github.com/stripe/stripe-go/v82/paymentmethod"
	"github.com/stripe/stripe-go/v82/price"
	"github.com/stripe/stripe-go/v82/subscription"
	"github.com/stripe/stripe-go/v82/webhook"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
)

type stripeBackend interface {
	CustomerGet(id string, params *stripe.CustomerParams) (*stripe.Customer, error)
	CustomerNew(params *stripe.CustomerParams) (*stripe.Customer, error)
	SessionNew(params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error)
	SubscriptionNew(params *stripe.SubscriptionParams) (*stripe.Subscription, error)
	SubscriptionGet(id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error)
	SubscriptionUpdate(id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error)
	PriceGet(id string, params *stripe.PriceParams) (*stripe.Price, error)
	PaymentMethodList(params *stripe.PaymentMethodListParams) ([]*stripe.PaymentMethod, error)
	InvoiceList(params *stripe.InvoiceListParams) ([]*stripe.Invoice, error)
	BillingPortalSessionNew(params *stripe.BillingPortalSessionParams) (*stripe.BillingPortalSession, error)
}

type defaultStripeBackend struct{}

func (d *defaultStripeBackend) CustomerGet(id string, params *stripe.CustomerParams) (*stripe.Customer, error) {
	return customer.Get(id, params)
}
func (d *defaultStripeBackend) CustomerNew(params *stripe.CustomerParams) (*stripe.Customer, error) {
	return customer.New(params)
}
func (d *defaultStripeBackend) SessionNew(params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
	return session.New(params)
}
func (d *defaultStripeBackend) SubscriptionNew(params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	return subscription.New(params)
}
func (d *defaultStripeBackend) SubscriptionGet(id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	return subscription.Get(id, params)
}
func (d *defaultStripeBackend) SubscriptionUpdate(id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	return subscription.Update(id, params)
}
func (d *defaultStripeBackend) PriceGet(id string, params *stripe.PriceParams) (*stripe.Price, error) {
	return price.Get(id, params)
}
func (d *defaultStripeBackend) PaymentMethodList(params *stripe.PaymentMethodListParams) ([]*stripe.PaymentMethod, error) {
	iter := paymentmethod.List(params)
	methods := make([]*stripe.PaymentMethod, 0)
	for iter.Next() {
		methods = append(methods, iter.PaymentMethod())
	}
	return methods, iter.Err()
}
func (d *defaultStripeBackend) InvoiceList(params *stripe.InvoiceListParams) ([]*stripe.Invoice, error) {
	iter := invoice.List(params)
	invoices := make([]*stripe.Invoice, 0)
	for iter.Next() {
		invoices = append(invoices, iter.Invoice())
	}
	return invoices, iter.Err()
}

// GetCustomer retrieves a Stripe customer with request-scoped cancellation.
func (s *StripeClient) GetCustomer(ctx context.Context, customerID string) (*stripe.Customer, error) {
	if strings.TrimSpace(customerID) == "" {
		return nil, fmt.Errorf("customer ID is required")
	}
	params := &stripe.CustomerParams{Params: stripe.Params{Context: ctx}}
	return cbCall(ctx, s.cb, "GetCustomer", []any{"customerID", customerID}, func() (*stripe.Customer, error) {
		return s.backend.CustomerGet(customerID, params)
	})
}
func (d *defaultStripeBackend) BillingPortalSessionNew(params *stripe.BillingPortalSessionParams) (*stripe.BillingPortalSession, error) {
	return billingportalsession.New(params)
}

// StripeClient wraps the Stripe client with our domain methods
type StripeClient struct {
	secretKey string
	cb        *circuitbreaker.CircuitBreaker
	backend   stripeBackend
}

var (
	stripeInstance *StripeClient
	stripeSecret   string
	stripeCB       *circuitbreaker.CircuitBreaker
	stripeMu       sync.Mutex
)

// isStripeTransientError returns true if the error is a transient Stripe error.
func isStripeTransientError(err error) bool {
	if err == nil {
		return false
	}
	if _, ok := errors.AsType[net.Error](err); ok {
		return true
	}
	if upstream.ErrorContainsAny(err, "timeout", "connection refused", "rate_limit", "500", "502", "503", "504") {
		return true
	}
	return false
}

func isStripeResourceMissingError(err error) bool {
	var stripeErr *stripe.Error
	return errors.As(err, &stripeErr) && stripeErr != nil && stripeErr.Code == stripe.ErrorCodeResourceMissing
}

// cbCall executes fn through the circuit breaker and normalizes errors.
// op is the method name used in log messages. logKV are optional slog key-value
// pairs appended to the error log line (e.g., "subscriptionId", id).
func cbCall[T any](ctx context.Context, cb *circuitbreaker.CircuitBreaker, op string, logKV []any, fn func() (T, error)) (T, error) {
	var result T
	var callErr error
	err := cb.Execute(ctx, func() error {
		r, e := fn()
		if e != nil {
			callErr = e
			return e
		}
		result = r
		return nil
	})
	if err != nil {
		var zero T
		if errors.Is(err, circuitbreaker.ErrCircuitOpen) {
			slog.Warn("Stripe circuit breaker is open", "op", op)
			return zero, fmt.Errorf("stripe service temporarily unavailable")
		}
		slog.Error("Stripe "+op+" failed", append([]any{"error", callErr}, logKV...)...)
		return zero, callErr
	}
	return result, nil
}

// NewStripeClient creates or returns the singleton Stripe client
func NewStripeClient() (*StripeClient, error) {
	secretKey := strings.TrimSpace(os.Getenv("STRIPE_SECRET_KEY"))
	if secretKey == "" {
		return nil, fmt.Errorf("STRIPE_SECRET_KEY is not set")
	}

	stripeMu.Lock()
	defer stripeMu.Unlock()

	// Reset singleton if secret changed (for testing)
	if stripeSecret != "" && stripeSecret != secretKey {
		stripeInstance = nil
	}

	if stripeInstance == nil {
		stripe.Key = secretKey

		// Initialize circuit breaker for Stripe API calls
		if stripeCB == nil {
			stripeCB = upstream.NewCircuitBreaker("billing_stripe", 60*time.Second, isStripeTransientError)
		}

		// Instrument Stripe with OTel
		stripe.SetHTTPClient(&http.Client{
			Transport: otelhttp.NewTransport(http.DefaultTransport),
			Timeout:   30 * time.Second,
		})

		stripeInstance = &StripeClient{
			secretKey: secretKey,
			cb:        stripeCB,
			backend:   &defaultStripeBackend{},
		}
		stripeSecret = secretKey
	}

	return stripeInstance, nil
}

// GetOrCreateCustomer retrieves or creates a Stripe customer
func (s *StripeClient) GetOrCreateCustomer(ctx context.Context, userID, email, existingCustomerID string) (*stripe.Customer, error) {
	ctx, span := startSpan(ctx, "stripe.GetOrCreateCustomer", attribute.String("user_id", userID))
	defer func() { observability.FinishSpan(span, nil) }()

	var result *stripe.Customer
	var resultErr error

	err := s.cb.Execute(ctx, func() error {
		// Try to retrieve existing customer
		if existingCustomerID != "" {
			cust, err := s.backend.CustomerGet(existingCustomerID, nil)
			if err == nil && cust != nil && !cust.Deleted {
				result = cust
				return nil
			}
			if err != nil && !isStripeResourceMissingError(err) {
				resultErr = fmt.Errorf("failed to retrieve customer: %w", err)
				return err
			}
			slog.Warn("Stripe customer missing or deleted, creating new", "customerId", existingCustomerID)
		}

		// Create new customer
		params := &stripe.CustomerParams{
			Params: stripe.Params{
				Context:        ctx,
				IdempotencyKey: stripe.String("billing-customer-" + userID),
				Metadata: map[string]string{
					"userId": userID,
				},
			},
		}
		if email != "" {
			params.Email = stripe.String(email)
		}

		cust, err := s.backend.CustomerNew(params)
		if err != nil {
			resultErr = fmt.Errorf("failed to create customer: %w", err)
			return err
		}

		slog.Info("Created new Stripe customer", "customerId", cust.ID, "userId", userID)
		result = cust
		return nil
	})

	if err != nil {
		if errors.Is(err, circuitbreaker.ErrCircuitOpen) {
			slog.Warn("Stripe circuit breaker is open, rejecting request")
			return nil, fmt.Errorf("stripe service temporarily unavailable")
		}
		return nil, resultErr
	}

	return result, nil
}

// CreateCheckoutSession creates a new Stripe checkout session
func (s *StripeClient) CreateCheckoutSession(ctx context.Context, params *stripe.CheckoutSessionParams) (*stripe.CheckoutSession, error) {
	ctx, span := startSpan(ctx, "stripe.CreateCheckoutSession")
	defer func() { observability.FinishSpan(span, nil) }()
	if params == nil {
		params = &stripe.CheckoutSessionParams{}
	}
	params.Context = ctx
	return cbCall(ctx, s.cb, "CreateCheckoutSession", nil, func() (*stripe.CheckoutSession, error) {
		return s.backend.SessionNew(params)
	})
}

// CreateCustomer creates a new Stripe customer
func (s *StripeClient) CreateCustomer(ctx context.Context, params *stripe.CustomerParams) (*stripe.Customer, error) {
	if params == nil {
		params = &stripe.CustomerParams{}
	}
	params.Context = ctx
	return cbCall(ctx, s.cb, "CreateCustomer", nil, func() (*stripe.Customer, error) {
		return s.backend.CustomerNew(params)
	})
}

// CreateSubscription creates a new Stripe subscription
func (s *StripeClient) CreateSubscription(ctx context.Context, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	if params == nil {
		params = &stripe.SubscriptionParams{}
	}
	params.Context = ctx
	return cbCall(ctx, s.cb, "CreateSubscription", nil, func() (*stripe.Subscription, error) {
		return s.backend.SubscriptionNew(params)
	})
}

// GetSubscription retrieves a Stripe subscription
func (s *StripeClient) GetSubscription(ctx context.Context, id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	if params != nil {
		params.Context = ctx
	}
	return cbCall(ctx, s.cb, "GetSubscription", []any{"subscriptionId", id}, func() (*stripe.Subscription, error) {
		return s.backend.SubscriptionGet(id, params)
	})
}

// UpdateSubscription updates a Stripe subscription
func (s *StripeClient) UpdateSubscription(ctx context.Context, id string, params *stripe.SubscriptionParams) (*stripe.Subscription, error) {
	if params == nil {
		params = &stripe.SubscriptionParams{}
	}
	params.Context = ctx
	return cbCall(ctx, s.cb, "UpdateSubscription", []any{"subscriptionId", id}, func() (*stripe.Subscription, error) {
		return s.backend.SubscriptionUpdate(id, params)
	})
}

// GetPrice retrieves a Stripe price
func (s *StripeClient) GetPrice(ctx context.Context, id string, params *stripe.PriceParams) (*stripe.Price, error) {
	if params != nil {
		params.Context = ctx
	}
	return cbCall(ctx, s.cb, "GetPrice", []any{"priceId", id}, func() (*stripe.Price, error) {
		return s.backend.PriceGet(id, params)
	})
}

// TimestampToDate converts a Unix timestamp to *time.Time
func TimestampToDate(timestamp int64) *time.Time {
	if timestamp == 0 {
		return nil
	}
	t := time.Unix(timestamp, 0).UTC()
	return &t
}

// VerifyWebhookSignature verifies a Stripe webhook signature and returns the event
func VerifyWebhookSignature(payload []byte, signature string) (*stripe.Event, error) {
	webhookSecret := strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET"))
	if webhookSecret == "" {
		return nil, fmt.Errorf("STRIPE_WEBHOOK_SECRET is not set")
	}

	event, err := webhook.ConstructEvent(payload, signature, webhookSecret)
	if err != nil {
		slog.Error("Webhook signature verification failed", "error", err)
		return nil, fmt.Errorf("invalid webhook signature: %w", err)
	}

	return &event, nil
}

// ListPaymentMethods returns all payment methods for a customer
func (s *StripeClient) ListPaymentMethods(ctx context.Context, customerID string) ([]*stripe.PaymentMethod, error) {
	if customerID == "" {
		return nil, nil
	}
	params := &stripe.PaymentMethodListParams{
		ListParams: stripe.ListParams{Context: ctx},
		Customer:   stripe.String(customerID),
		Type:       stripe.String("card"),
	}
	params.Filters.AddFilter("limit", "", "100")
	return cbCall(ctx, s.cb, "ListPaymentMethods", []any{"customerID", customerID}, func() ([]*stripe.PaymentMethod, error) {
		return s.backend.PaymentMethodList(params)
	})
}

// ListInvoices returns all invoices for a customer
func (s *StripeClient) ListInvoices(ctx context.Context, customerID string) ([]*stripe.Invoice, error) {
	if customerID == "" {
		return nil, nil
	}
	params := &stripe.InvoiceListParams{
		ListParams: stripe.ListParams{Context: ctx},
		Customer:   stripe.String(customerID),
	}
	params.Filters.AddFilter("limit", "", "100")
	params.Filters.AddFilter("status", "", "paid")
	return cbCall(ctx, s.cb, "ListInvoices", []any{"customerID", customerID}, func() ([]*stripe.Invoice, error) {
		return s.backend.InvoiceList(params)
	})
}

// CreateCustomerPortalSession creates a customer portal session for managing payment methods
func (s *StripeClient) CreateCustomerPortalSession(ctx context.Context, customerID, returnURL string) (string, error) {
	if customerID == "" {
		return "", fmt.Errorf("customer ID is required")
	}
	params := &stripe.BillingPortalSessionParams{
		Params:    stripe.Params{Context: ctx},
		Customer:  stripe.String(customerID),
		ReturnURL: stripe.String(returnURL),
	}
	sess, err := cbCall(ctx, s.cb, "CreateCustomerPortalSession", []any{"customerID", customerID}, func() (*stripe.BillingPortalSession, error) {
		return s.backend.BillingPortalSessionNew(params)
	})
	if err != nil {
		return "", err
	}
	return sess.URL, nil
}
