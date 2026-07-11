package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInitObservabilityWithCallsConfiguredInitializers(t *testing.T) {
	var tracerService string
	var meterService string

	InitObservabilityWith(
		"unit-service",
		func(serviceName string) (func(), error) {
			tracerService = serviceName
			return nil, nil
		},
		func(serviceName string) (func(), error) {
			meterService = serviceName
			return nil, nil
		},
	)

	assert.Equal(t, "unit-service", tracerService)
	assert.Equal(t, "unit-service", meterService)
}

func TestInitObservabilityWithToleratesMissingAndFailedInitializers(t *testing.T) {
	require.NotPanics(t, func() {
		InitObservabilityWith(
			"unit-service",
			func(string) (func(), error) {
				return nil, errors.New("tracer unavailable")
			},
			func(string) (func(), error) {
				return nil, errors.New("meter unavailable")
			},
		)
	})
}

func TestInitObservabilityAsync(t *testing.T) {
	t.Setenv("OTEL_SDK_DISABLED", "true")

	require.NotPanics(t, func() {
		InitObservabilityAsync("unit-service")
	})
}

func TestInitObservabilityWithNoInitializers(t *testing.T) {
	require.NotPanics(t, func() {
		InitObservabilityWith("unit-service", nil, nil)
	})
}

func TestInitObservabilityWithTelemetryDisabled(t *testing.T) {
	t.Setenv("OTEL_SDK_DISABLED", "true")

	require.NotPanics(t, func() {
		InitObservability("unit-service")
	})
}

func TestSecureObservedHandlerAppliesStandardHeadersAndCorrelation(t *testing.T) {
	handler := SecureObservedHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), "UnitHandler", false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/unit", nil)
	req.Header.Set("X-Correlation-ID", "request-123")
	resp := httptest.NewRecorder()

	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, "request-123", resp.Header().Get("X-Correlation-ID"))
	assert.Equal(t, "nosniff", resp.Header().Get("X-Content-Type-Options"))
}

func TestSecureObservedFuncUsesPerRequestHandler(t *testing.T) {
	responseBody := "first"
	handler := SecureObservedFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(responseBody))
	}, "UnitHandler", false)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/unit", nil)
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, req)

	responseBody = "second"
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, req)

	assert.Equal(t, "first", first.Body.String())
	assert.Equal(t, "second", second.Body.String())
}

func TestSecureObservedHandlerCanEnforceCSRF(t *testing.T) {
	handler := SecureObservedHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), "UnitHandler", true)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/unit", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.AddCookie(&http.Cookie{Name: "session_token", Value: "session"})
	resp := httptest.NewRecorder()

	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
	assert.Contains(t, resp.Body.String(), "CSRF token missing")
}

func TestSecureObservedHandlerUsesNotFoundForNilHandler(t *testing.T) {
	handler := SecureObservedHandler(nil, "UnitHandler", false)

	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
}

func TestSecurityHandlerCanSkipCSRF(t *testing.T) {
	handler := SecurityHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}), false)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/unit", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.AddCookie(&http.Cookie{Name: "session_token", Value: "session"})
	resp := httptest.NewRecorder()

	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, "nosniff", resp.Header().Get("X-Content-Type-Options"))
}

func TestSecurityHandlerUsesNotFoundForNilHandler(t *testing.T) {
	handler := SecurityHandler(nil, false)

	req := httptest.NewRequest(http.MethodGet, "/missing", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
	assert.Equal(t, "nosniff", resp.Header().Get("X-Content-Type-Options"))
}

func TestCORSMiddlewareHandlesPreflight(t *testing.T) {
	called := false
	handler := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/unit", nil)
	req.Header.Set("Origin", "https://www.taskforceai.chat")
	resp := httptest.NewRecorder()

	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, "https://www.taskforceai.chat", resp.Header().Get("Access-Control-Allow-Origin"))
	assert.False(t, called)
}

func TestCORSMiddlewarePassesThroughNonCORSRequests(t *testing.T) {
	called := false
	handler := CORSMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusAccepted)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/unit", nil)
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusAccepted, resp.Code)
	assert.True(t, called)
}

func TestSecurityHeadersMiddlewareAppliesHeaders(t *testing.T) {
	handler := SecurityHeadersMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/unit", nil)
	resp := httptest.NewRecorder()

	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, "nosniff", resp.Header().Get("X-Content-Type-Options"))
}

func TestCSRFMiddlewareEnforcesStateChangingBrowserRequests(t *testing.T) {
	handler := CSRFMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/unit", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.AddCookie(&http.Cookie{Name: "session_token", Value: "session"})
	resp := httptest.NewRecorder()

	handler.ServeHTTP(resp, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}
