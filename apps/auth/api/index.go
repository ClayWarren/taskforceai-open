package handler

import (
	"context"
	"errors"
	appdatabase "github.com/TaskForceAI/auth-service/pkg/database"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	authhandlers "github.com/TaskForceAI/auth-service/pkg/handlers/auth"
	authcallback "github.com/TaskForceAI/auth-service/pkg/handlers/auth/callback"
	authcsrf "github.com/TaskForceAI/auth-service/pkg/handlers/auth/csrf"
	authdeviceauthorize "github.com/TaskForceAI/auth-service/pkg/handlers/auth/device/authorize"
	authdevicestart "github.com/TaskForceAI/auth-service/pkg/handlers/auth/device/start"
	authdevicetoken "github.com/TaskForceAI/auth-service/pkg/handlers/auth/device/token"
	authmfa "github.com/TaskForceAI/auth-service/pkg/handlers/auth/mfa"
	authmobile "github.com/TaskForceAI/auth-service/pkg/handlers/auth/mobile"
	authrefresh "github.com/TaskForceAI/auth-service/pkg/handlers/auth/refresh"
	authsaml "github.com/TaskForceAI/auth-service/pkg/handlers/auth/saml"
	authsession "github.com/TaskForceAI/auth-service/pkg/handlers/auth/session"
	authsignin "github.com/TaskForceAI/auth-service/pkg/handlers/auth/signin"
	authtoken "github.com/TaskForceAI/auth-service/pkg/handlers/auth/token"
	authwebhooks "github.com/TaskForceAI/auth-service/pkg/handlers/auth/webhooks"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/observability"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/jackc/pgx/v5"
)

var (
	handlerMux http.Handler
	muxOnce    sync.Once
)

var activeUserAfterRateLimitPaths = map[string]struct{}{
	"/api/auth/session":                    {},
	"/api/auth/csrf":                       {},
	"/api/v1/auth/login":                   {},
	"/api/v1/auth/callback":                {},
	"/api/v1/auth/login-method":            {},
	"/api/v1/auth/saml/signin":             {},
	"/api/v1/auth/saml/callback":           {},
	"/api/v1/auth/webhooks/workos":         {},
	"/api/auth/signout":                    {},
	"/api/v1/auth/logout":                  {},
	"/api/auth/signin/google-drive":        {},
	"/api/auth/callback/google-drive":      {},
	"/api/auth/signin/github":              {},
	"/api/auth/callback/github":            {},
	"/api/v1/auth/token":                   {},
	"/api/v1/auth/google":                  {},
	"/api/v1/auth/apple":                   {},
	"/api/v1/auth/refresh":                 {},
	"/api/v1/auth/impersonate":             {},
	"/api/v1/auth/mfa/authenticator/login": {},
	"/api/auth/ping":                       {},
	"/api/v1/auth/ping":                    {},
}

func Handler(w http.ResponseWriter, r *http.Request) {
	adapterhandler.ServeVercelEntrypoint(w, r, &handlerMux, &muxOnce, adapterhandler.VercelEntrypointOptions{
		ServiceName:    "auth-service",
		InitLogMessage: "Initializing global router for Auth service",
		BeforeInit:     func(_ http.ResponseWriter, _ *http.Request) bool { return false },
		InitHandler: func() http.Handler {
			if err := authhandler.ValidateSecureEnv(); err != nil {
				slog.Error("Auth service secure environment validation failed", "error", err)
				return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					authhandler.JSONError(w, http.StatusInternalServerError, "Server misconfiguration")
				})
			}

			adapterhandler.InitObservabilityAsync("auth-service")
			mux, _ := NewRouter()
			return adapterhandler.SecureObservedHandler(mux, "AuthHandler", true)
		},
	})
}

func NewRouter() (*chi.Mux, huma.API) {
	r := chi.NewRouter()
	r.Use(adapterhandler.ServiceHeader("auth-service"))
	r.Use(observability.WithHTTPMetrics("auth-service"))

	// Apply optional auth middleware to all routes in this service.
	// This populates the context with the user if a valid session cookie is present.
	r.Use(func(next http.Handler) http.Handler {
		return authhandler.WithOptionalAuth(next.ServeHTTP)
	})
	r.Use(withActiveAuthUser)

	config := huma.DefaultConfig("TaskForceAI Auth API", "1.0.0")
	api := humachi.New(r, config)

	// Register Huma handlers - resolving dependencies lazily
	authhandlers.RegisterHandlers(api, authpkg.NewLazyAuthUserRepository(appdatabase.GetQueries))
	authdevicestart.RegisterHandler(api)
	authdevicetoken.RegisterHandler(api)
	authdeviceauthorize.RegisterHandler(api)
	authmfa.RegisterHandlers(api)

	// Rate Limit Middlewares
	strictLimit := authhandler.WithRateLimit(10, time.Minute)    // 10 req/min (sensitive auth endpoints)
	oauthLimit := authhandler.WithRateLimit(30, time.Minute)     // 30 req/min (Hosted OAuth redirects/callbacks)
	sessionLimit := authhandler.WithRateLimit(60, time.Minute)   // 60 req/min (Session, Ping)
	metadataLimit := authhandler.WithRateLimit(100, time.Minute) // 100 req/min (Settings, Metadata)

	// Structured JSON operations are registered through Huma while their
	// existing net/http handlers preserve the established wire format.
	sessionLimitWithFastMiss := limitSessionCredentiallessMiss(sessionLimit)
	sessionHandler := func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("debug") == "env" {
			if !adapterhandler.DebugEnabled() {
				authhandler.JSONError(w, http.StatusNotFound, "Not found")
				return
			}
			authhandler.JSON(w, http.StatusOK, buildSessionDebugPayload())
			return
		}
		authsession.Handler(w, r)
	}
	humaRoutes := []struct {
		operation huma.Operation
		limit     func(http.Handler) http.Handler
		handler   http.HandlerFunc
	}{
		{
			operation: huma.Operation{
				OperationID: "get-auth-session",
				Method:      http.MethodGet,
				Path:        "/api/auth/session",
				Summary:     "Get the current browser session",
				Tags:        []string{"Auth"},
			},
			limit:   sessionLimitWithFastMiss,
			handler: sessionHandler,
		},
		{
			operation: huma.Operation{
				OperationID: "get-auth-csrf-token",
				Method:      http.MethodGet,
				Path:        "/api/auth/csrf",
				Summary:     "Create a browser CSRF token",
				Tags:        []string{"Auth"},
			},
			limit:   sessionLimit,
			handler: authcsrf.Handler,
		},
		{
			operation: huma.Operation{
				OperationID: "detect-auth-login-method",
				Method:      http.MethodPost,
				Path:        "/api/v1/auth/login-method",
				Summary:     "Detect the authentication method for an email address",
				Tags:        []string{"Auth"},
			},
			limit:   metadataLimit,
			handler: authsaml.MethodHandler,
		},
		{
			operation: huma.Operation{
				OperationID: "get-auth-access-token",
				Method:      http.MethodGet,
				Path:        "/api/v1/auth/token",
				Summary:     "Exchange a browser session for an access token",
				Tags:        []string{"Auth"},
			},
			limit:   strictLimit,
			handler: authtoken.Handler,
		},
		{
			operation: huma.Operation{
				OperationID: "authenticate-with-google",
				Method:      http.MethodPost,
				Path:        "/api/v1/auth/google",
				Summary:     "Authenticate a native client with Google",
				Tags:        []string{"Auth"},
			},
			limit:   strictLimit,
			handler: authmobile.GoogleHandler,
		},
		{
			operation: huma.Operation{
				OperationID: "authenticate-with-apple",
				Method:      http.MethodPost,
				Path:        "/api/v1/auth/apple",
				Summary:     "Authenticate a native client with Apple",
				Tags:        []string{"Auth"},
			},
			limit:   strictLimit,
			handler: authmobile.Handler,
		},
		{
			operation: huma.Operation{
				OperationID: "refresh-auth-session",
				Method:      http.MethodPost,
				Path:        "/api/v1/auth/refresh",
				Summary:     "Refresh the current authentication session",
				Tags:        []string{"Auth"},
			},
			limit:   sessionLimit,
			handler: authrefresh.Handler,
		},
		{
			operation: huma.Operation{
				OperationID: "start-auth-impersonation",
				Method:      http.MethodPost,
				Path:        "/api/v1/auth/impersonate",
				Summary:     "Start an administrator impersonation session",
				Tags:        []string{"Auth"},
			},
			limit:   strictLimit,
			handler: authhandlers.ImpersonateHandler,
		},
		{
			operation: huma.Operation{
				OperationID: "verify-authenticator-mfa-login",
				Method:      http.MethodPost,
				Path:        "/api/v1/auth/mfa/authenticator/login",
				Summary:     "Complete a login with an authenticator code",
				Tags:        []string{"Auth"},
			},
			limit:   strictLimit,
			handler: authmfa.LoginVerifyHandler,
		},
	}
	for _, route := range humaRoutes {
		adapterhandler.RegisterHumaHTTPHandler(
			api,
			route.operation,
			route.limit(withActiveAuthUserAfterRateLimit(route.handler)),
		)
	}

	// Redirects, signed webhooks, operational endpoints, and form-compatible
	// handlers remain direct Chi routes because typed Huma handling adds no value.
	chiRoutes := []adapterhandler.LimitedRoute{
		{Path: "/api/v1/auth/login", Limit: oauthLimit, Func: withActiveAuthUserAfterRateLimit(authsignin.HostedHandler)},
		{Path: "/api/v1/auth/callback", Limit: oauthLimit, Func: withActiveAuthUserAfterRateLimit(authcallback.HostedHandler)},
		{Path: "/api/v1/auth/saml/signin", Limit: strictLimit, Func: withActiveAuthUserAfterRateLimit(authsaml.SigninHandler)},
		{Path: "/api/v1/auth/saml/callback", Limit: strictLimit, Func: withActiveAuthUserAfterRateLimit(authsaml.CallbackHandler)},
		{Path: "/api/v1/auth/webhooks/workos", Limit: metadataLimit, Func: withActiveAuthUserAfterRateLimit(authwebhooks.WorkOSHandler)},
		{Path: "/api/auth/signout", Limit: sessionLimit, Func: withActiveAuthUserAfterRateLimit(authhandlers.LogoutHandler)},
		{Path: "/api/v1/auth/logout", Limit: sessionLimit, Func: withActiveAuthUserAfterRateLimit(authhandlers.LogoutHandler)},
		{Path: "/api/auth/signin/google-drive", Limit: strictLimit, Func: withActiveAuthUserAfterRateLimit(authsignin.GoogleDriveSigninHandler)},
		{Path: "/api/auth/callback/google-drive", Limit: strictLimit, Func: withActiveAuthUserAfterRateLimit(authcallback.GoogleDriveCallbackHandler)},
		{Path: "/api/auth/signin/github", Limit: strictLimit, Func: withActiveAuthUserAfterRateLimit(authsignin.GitHubSigninHandler)},
		{Path: "/api/auth/callback/github", Limit: strictLimit, Func: withActiveAuthUserAfterRateLimit(authcallback.GitHubCallbackHandler)},
		{Path: "/api/auth/ping", Limit: sessionLimit, Func: withActiveAuthUserAfterRateLimit(handlePingCheck)},
		{Path: "/api/v1/auth/ping", Limit: sessionLimit, Func: withActiveAuthUserAfterRateLimit(handlePingCheck)},
	}
	chiRoutes = appendTestLoginRoutes(chiRoutes, strictLimit)
	adapterhandler.RegisterLimitedRoutes(r, chiRoutes)

	// Utility routes
	r.HandleFunc("/api/auth/health", handleHealthCheck)
	r.HandleFunc("/api/v1/auth/health", handleHealthCheck)
	r.HandleFunc("/api/auth/debug", adapterhandler.HandleDebug)
	r.HandleFunc("/api/v1/auth/debug", adapterhandler.HandleDebug)
	r.HandleFunc("/api/auth/env-check", handleEnvCheck)

	// Silence common noise requests (browsers, bots, crawlers)
	adapterhandler.RegisterCommonRoutes(r)

	// Catch-all for debugging 404s
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		adapterhandler.GetLogger().Warn("Route not found in Auth service", map[string]any{
			"path":         r.URL.Path,
			"method":       r.Method,
			"__path":       r.URL.Query().Get("__path"),
			"matched_path": r.Header.Get("X-Matched-Path"),
		})
		authhandler.JSONError(w, http.StatusNotFound, "Auth route not found: "+r.URL.Path)
	})

	return r, api
}

func limitSessionCredentiallessMiss(
	limit func(http.Handler) http.Handler,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		limited := limit(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isCredentiallessSessionMiss(r) {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		})
	}
}

func isCredentiallessSessionMiss(r *http.Request) bool {
	if r.Method != http.MethodGet || r.URL.Path != "/api/auth/session" {
		return false
	}
	if r.URL.Query().Has("debug") {
		return false
	}
	if strings.TrimSpace(r.Header.Get("Authorization")) != "" {
		return false
	}

	for _, name := range []string{authpkg.SecureSessionCookieName, authpkg.SessionCookieName} {
		cookie, err := r.Cookie(name)
		if err == nil && strings.TrimSpace(cookie.Value) != "" {
			return false
		}
	}
	return true
}

func withActiveAuthUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := activeUserAfterRateLimitPaths[r.URL.Path]; ok {
			next.ServeHTTP(w, r)
			return
		}
		verifyActiveAuthUser(next).ServeHTTP(w, r)
	})
}

func withActiveAuthUserAfterRateLimit(next http.HandlerFunc) http.HandlerFunc {
	return verifyActiveAuthUser(next).ServeHTTP
}

func verifyActiveAuthUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := authhandler.GetAuthenticatedUser(r)
		if user == nil {
			next.ServeHTTP(w, r)
			return
		}

		if user.ID <= 0 || user.ID > math.MaxInt32 {
			w.Header().Set("X-TaskForce-Auth-Status", "invalid-user")
			w.Header().Del("X-TaskForce-User-ID")
			next.ServeHTTP(w, scrubAuthenticatedUser(r))
			return
		}
		dbUserID := int32(user.ID)

		q, err := authhandler.ResolveQueries(r.Context(), nil)
		if err != nil {
			authhandler.GetLogger().Warn("Failed to verify active auth user", map[string]any{
				"error":   err.Error(),
				"user_id": user.ID,
			})
			w.Header().Set("X-TaskForce-Auth-Status", "verification-unavailable")
			w.Header().Del("X-TaskForce-User-ID")
			authhandler.JSONError(w, http.StatusServiceUnavailable, "Authentication verification unavailable")
			return
		}

		dbUser, err := q.GetUserByID(r.Context(), dbUserID)
		switch {
		case err == nil && !dbUser.Disabled:
			next.ServeHTTP(w, r)
			return
		case err == nil && dbUser.Disabled:
			authhandler.GetLogger().Warn("Dropping auth context for disabled user", map[string]any{
				"user_id": user.ID,
				"email":   user.Email,
			})
			w.Header().Set("X-TaskForce-Auth-Status", "disabled-user")
			w.Header().Del("X-TaskForce-User-ID")
			next.ServeHTTP(w, scrubAuthenticatedUser(r))
			return
		case errors.Is(err, pgx.ErrNoRows):
			authhandler.GetLogger().Warn("Dropping auth context for missing user", map[string]any{
				"user_id": user.ID,
				"email":   user.Email,
			})
			w.Header().Set("X-TaskForce-Auth-Status", "user-not-found")
			w.Header().Del("X-TaskForce-User-ID")
			next.ServeHTTP(w, scrubAuthenticatedUser(r))
			return
		default:
			authhandler.GetLogger().Warn("Failed to load auth user record", map[string]any{
				"error":   err.Error(),
				"user_id": user.ID,
			})
			w.Header().Set("X-TaskForce-Auth-Status", "verification-unavailable")
			w.Header().Del("X-TaskForce-User-ID")
			authhandler.JSONError(w, http.StatusServiceUnavailable, "Authentication verification unavailable")
			return
		}
	})
}

func scrubAuthenticatedUser(r *http.Request) *http.Request {
	ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, (*adapterauth.AuthenticatedUser)(nil))
	ctx = context.WithValue(ctx, adapterhandler.UserIDContextKey, 0)
	ctx = context.WithValue(ctx, adapterhandler.EmailContextKey, "")
	ctx = context.WithValue(ctx, adapterhandler.OrgIDContextKey, 0)
	ctx = context.WithValue(ctx, adapterhandler.TokenIssuedAtContextKey, int64(0))

	return r.WithContext(ctx)
}

func handleEnvCheck(w http.ResponseWriter, r *http.Request) {
	if !adapterhandler.DebugEnabled() {
		authhandler.JSONError(w, http.StatusNotFound, "Not found")
		return
	}
	authhandler.JSON(w, http.StatusOK, buildEnvCheckPayload())
}

func buildSessionDebugPayload() map[string]any {
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	return map[string]any{
		"debug":                true,
		"has_google_client_id": clientID != "",
		"auth_url":             os.Getenv("AUTH_URL"),
	}
}

func buildEnvCheckPayload() map[string]any {
	clientID := os.Getenv("GOOGLE_CLIENT_ID")
	prefix := ""
	if len(clientID) > 10 {
		prefix = clientID[:10] + "..."
	}
	return map[string]any{
		"has_google_client_id": clientID != "",
		"has_auth_url":         os.Getenv("AUTH_URL") != "",
		"has_auth_secret":      os.Getenv("AUTH_SECRET") != "",
		"client_id_prefix":     prefix,
	}
}

func handlePingCheck(w http.ResponseWriter, r *http.Request) {
	authhandler.JSON(w, http.StatusOK, map[string]any{"status": "ok", "path": r.URL.Path})
}

func handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	if !adapterhandler.RequireAuthenticatedDeepHealth(w, r) {
		return
	}
	adapterhandler.WriteDatabaseHealth(w, r, "1.0.0", postgres.GetPool)
}
