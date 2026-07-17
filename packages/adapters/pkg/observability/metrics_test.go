package observability

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeMetricRoute(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/users/123/messages/abc123def4567890abcdef12", nil)
	assert.Equal(t, "/api/users/:id/messages/:id", normalizeMetricRouteWithStatus(req, http.StatusOK))

	patternReq := httptest.NewRequest("GET", "/api/users/123", nil)
	patternReq.Pattern = "/api/users/{id}"
	assert.Equal(t, "/api/users/{id}", normalizeMetricRouteWithStatus(patternReq, http.StatusOK))

	rootReq := httptest.NewRequest("GET", "/", nil)
	assert.Equal(t, "/", normalizeMetricRouteWithStatus(rootReq, http.StatusOK))

	assert.Equal(t, "/", normalizeMetricRouteWithStatus(&http.Request{}, http.StatusOK))

	notFoundReq := httptest.NewRequest("GET", "/attacker-controlled/random/path", nil)
	assert.Equal(t, "unmatched", normalizeMetricRouteWithStatus(notFoundReq, http.StatusNotFound))

	assert.Equal(t, "unknown", normalizeMetricRouteWithStatus(nil, http.StatusOK))
}

func TestResponseWriterCapturesStatusAndUnwraps(t *testing.T) {
	rec := httptest.NewRecorder()
	rw := &responseWriter{ResponseWriter: rec, statusCode: http.StatusOK}

	rw.WriteHeader(http.StatusCreated)
	rw.WriteHeader(http.StatusInternalServerError)

	assert.Equal(t, http.StatusCreated, rw.statusCode)
	assert.True(t, rw.written)
	assert.Equal(t, rec, rw.Unwrap())
}

func TestResponseWriterWriteDefaultsStatusOK(t *testing.T) {
	rec := httptest.NewRecorder()
	rw := &responseWriter{ResponseWriter: rec, statusCode: http.StatusOK}

	n, err := rw.Write([]byte("ok"))
	require.NoError(t, err)
	assert.Equal(t, 2, n)
	assert.Equal(t, http.StatusOK, rw.statusCode)
	assert.True(t, rw.written)
	assert.Equal(t, "ok", rec.Body.String())
}

func TestWithHTTPMetricsWrapsHandler(t *testing.T) {
	handler := WithHTTPMetrics("test-service")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/users/123", nil))

	assert.Equal(t, http.StatusTeapot, rec.Code)
}
