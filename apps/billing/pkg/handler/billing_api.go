package handler

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/billing-service/pkg/billing"
	corepayments "github.com/TaskForceAI/core/pkg/payments"
	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stripe/stripe-go/v82"
)

const MaxAutoRechargeAmount = corepayments.MaxAutoRechargeAmount

type BalanceResponse struct {
	CreditBalance         float64    `json:"credit_balance"`
	AutoRechargeEnabled   bool       `json:"auto_recharge_enabled"`
	AutoRechargeAmount    *float64   `json:"auto_recharge_amount,omitempty"`
	AutoRechargeThreshold *float64   `json:"auto_recharge_threshold,omitempty"`
	SubscriptionStatus    *string    `json:"subscription_status,omitempty"`
	SubscriptionID        *string    `json:"subscription_id,omitempty"`
	CancelAtPeriodEnd     bool       `json:"cancel_at_period_end"`
	CurrentPeriodEnd      *time.Time `json:"current_period_end,omitempty"`
	CurrentPeriodStart    *time.Time `json:"current_period_start,omitempty"`
}

type PaymentMethodResponse struct {
	ID        string `json:"id"`
	Brand     string `json:"brand"`
	Last4     string `json:"last4"`
	ExpMonth  int64  `json:"exp_month"`
	ExpYear   int64  `json:"exp_year"`
	IsDefault bool   `json:"is_default"`
}

type InvoiceResponse struct {
	ID         string    `json:"id"`
	Number     string    `json:"number"`
	AmountPaid float64   `json:"amount_paid"`
	Currency   string    `json:"currency"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"created_at"`
	InvoicePDF string    `json:"invoice_pdf"`
	HostedURL  string    `json:"hosted_url"`
}

type AutoRechargeRequest struct {
	Enabled   *bool    `json:"enabled" validate:"required"`
	Amount    *float64 `json:"amount,omitempty"`
	Threshold *float64 `json:"threshold,omitempty"`
}

// CreateSubscriptionRequest is the JSON body for creating a checkout session.
type CreateSubscriptionRequest struct {
	PriceID string `json:"price_id" validate:"required"`
}

type CreateSubscriptionResponse struct {
	CheckoutURL    string  `json:"checkout_url"`
	SubscriptionID *string `json:"subscription_id,omitempty"`
	Status         *string `json:"status,omitempty"`
}

type MessageResponse struct {
	Message string `json:"message"`
}

type PortalResponse struct {
	URL string `json:"url"`
}

type ProductsResponse struct {
	Products []ProductResponse `json:"products"`
}

type SubscriptionResponse struct {
	Subscription any `json:"subscription"`
}

type ProductResponse struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	Plan          string `json:"plan"`
	PriceID       string `json:"price_id"`
	PriceAmount   int64  `json:"price_amount"`
	PriceCurrency string `json:"price_currency"`
}

type billingAPIResponse[T any] struct {
	Body T
}

func billingOK[T any](body T) *billingAPIResponse[T] {
	return &billingAPIResponse[T]{Body: body}
}

func numericToFloat64(n pgtype.Numeric) float64 {
	if !n.Valid {
		return 0
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return 0
	}
	return f.Float64
}

func numericToFloat64Ptr(n pgtype.Numeric) *float64 {
	if !n.Valid {
		return nil
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return nil
	}
	v := f.Float64
	return &v
}

var getQueries = billing.GetQueries

type StripeClient interface {
	GetCustomer(ctx context.Context, customerID string) (*stripe.Customer, error)
	GetPrice(ctx context.Context, id string, params *stripe.PriceParams) (*stripe.Price, error)
	ListPaymentMethods(ctx context.Context, customerID string) ([]*stripe.PaymentMethod, error)
	ListInvoices(ctx context.Context, customerID string) ([]*stripe.Invoice, error)
	CreateCustomerPortalSession(ctx context.Context, customerID, returnURL string) (string, error)
}

var newStripeClient = func() (StripeClient, error) {
	return billing.NewStripeClient()
}

type paidPlan struct {
	Plan    string
	PriceID string
}

func getPaidPlans() []paidPlan {
	plans := []paidPlan{}
	for _, planDef := range billing.BillingPlans {
		if planDef.StripePriceID == nil {
			continue
		}
		if id := strings.TrimSpace(*planDef.StripePriceID); id != "" {
			plans = append(plans, paidPlan{Plan: string(planDef.Plan), PriceID: id})
		}
	}
	return plans
}

const paymentProductsCacheTTL = 5 * time.Minute

type paymentProductsCache struct {
	mu        sync.Mutex
	key       string
	expiresAt time.Time
	products  []ProductResponse
}

var productsCache = paymentProductsCache{}

func productCacheKey(plans []paidPlan) string {
	parts := make([]string, 0, len(plans))
	for _, p := range plans {
		parts = append(parts, p.Plan+":"+p.PriceID)
	}
	return strings.Join(parts, "|")
}

func cachedPaymentProducts(key string, now time.Time) ([]ProductResponse, bool) {
	productsCache.mu.Lock()
	defer productsCache.mu.Unlock()
	if productsCache.key != key || productsCache.expiresAt.Before(now) {
		return nil, false
	}
	products := append([]ProductResponse(nil), productsCache.products...)
	return products, true
}

func cachePaymentProducts(key string, products []ProductResponse, now time.Time) {
	productsCache.mu.Lock()
	defer productsCache.mu.Unlock()
	productsCache.key = key
	productsCache.expiresAt = now.Add(paymentProductsCacheTTL)
	productsCache.products = append([]ProductResponse(nil), products...)
}

func billingAccountStoreForUser(ctx context.Context, userID int) (billing.AccountSettingsRepository, error) {
	if userID > math.MaxInt32 {
		return nil, huma.Error500InternalServerError("User ID exceeds int32 limit")
	}
	dbQueries, err := getQueries(ctx)
	if err != nil {
		return nil, huma.Error503ServiceUnavailable("Database unavailable")
	}
	return billing.NewAccountSettingsRepository(dbQueries), nil
}

func authenticatedBillingAccount(ctx context.Context, userID int) (*billing.PaymentsAccountUser, error) {
	accountStore, err := billingAccountStoreForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	account, err := getBillingAccountOrError(ctx, accountStore, userID)
	if err != nil {
		return nil, err
	}
	return account, nil
}

func getBillingAccountOrError(ctx context.Context, repo billing.PaymentsRepository, userID int) (*billing.PaymentsAccountUser, error) {
	dbUser, err := repo.FindUserByID(ctx, userID)
	if errors.Is(err, billing.ErrBillingUserNotFound) || (err == nil && dbUser == nil) {
		return nil, huma.Error404NotFound("User billing record not found")
	}
	if err != nil {
		slog.Error("GetUserByID failed", "error", err, "userId", userID)
		return nil, huma.Error500InternalServerError("Internal error")
	}

	return dbUser, nil
}

func balanceResponseFromAccount(account *billing.PaymentsAccountUser) BalanceResponse {
	return BalanceResponse{
		CreditBalance:         numericToFloat64(account.CreditBalance),
		AutoRechargeEnabled:   account.AutoRechargeEnabled,
		AutoRechargeAmount:    numericToFloat64Ptr(account.AutoRechargeAmount),
		AutoRechargeThreshold: numericToFloat64Ptr(account.AutoRechargeThreshold),
		SubscriptionStatus:    account.SubscriptionStatus,
		SubscriptionID:        account.SubscriptionID,
		CancelAtPeriodEnd:     account.CancelAtPeriodEnd,
		CurrentPeriodStart:    account.CurrentPeriodStart,
		CurrentPeriodEnd:      account.CurrentPeriodEnd,
	}
}

func validateAutoRechargeRequest(req AutoRechargeRequest) error {
	if req.Enabled == nil {
		return huma.Error400BadRequest("Invalid request")
	}
	if !*req.Enabled {
		return nil
	}
	settings := corepayments.AutoRechargeSettings{
		Enabled:   *req.Enabled,
		Amount:    req.Amount,
		Threshold: req.Threshold,
	}
	if err := corepayments.ValidateAutoRecharge(settings); err != nil {
		switch {
		case errors.Is(err, corepayments.ErrAutoRechargeSettingsRequired):
			return huma.Error400BadRequest("Amount and threshold are required when auto-recharge is enabled")
		case errors.Is(err, corepayments.ErrAutoRechargeAmountInvalid):
			return huma.Error400BadRequest("Auto-recharge amount must be greater than zero")
		case errors.Is(err, corepayments.ErrAutoRechargeAmountTooLarge):
			return huma.Error400BadRequest("Auto-recharge amount exceeds the maximum allowed amount")
		case errors.Is(err, corepayments.ErrAutoRechargeThresholdInvalid):
			return huma.Error400BadRequest("Auto-recharge threshold must be zero or greater")
		default:
			return huma.Error400BadRequest("Auto-recharge threshold must be less than amount")
		}
	}
	return huma.Error501NotImplemented("Auto-recharge is not available yet")
}

func RegisterBillingHandlers(api huma.API) {
	registerProducts(api)
	registerGetSubscription(api)
	registerCreateSubscription(api)
	registerSubscriptionCancellation(api, subscriptionCancellationRoute{
		operationID: "cancel-payment-subscription", path: "/api/v1/payments/cancel-subscription", summary: "Cancel current subscription at period end",
		cancelAtPeriodEnd: true, spanName: "CancelSub", message: "Subscription set to cancel at end of period",
	})
	registerSubscriptionCancellation(api, subscriptionCancellationRoute{
		operationID: "reactivate-payment-subscription", path: "/api/v1/payments/reactivate-subscription", summary: "Reactivate current subscription",
		cancelAtPeriodEnd: false, spanName: "ReactivateSub", message: "Subscription reactivated successfully",
	})
	registerGetBalance(api)
	registerGetPaymentMethods(api)
	registerGetInvoices(api)
	registerUpdateAutoRecharge(api)
	registerCreatePortalSession(api)
	registerMobileSync(api)
}

func registerProducts(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-payment-products",
		Method:      http.MethodGet,
		Path:        "/api/v1/payments/products",
		Summary:     "Get available subscription products",
		Tags:        []string{"Billing"},
	}, func(ctx context.Context, input *struct{}) (*billingAPIResponse[ProductsResponse], error) {
		plans := getPaidPlans()
		cacheKey := productCacheKey(plans)
		if products, ok := cachedPaymentProducts(cacheKey, time.Now()); ok {
			return billingOK(ProductsResponse{Products: products}), nil
		}

		stripeClient, err := newStripeClient()
		if err != nil {
			return nil, huma.Error500InternalServerError("Stripe not configured")
		}

		products := []ProductResponse{}
		for _, p := range plans {
			params := &stripe.PriceParams{}
			params.AddExpand("product")
			price, err := stripeClient.GetPrice(ctx, p.PriceID, params)
			if err != nil {
				slog.Error("Failed to fetch Stripe price for billing product", "error", err, "plan", p.Plan, "priceId", p.PriceID)
				return nil, huma.Error500InternalServerError("Failed to fetch payment products")
			}
			if price == nil || price.Product == nil {
				slog.Error("Stripe price did not include product details", "plan", p.Plan, "priceId", p.PriceID)
				return nil, huma.Error500InternalServerError("Failed to fetch payment products")
			}

			products = append(products, ProductResponse{
				ID:            price.Product.ID,
				Name:          price.Product.Name,
				Description:   price.Product.Description,
				Plan:          p.Plan,
				PriceID:       price.ID,
				PriceAmount:   price.UnitAmount,
				PriceCurrency: string(price.Currency),
			})
		}

		cachePaymentProducts(cacheKey, products, time.Now())
		return billingOK(ProductsResponse{Products: products}), nil
	})
}

func registerCreateSubscription(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-payment-subscription",
		Method:      http.MethodPost,
		Path:        "/api/v1/payments/create-subscription",
		Summary:     "Create a Stripe checkout session",
		Tags:        []string{"Billing"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
		Origin string `header:"Origin"`
		Body   CreateSubscriptionRequest
	}) (*billingAPIResponse[CreateSubscriptionResponse], error) {
		dbQueries, err := getQueries(ctx)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}

		response, err := createSubscription(ctx, billing.NewPaymentsRepository(dbQueries), input.User.Email, input.Body, input.Origin)
		if err != nil {
			return nil, err
		}

		return billingOK(*response), nil
	})
}

type subscriptionCancellationRoute struct {
	operationID, path, summary, spanName, message string
	cancelAtPeriodEnd                             bool
}

func registerSubscriptionCancellation(api huma.API, route subscriptionCancellationRoute) {
	huma.Register(api, huma.Operation{
		OperationID: route.operationID,
		Method:      http.MethodPost,
		Path:        route.path,
		Summary:     route.summary,
		Tags:        []string{"Billing"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
	}) (*billingAPIResponse[MessageResponse], error) {
		dbQueries, err := getQueries(ctx)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}

		if err := changeSubscriptionCancellation(ctx, billing.NewPaymentsRepository(dbQueries), input.User.ID, route.cancelAtPeriodEnd, route.spanName); err != nil {
			return nil, err
		}

		return billingOK(MessageResponse{Message: route.message}), nil
	})
}

func registerGetSubscription(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-payment-subscription",
		Method:      http.MethodGet,
		Path:        "/api/v1/payments",
		Summary:     "Get current subscription status",
		Tags:        []string{"Billing"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
		ForceSync bool `query:"force_sync"`
	}) (*billingAPIResponse[SubscriptionResponse], error) {
		dbQueries, err := getQueries(ctx)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}

		lookup, err := getSubscriptionResponse(ctx, billing.NewPaymentsRepository(dbQueries), input.User.ID, input.ForceSync)
		if err != nil {
			return nil, err
		}

		return billingOK(SubscriptionResponse{Subscription: lookup.Subscription}), nil
	})
}

type billingSubscriptionLookup struct {
	Subscription any
	UserFound    bool
}

func getSubscriptionResponse(ctx context.Context, repo billing.PaymentsRepository, userID int, forceSync bool) (billingSubscriptionLookup, error) {
	if userID > math.MaxInt32 {
		return billingSubscriptionLookup{}, huma.Error500InternalServerError("User ID too large")
	}

	dbUser, err := repo.FindUserByID(ctx, userID)
	if errors.Is(err, billing.ErrBillingUserNotFound) || (err == nil && dbUser == nil) {
		return billingSubscriptionLookup{}, nil
	}
	if err != nil {
		slog.Error("GetSubscription: failed to fetch user", "error", err, "userId", userID)
		return billingSubscriptionLookup{}, huma.Error500InternalServerError("Internal error")
	}

	if shouldSyncStripeSubscription(dbUser, forceSync) {
		dbUser = syncStripeSubscriptionAndReload(ctx, repo, dbUser)
	} else if forceSync && dbUser.SubscriptionID != nil && !isStripeManagedSubscription(dbUser) {
		slog.Info("Skipping Stripe force sync for non-Stripe subscription source", "userId", userID)
	}

	return billingSubscriptionLookup{Subscription: subscriptionResponse(dbUser), UserFound: true}, nil
}

func createSubscription(
	ctx context.Context,
	repo billing.PaymentsRepository,
	email string,
	req CreateSubscriptionRequest,
	origin string,
) (*CreateSubscriptionResponse, error) {
	if strings.TrimSpace(req.PriceID) == "" {
		return nil, huma.Error400BadRequest("Invalid price selection")
	}

	dbUser, err := loadBillingUserByEmail(ctx, repo, email)
	if err != nil {
		if errors.Is(err, errAuthRequired) || errors.Is(err, errBillingUserLookupByEmail) {
			return nil, huma.Error401Unauthorized("User not found")
		}
		slog.Error("CreateSubscription: user lookup failed", "error", err, "email", email)
		return nil, huma.Error500InternalServerError("Internal error fetching user")
	}
	if dbUser.Disabled {
		return nil, huma.Error403Forbidden("Account disabled")
	}
	if hasOpenSubscription(dbUser) {
		return nil, huma.Error409Conflict("An active subscription already exists")
	}

	planDef, err := resolveAPICheckoutPlanByPriceID(req.PriceID)
	if err != nil {
		return nil, huma.Error400BadRequest("Invalid price selection")
	}

	stripeClient, stripeCustomer, priorCustomerID, err := getStripeCheckoutContext(ctx, dbUser)
	if err != nil {
		if errors.Is(err, errStripeNotConfigured) {
			return nil, huma.Error500InternalServerError("Stripe not configured")
		}
		slog.Error("CreateSub: Stripe customer error", "error", err, "userId", dbUser.ID)
		return nil, huma.Error500InternalServerError("Failed to manage payment customer")
	}

	checkoutOrigin := resolveOrigin(origin)
	session, err := createSubscriptionCheckoutSession(
		ctx,
		stripeClient,
		stripeCustomer.ID,
		subscriptionCheckoutSessionOptions{
			UserID:               dbUser.ID,
			PriceID:              req.PriceID,
			SuccessURL:           checkoutSuccessURLForOrigin(checkoutOrigin, false),
			CancelURL:            checkoutCancelURLForOrigin(checkoutOrigin),
			SubscriptionMetadata: checkoutMetadata(dbUser, string(planDef.Plan), stripeCustomer.ID),
		},
	)
	if err != nil {
		slog.Error("CreateSub: Session failed", "error", err, "userId", dbUser.ID)
		return nil, huma.Error500InternalServerError("Failed to initiate checkout")
	}

	persistStripeCustomerIDIfChanged(ctx, repo, dbUser.ID, priorCustomerID, stripeCustomer.ID, "CreateSub")
	slog.Info("API subscription checkout session created", "userId", dbUser.ID, "plan", planDef.Plan, "hasPriorCustomer", priorCustomerID != "")

	var subscriptionID *string
	if session.Subscription != nil && session.Subscription.ID != "" {
		subscriptionID = &session.Subscription.ID
	}
	status := string(session.Status)
	return &CreateSubscriptionResponse{
		CheckoutURL:    session.URL,
		SubscriptionID: subscriptionID,
		Status:         &status,
	}, nil
}

func changeSubscriptionCancellation(
	ctx context.Context,
	repo billing.PaymentsRepository,
	userID int,
	cancelAtPeriodEnd bool,
	logPrefix string,
) error {
	dbUser, err := loadBillingUserByID(ctx, repo, userID)
	if err != nil {
		return err
	}

	if err := validateSubscriptionCancellationChange(dbUser, cancelAtPeriodEnd); err != nil {
		return huma.Error400BadRequest(err.Error())
	}
	if err := updateSubscriptionCancellationState(ctx, repo, dbUser, cancelAtPeriodEnd, logPrefix); err != nil {
		if errors.Is(err, errStripeNotConfigured) {
			return huma.Error500InternalServerError("Stripe not configured")
		}
		return huma.Error500InternalServerError("Stripe update failed")
	}

	slog.Info(logPrefix+": subscription cancellation state changed", "userId", dbUser.ID, "cancelAtPeriodEnd", cancelAtPeriodEnd)
	return nil
}

func loadBillingUserByID(ctx context.Context, repo billing.PaymentsRepository, userID int) (*billing.PaymentsAccountUser, error) {
	if userID > math.MaxInt32 {
		return nil, huma.Error500InternalServerError("User ID too large")
	}

	dbUser, err := repo.FindUserByID(ctx, userID)
	if errors.Is(err, billing.ErrBillingUserNotFound) || (err == nil && dbUser == nil) {
		return nil, huma.Error404NotFound("User billing record not found")
	}
	if err != nil {
		return nil, huma.Error500InternalServerError("Internal error fetching user")
	}
	return dbUser, nil
}

func loadBillingUserByEmail(ctx context.Context, repo billing.PaymentsRepository, email string) (*billing.PaymentsAccountUser, error) {
	if strings.TrimSpace(email) == "" {
		return nil, errAuthRequired
	}

	dbUser, err := repo.FindUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, billing.ErrBillingUserNotFound) || (err == nil && dbUser == nil) {
		return nil, errBillingUserLookupByEmail
	}
	if err != nil {
		return nil, err
	}
	return dbUser, nil
}

func registerMobileSync(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "sync-mobile-subscription",
		Method:      http.MethodPost,
		Path:        "/api/v1/payments/mobile/sync",
		Summary:     "Sync mobile subscription status",
		Tags:        []string{"Billing"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
	}) (*billingAPIResponse[any], error) {
		dbQueries, err := getQueries(ctx)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Database unavailable")
		}

		userID := input.User.ID
		repo := billing.NewMobileSubscriptionRepository(dbQueries)
		svc := NewMobileSubscriptionService(repo)

		slog.Info("Mobile subscription sync requested", "userId", userID)
		result, err := svc.SyncMobileSubscriptionByUserID(ctx, userID)
		if err != nil {
			slog.Error("Failed to sync mobile subscription", "userId", userID, "error", err)
			return nil, huma.Error500InternalServerError("Sync failed")
		}
		slog.Info("Mobile subscription sync completed", "userId", userID, "plan", result.Plan, "source", result.SubscriptionSource, "status", result.SubscriptionStatus)

		return billingOK[any](result), nil
	})
}

func registerGetBalance(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-billing-balance",
		Method:      http.MethodGet,
		Path:        "/api/v1/billing/balance",
		Summary:     "Get billing balance and subscription status",
		Tags:        []string{"Billing"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
	}) (*billingAPIResponse[BalanceResponse], error) {
		account, err := authenticatedBillingAccount(ctx, input.User.ID)
		if err != nil {
			return nil, err
		}

		return billingOK(balanceResponseFromAccount(account)), nil
	})
}

func registerGetPaymentMethods(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-payment-methods",
		Method:      http.MethodGet,
		Path:        "/api/v1/billing/payment-methods",
		Summary:     "Get payment methods for the authenticated user",
		Tags:        []string{"Billing"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
	}) (*billingAPIResponse[[]PaymentMethodResponse], error) {
		account, err := authenticatedBillingAccount(ctx, input.User.ID)
		if err != nil {
			return nil, err
		}

		if account.CustomerID == nil || *account.CustomerID == "" {
			return billingOK([]PaymentMethodResponse{}), nil
		}

		stripeClient, err := newStripeClient()
		if err != nil {
			slog.Error("Stripe client failed", "error", err)
			return nil, huma.Error500InternalServerError("Stripe not configured")
		}

		paymentMethods, err := stripeClient.ListPaymentMethods(ctx, *account.CustomerID)
		if err != nil {
			slog.Error("ListPaymentMethods failed", "error", err, "customerId", *account.CustomerID)
			return nil, huma.Error500InternalServerError("Failed to fetch payment methods")
		}
		customer, err := stripeClient.GetCustomer(ctx, *account.CustomerID)
		if err != nil {
			slog.Error("GetCustomer failed while fetching payment methods", "error", err, "customerId", *account.CustomerID)
			return nil, huma.Error500InternalServerError("Failed to fetch payment methods")
		}
		defaultPaymentMethodID := ""
		if customer != nil && customer.InvoiceSettings != nil && customer.InvoiceSettings.DefaultPaymentMethod != nil {
			defaultPaymentMethodID = customer.InvoiceSettings.DefaultPaymentMethod.ID
		}

		resp := make([]PaymentMethodResponse, 0, len(paymentMethods))
		for _, pm := range paymentMethods {
			if pm.Card == nil {
				continue
			}
			resp = append(resp, PaymentMethodResponse{
				ID:        pm.ID,
				Brand:     string(pm.Card.Brand),
				Last4:     pm.Card.Last4,
				ExpMonth:  pm.Card.ExpMonth,
				ExpYear:   pm.Card.ExpYear,
				IsDefault: pm.ID == defaultPaymentMethodID,
			})
		}

		return billingOK(resp), nil
	})
}

func registerGetInvoices(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "get-billing-invoices",
		Method:      http.MethodGet,
		Path:        "/api/v1/billing/invoices",
		Summary:     "Get billing invoices for the authenticated user",
		Tags:        []string{"Billing"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
	}) (*billingAPIResponse[[]InvoiceResponse], error) {
		account, err := authenticatedBillingAccount(ctx, input.User.ID)
		if err != nil {
			return nil, err
		}

		if account.CustomerID == nil || *account.CustomerID == "" {
			return billingOK([]InvoiceResponse{}), nil
		}

		stripeClient, err := newStripeClient()
		if err != nil {
			slog.Error("Stripe client failed", "error", err)
			return nil, huma.Error500InternalServerError("Stripe not configured")
		}

		invoices, err := stripeClient.ListInvoices(ctx, *account.CustomerID)
		if err != nil {
			slog.Error("ListInvoices failed", "error", err, "customerId", *account.CustomerID)
			return nil, huma.Error500InternalServerError("Failed to fetch invoices")
		}

		resp := make([]InvoiceResponse, 0, len(invoices))
		for _, inv := range invoices {
			resp = append(resp, InvoiceResponse{
				ID:         inv.ID,
				Number:     inv.Number,
				AmountPaid: billing.NormalizeInvoiceAmount(inv.AmountPaid, string(inv.Currency)),
				Currency:   string(inv.Currency),
				Status:     string(inv.Status),
				CreatedAt:  time.Unix(inv.Created, 0),
				InvoicePDF: inv.InvoicePDF,
				HostedURL:  inv.HostedInvoiceURL,
			})
		}

		return billingOK(resp), nil
	})
}

func registerUpdateAutoRecharge(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "update-auto-recharge",
		Method:      http.MethodPost,
		Path:        "/api/v1/billing/auto-recharge",
		Summary:     "Update auto-recharge settings",
		Tags:        []string{"Billing"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
		Body AutoRechargeRequest
	}) (*billingAPIResponse[BalanceResponse], error) {
		userID := input.User.ID

		if err := validateAutoRechargeRequest(input.Body); err != nil {
			return nil, err
		}

		accountStore, err := billingAccountStoreForUser(ctx, userID)
		if err != nil {
			return nil, err
		}
		err = accountStore.UpdateAutoRecharge(ctx, userID, billing.AutoRechargeUpdate{
			Enabled:   *input.Body.Enabled,
			Amount:    input.Body.Amount,
			Threshold: input.Body.Threshold,
		})
		if err != nil {
			slog.Error("UpdateUserAutoRecharge failed", "error", err, "userId", userID)
			return nil, huma.Error500InternalServerError("Failed to update auto-recharge settings")
		}
		slog.Info("Billing auto-recharge updated", "userId", userID, "enabled", *input.Body.Enabled, "hasAmount", input.Body.Amount != nil, "hasThreshold", input.Body.Threshold != nil)

		account, err := getBillingAccountOrError(ctx, accountStore, userID)
		if err != nil {
			return nil, err
		}

		return billingOK(balanceResponseFromAccount(account)), nil
	})
}

func registerCreatePortalSession(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "create-customer-portal-session",
		Method:      http.MethodPost,
		Path:        "/api/v1/billing/portal",
		Summary:     "Create a Stripe customer portal session",
		Tags:        []string{"Billing"},
	}, func(ctx context.Context, input *struct {
		adapterhandler.AuthContext
	}) (*billingAPIResponse[PortalResponse], error) {
		account, err := authenticatedBillingAccount(ctx, input.User.ID)
		if err != nil {
			return nil, err
		}

		if account.CustomerID == nil || *account.CustomerID == "" {
			return nil, huma.Error400BadRequest("No Stripe customer found")
		}

		stripeClient, err := newStripeClient()
		if err != nil {
			slog.Error("Stripe client failed", "error", err)
			return nil, huma.Error500InternalServerError("Stripe not configured")
		}

		returnURL := billingPortalReturnURL()
		portalURL, err := stripeClient.CreateCustomerPortalSession(ctx, *account.CustomerID, returnURL)
		if err != nil {
			slog.Error("CreateCustomerPortalSession failed", "error", err, "customerId", *account.CustomerID)
			return nil, huma.Error500InternalServerError("Failed to create portal session")
		}
		slog.Info("Billing portal session created", "userId", input.User.ID)

		return billingOK(PortalResponse{URL: portalURL}), nil
	})
}

func billingPortalReturnURL() string {
	siteURL := GetEnv("SITE_URL", "https://console.taskforceai.chat")
	if origin, ok := normalizeOrigin(siteURL); ok {
		return origin + "/billing"
	}
	parsed, err := url.Parse(strings.TrimSpace(siteURL))
	if err == nil && parsed.Scheme != "" && parsed.Host != "" && (parsed.Scheme == "http" || parsed.Scheme == "https") {
		parsed.User = nil
		parsed.RawQuery = ""
		parsed.Fragment = ""
		if parsed.Path == "" || parsed.Path == "/" {
			parsed.Path = "/billing"
		}
		return parsed.String()
	}
	return "https://console.taskforceai.chat/billing"
}
