package handler

import (
	"net/http"
	"os"
	"strings"
)

// WithRecovery is middleware that recovers from panics and logs the error.
func WithRecovery(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				getPanicReporter().ReportRequestPanic(r, err)

				GetLogger().Error("Panic recovered", map[string]any{
					"error": err,
					"path":  r.URL.Path,
				})
				JSONError(w, http.StatusInternalServerError, "Internal server error")
			}
		}()
		next(w, r)
	}
}

// WithCSRF is middleware that validates a CSRF token for state-changing requests.
// Implements the Double Submit Cookie pattern for browser-based clients.
func WithCSRF(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 1. Exempt safe methods
		if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions || r.Method == http.MethodTrace {
			next(w, r)
			return
		}

		// 2. Known webhook endpoints are exempt
		path := r.URL.Path
		if isWebhookCSRFExemptPath(path) {
			next(w, r)
			return
		}
		if isLocalTestLoginCSRFExemptPath(path) {
			next(w, r)
			return
		}
		if isNativeOAuthTokenExchangePath(path) {
			next(w, r)
			return
		}

		// 3. Client Check: Non-browser clients (TUI, Mobile, Desktop) are exempt from CSRF
		// because they don't automatically send session cookies and are not vulnerable to CSRF attacks.
		// Header-only auth is exempt only when no session auth cookie is present.
		ua := r.Header.Get("User-Agent")
		hasSessionCookie := hasSessionAuthCookie(r)
		authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
		hasBearerToken := strings.HasPrefix(strings.ToLower(authHeader), "bearer ") && len(strings.TrimSpace(authHeader[len("Bearer "):])) > 0
		hasAPIKey := strings.TrimSpace(r.Header.Get("x-api-key")) != ""
		hasHeaderOnlyAuth := (hasBearerToken || hasAPIKey) && !hasSessionCookie
		isNonBrowser := strings.Contains(ua, "taskforceai-cli") ||
			strings.Contains(ua, "TaskForceAI-Desktop") ||
			strings.Contains(ua, "TaskForceAI-Mobile") ||
			hasHeaderOnlyAuth

		if isNonBrowser {
			next(w, r)
			return
		}

		// 4. Browser-based CSRF Validation (Double Submit Cookie)
		csrfToken := r.Header.Get("X-CSRF-Token")
		if csrfToken == "" {
			GetLogger().Warn("CSRF token missing", map[string]any{
				"path":              r.URL.Path,
				"method":            r.Method,
				"ua":                ua,
				"hasSessionCookie":  hasSessionCookie,
				"hasBearerToken":    hasBearerToken,
				"hasAPIKey":         hasAPIKey,
				"hasHeaderOnlyAuth": hasHeaderOnlyAuth,
			})
			JSONError(w, http.StatusForbidden, "CSRF token missing")
			return
		}

		cookie, err := r.Cookie("csrf_token")
		if err != nil {
			GetLogger().Warn("CSRF cookie missing", map[string]any{
				"path":              r.URL.Path,
				"method":            r.Method,
				"ua":                ua,
				"hasSessionCookie":  hasSessionCookie,
				"hasBearerToken":    hasBearerToken,
				"hasAPIKey":         hasAPIKey,
				"hasHeaderOnlyAuth": hasHeaderOnlyAuth,
			})
			JSONError(w, http.StatusForbidden, "CSRF cookie missing")
			return
		}

		if cookie.Value != csrfToken {
			GetLogger().Warn("CSRF token mismatch", csrfMismatchMetadata(r.URL.Path, csrfToken, cookie.Value))
			JSONError(w, http.StatusForbidden, "CSRF token mismatch")
			return
		}

		next(w, r)
	}
}

func hasSessionAuthCookie(r *http.Request) bool {
	cookieNames := []string{"__Secure-session_token", "session_token"}
	for _, name := range cookieNames {
		if cookie, err := r.Cookie(name); err == nil && strings.TrimSpace(cookie.Value) != "" {
			return true
		}
	}

	return false
}

func isWebhookCSRFExemptPath(path string) bool {
	return strings.HasPrefix(path, "/api/v1/auth/webhooks/") ||
		path == "/api/v1/auth/webhooks" ||
		path == "/api/inngest" ||
		strings.HasPrefix(path, "/api/inngest/") ||
		path == "/api/v1/payments/webhook" ||
		path == "/api/v1/payments/webhook/revenuecat"
}

func isLocalTestLoginCSRFExemptPath(path string) bool {
	if path != "/api/v1/auth/test-login" {
		return false
	}
	if IsProductionEnv() {
		return false
	}
	return isGoTestBinary() &&
		strings.EqualFold(strings.TrimSpace(os.Getenv("GO_ENV")), "test") &&
		strings.EqualFold(strings.TrimSpace(os.Getenv("ENABLE_TEST_LOGIN")), "true")
}

func isGoTestBinary() bool {
	return strings.HasSuffix(os.Args[0], ".test")
}

func isNativeOAuthTokenExchangePath(path string) bool {
	return path == "/api/v1/auth/apple" || path == "/api/v1/auth/google"
}

func csrfMismatchMetadata(path, headerToken, cookieToken string) map[string]any {
	return map[string]any{
		"path":             path,
		"headerPresent":    headerToken != "",
		"cookiePresent":    cookieToken != "",
		"headerLength":     len(headerToken),
		"cookieLength":     len(cookieToken),
		"valuesEqual":      headerToken == cookieToken,
		"mismatchDetected": true,
	}
}

// WithSecurityHeaders adds standard security headers to the response.
func WithSecurityHeaders(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "0")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		// Content Security Policy - Scope to HTML only
		accept := r.Header.Get("Accept")
		if strings.Contains(accept, "text/html") {
			// Relaxed policy for the web app
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-ancestors 'none';")
		} else {
			// For non-HTML (API/JSON), use a highly restrictive policy if any
			w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none';")
		}

		// HSTS (1 year)
		if IsProductionEnv() {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
		}

		next(w, r)
	}
}
