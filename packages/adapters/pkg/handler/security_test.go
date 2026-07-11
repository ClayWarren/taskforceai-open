package handler

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWithRecovery(t *testing.T) {
	reporter := &testBackgroundPanicReporter{}
	SetPanicReporter(reporter)
	t.Cleanup(ResetPanicReporterForTest)

	next := WithRecovery(func(w http.ResponseWriter, r *http.Request) {
		panic("test panic")
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	assert.NotPanics(t, func() {
		next(rec, req)
	})
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Same(t, req, reporter.request)
	assert.Equal(t, "test panic", reporter.requestRecovered)
}

func TestWithCSRF(t *testing.T) {
	next := WithCSRF(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	// 1. GET is exempt
	reqGet := httptest.NewRequest(http.MethodGet, "/", nil)
	rec1 := httptest.NewRecorder()
	next(rec1, reqGet)
	assert.Equal(t, http.StatusNoContent, rec1.Code)

	// 2. POST without token
	reqPost := httptest.NewRequest(http.MethodPost, "/", nil)
	rec2 := httptest.NewRecorder()
	next(rec2, reqPost)
	assert.Equal(t, http.StatusForbidden, rec2.Code)

	// 3. POST with non-browser UA
	reqUA := httptest.NewRequest(http.MethodPost, "/", nil)
	reqUA.Header.Set("User-Agent", "taskforceai-cli/1.0")
	rec3 := httptest.NewRecorder()
	next(rec3, reqUA)
	assert.Equal(t, http.StatusNoContent, rec3.Code)

	// 4. POST with Double Submit Cookie success
	reqDSC := httptest.NewRequest(http.MethodPost, "/", nil)
	reqDSC.Header.Set("X-CSRF-Token", "secret")
	reqDSC.AddCookie(&http.Cookie{Name: "csrf_token", Value: "secret"})
	rec4 := httptest.NewRecorder()
	next(rec4, reqDSC)
	assert.Equal(t, http.StatusNoContent, rec4.Code)

	// 5. Webhook endpoint is exempt
	reqWebhook := httptest.NewRequest(http.MethodPost, "/api/v1/auth/webhooks/workos", nil)
	rec5 := httptest.NewRecorder()
	next(rec5, reqWebhook)
	assert.Equal(t, http.StatusNoContent, rec5.Code)

	// 6. Inngest callback is signed separately and is exempt from browser CSRF
	reqInngest := httptest.NewRequest(http.MethodPost, "/api/inngest", nil)
	recInngest := httptest.NewRecorder()
	next(recInngest, reqInngest)
	assert.Equal(t, http.StatusNoContent, recInngest.Code)

	reqInngestServe := httptest.NewRequest(http.MethodPut, "/api/inngest/serve", nil)
	recInngestServe := httptest.NewRecorder()
	next(recInngestServe, reqInngestServe)
	assert.Equal(t, http.StatusNoContent, recInngestServe.Code)

	// 7. Native OAuth token exchange endpoints are exempt because native clients do not use browser CSRF cookies.
	reqApple := httptest.NewRequest(http.MethodPost, "/api/v1/auth/apple", nil)
	recApple := httptest.NewRecorder()
	next(recApple, reqApple)
	assert.Equal(t, http.StatusNoContent, recApple.Code)

	reqGoogle := httptest.NewRequest(http.MethodPost, "/api/v1/auth/google", nil)
	recGoogle := httptest.NewRecorder()
	next(recGoogle, reqGoogle)
	assert.Equal(t, http.StatusNoContent, recGoogle.Code)

	// 8. Non-webhook route that contains /webhooks/ in a path parameter is NOT exempt
	reqBypass := httptest.NewRequest(http.MethodPost, "/api/v1/messages/webhooks/feedback", nil)
	rec6 := httptest.NewRecorder()
	next(rec6, reqBypass)
	assert.Equal(t, http.StatusForbidden, rec6.Code)

	reqCookieMissing := httptest.NewRequest(http.MethodPost, "/", nil)
	reqCookieMissing.Header.Set("X-CSRF-Token", "secret")
	recCookieMissing := httptest.NewRecorder()
	next(recCookieMissing, reqCookieMissing)
	assert.Equal(t, http.StatusForbidden, recCookieMissing.Code)

	reqMismatch := httptest.NewRequest(http.MethodPost, "/", nil)
	reqMismatch.Header.Set("X-CSRF-Token", "secret")
	reqMismatch.AddCookie(&http.Cookie{Name: "csrf_token", Value: "other"})
	recMismatch := httptest.NewRecorder()
	next(recMismatch, reqMismatch)
	assert.Equal(t, http.StatusForbidden, recMismatch.Code)
}

func TestIsWebhookCSRFExemptPath(t *testing.T) {
	assert.True(t, isWebhookCSRFExemptPath("/api/v1/auth/webhooks/workos"))
	assert.True(t, isWebhookCSRFExemptPath("/api/inngest"))
	assert.True(t, isWebhookCSRFExemptPath("/api/inngest/serve"))
	assert.True(t, isWebhookCSRFExemptPath("/api/v1/payments/webhook"))
	assert.True(t, isWebhookCSRFExemptPath("/api/v1/payments/webhook/revenuecat"))

	assert.False(t, isWebhookCSRFExemptPath("/api/v1/messages/webhooks/feedback"))
	assert.False(t, isWebhookCSRFExemptPath("/api/v1/projects/webhooks/create"))
}

func TestWithCSRF_LocalTestLoginExemptionRequiresExplicitMode(t *testing.T) {
	next := WithCSRF(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/test-login", nil)
	rec := httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code)

	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/test-login", nil)
	rec = httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)

	t.Setenv("VERCEL", "1")
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/test-login", nil)
	rec = httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestIsLocalTestLoginCSRFExemptPath(t *testing.T) {
	assert.False(t, isLocalTestLoginCSRFExemptPath("/api/v1/auth/test-login"))
	assert.False(t, isLocalTestLoginCSRFExemptPath("/api/v1/auth/test-login/extra"))

	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	assert.True(t, isLocalTestLoginCSRFExemptPath("/api/v1/auth/test-login"))

	t.Setenv("VERCEL", "1")
	assert.False(t, isLocalTestLoginCSRFExemptPath("/api/v1/auth/test-login"))
}

func TestIsNativeOAuthTokenExchangePath(t *testing.T) {
	assert.True(t, isNativeOAuthTokenExchangePath("/api/v1/auth/apple"))
	assert.True(t, isNativeOAuthTokenExchangePath("/api/v1/auth/google"))
	assert.False(t, isNativeOAuthTokenExchangePath("/api/v1/auth/apple/extra"))
	assert.False(t, isNativeOAuthTokenExchangePath("/api/v1/auth/logout"))
}

func TestWithCSRF_DoesNotBypassOnSpoofableHeadersWithSessionCookie(t *testing.T) {
	next := WithCSRF(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	t.Run("NonBearerAuthorizationWithSessionCookie", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.Header.Set("Authorization", "Basic Zm9vOmJhcg==")
		req.AddCookie(&http.Cookie{Name: "session_token", Value: "session"})
		rec := httptest.NewRecorder()

		next(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("BearerWithSessionCookieStillRequiresCSRF", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.Header.Set("Authorization", "Bearer tfai_test")
		req.AddCookie(&http.Cookie{Name: "session_token", Value: "session"})
		rec := httptest.NewRecorder()

		next(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("BearerWithoutSessionCookieBypassesCSRF", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.Header.Set("Authorization", "Bearer tfai_test")
		rec := httptest.NewRecorder()

		next(rec, req)
		assert.Equal(t, http.StatusNoContent, rec.Code)
	})
}

func TestWithSecurityHeaders(t *testing.T) {
	next := WithSecurityHeaders(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	next(rec, req)

	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "DENY", rec.Header().Get("X-Frame-Options"))
	assert.Equal(t, "0", rec.Header().Get("X-XSS-Protection"))

	htmlReq := httptest.NewRequest(http.MethodGet, "/", nil)
	htmlReq.Header.Set("Accept", "text/html")
	htmlRec := httptest.NewRecorder()
	next(htmlRec, htmlReq)
	assert.Contains(t, htmlRec.Header().Get("Content-Security-Policy"), "script-src")

	t.Setenv("NODE_ENV", "production")
	prodReq := httptest.NewRequest(http.MethodGet, "/", nil)
	prodRec := httptest.NewRecorder()
	next(prodRec, prodReq)
	assert.Contains(t, prodRec.Header().Get("Strict-Transport-Security"), "max-age=31536000")
}

func TestCSRFMismatchMetadata_DoesNotExposeTokenValues(t *testing.T) {
	meta := csrfMismatchMetadata("/api/update", "header-secret", "cookie-secret")

	assert.Equal(t, "/api/update", meta["path"])
	assert.Equal(t, true, meta["headerPresent"])
	assert.Equal(t, true, meta["cookiePresent"])
	assert.Equal(t, len("header-secret"), meta["headerLength"])
	assert.Equal(t, len("cookie-secret"), meta["cookieLength"])
	assert.Equal(t, false, meta["valuesEqual"])
	assert.Equal(t, true, meta["mismatchDetected"])

	assert.NotContains(t, fmt.Sprintf("%v", meta), "header-secret")
	assert.NotContains(t, fmt.Sprintf("%v", meta), "cookie-secret")
	_, hasHeaderValue := meta["header"]
	_, hasCookieValue := meta["cookie"]
	assert.False(t, hasHeaderValue)
	assert.False(t, hasCookieValue)
}
