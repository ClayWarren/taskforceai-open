package handler

import (
	"log/slog"
	"net/http"

	"github.com/TaskForceAI/adapters/pkg/observability"
)

// InitObservability starts tracing and metrics for a service in environments
// where shutdown hooks are managed by the platform.
func InitObservability(serviceName string) {
	InitObservabilityWith(serviceName, observability.InitTracer, observability.InitMeter)
}

// InitObservabilityAsync starts tracing and metrics without blocking request
// router initialization.
func InitObservabilityAsync(serviceName string) {
	Go(serviceName+"_observabilityInit", func() {
		InitObservability(serviceName)
	})
}

// InitObservabilityWith allows tests and service-specific bootstraps to inject
// observability initializers while keeping production logging consistent.
func InitObservabilityWith(
	serviceName string,
	initTracer func(string) (func(), error),
	initMeter func(string) (func(), error),
) {
	if initTracer != nil {
		if _, err := initTracer(serviceName); err != nil {
			slog.Warn("Failed to initialize tracer", "service", serviceName, "error", err)
		}
	}
	if initMeter != nil {
		if _, err := initMeter(serviceName); err != nil {
			slog.Warn("Failed to initialize meter", "service", serviceName, "error", err)
		}
	}
}

// SecureObservedHandler composes the standard Vercel request middleware used by
// Go API services: panic recovery, correlation IDs, security headers, optional
// CSRF validation, and an OpenTelemetry span around service work.
func SecureObservedHandler(next http.Handler, spanName string, csrf bool) http.Handler {
	if next == nil {
		next = http.NotFoundHandler()
	}
	return SecureObservedFunc(next.ServeHTTP, spanName, csrf)
}

// SecureObservedFunc is the function-form variant of SecureObservedHandler.
// Use it when the service needs to choose the active handler per request.
func SecureObservedFunc(next http.HandlerFunc, spanName string, csrf bool) http.Handler {
	handler := SecurityFunc(next, csrf)
	traced := observability.WithTracingFunc(handler, spanName)
	return WithRecovery(WithCorrelationID(traced.ServeHTTP))
}

// SecurityHandler composes security headers and optional CSRF enforcement.
func SecurityHandler(next http.Handler, csrf bool) http.Handler {
	if next == nil {
		next = http.NotFoundHandler()
	}
	return SecurityFunc(next.ServeHTTP, csrf)
}

// SecurityFunc is the function-form variant of SecurityHandler.
func SecurityFunc(next http.HandlerFunc, csrf bool) http.HandlerFunc {
	handler := next
	if csrf {
		handler = WithCSRF(handler)
	}
	return WithSecurityHeaders(handler)
}

// CORSMiddleware adapts HandleCORS to router middleware.
func CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if HandleCORS(w, r) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

// SecurityHeadersMiddleware adapts WithSecurityHeaders to router middleware.
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return WithSecurityHeaders(next.ServeHTTP)
}

// CSRFMiddleware adapts WithCSRF to router middleware.
func CSRFMiddleware(next http.Handler) http.Handler {
	return WithCSRF(next.ServeHTTP)
}
