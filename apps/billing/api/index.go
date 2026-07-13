package handler

import (
	"github.com/TaskForceAI/adapters/pkg/dbauth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/observability"
	billinghandler "github.com/TaskForceAI/billing-service/pkg/handler"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"net/http"
	"sync"
)

var getPool = billinghandler.GetPool

var (
	handlerMux http.Handler
	muxOnce    sync.Once
)

func Handler(w http.ResponseWriter, r *http.Request) {
	adapterhandler.ServeVercelEntrypoint(w, r, &handlerMux, &muxOnce, adapterhandler.VercelEntrypointOptions{
		ServiceName: "billing-service",
		BeforeInit: func(w http.ResponseWriter, r *http.Request) bool {
			if r.URL.Path == "/api/v1/billing/health" && !adapterhandler.IsDeepHealthCheck(r) {
				adapterhandler.WithSecurityHeaders(handleHealth)(w, r)
				return true
			}
			return false
		},
		InitHandler: func() http.Handler {
			adapterhandler.InitObservabilityAsync("billing-service")
			mux, _ := NewRouter()
			return adapterhandler.SecureObservedHandler(mux, "BillingHandler", false)
		},
	})
}

func NewRouter() (*chi.Mux, huma.API) {
	r := chi.NewRouter()
	r.Use(adapterhandler.CORSMiddleware)
	r.Use(adapterhandler.SecurityHeadersMiddleware)
	r.Use(adapterhandler.ServiceHeader("billing-service"))
	r.Use(observability.WithHTTPMetrics("billing-service"))

	r.Use(func(next http.Handler) http.Handler {
		return dbauth.WithLazyOptionalDBAuth(billinghandler.GetQueries, next.ServeHTTP)
	})
	// Enforce CSRF for authenticated state-changing requests, including Huma routes.
	// Webhook endpoints rely on provider signatures instead of CSRF tokens.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if isWebhookPath(req.URL.Path) || adapterhandler.GetAuthenticatedUser(req) == nil {
				next.ServeHTTP(w, req)
				return
			}
			adapterhandler.WithCSRF(next.ServeHTTP)(w, req)
		})
	})

	config := huma.DefaultConfig("TaskForceAI Billing API", "1.0.0")
	api := humachi.New(r, config)

	billinghandler.RegisterBillingHandlers(api)

	r.HandleFunc("/api/v1/billing/health", handleHealth)
	adapterhandler.RegisterMethodRoutes(r, []adapterhandler.MethodRoute{
		{Method: http.MethodPost, Path: "/api/v1/payments/webhook", Func: billinghandler.StripeWebhookHandler},
		{Method: http.MethodPost, Path: "/api/v1/payments/webhook/revenuecat", Func: billinghandler.RevenueCatWebhookHandler},
		{Method: http.MethodGet, Path: "/api/v1/checkout", Func: billinghandler.CheckoutHandler},
	})

	// Silence common noise requests (browsers, bots, crawlers)
	adapterhandler.RegisterCommonRoutes(r)
	adapterhandler.RegisterNotFound(r, "Billing service", "Billing route not found: ")

	return r, api
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if !adapterhandler.RequireAuthenticatedDeepHealth(w, r) {
		return
	}
	adapterhandler.WriteDatabaseHealthWithOptions(w, r, "1.0.0", getPool, adapterhandler.DatabaseHealthOptions{
		UnconfiguredStatus: "not_configured",
		UnconfiguredError:  "DATABASE_URL is not set",
	})
}

func isWebhookPath(path string) bool {
	return path == "/api/v1/payments/webhook" || path == "/api/v1/payments/webhook/revenuecat"
}
