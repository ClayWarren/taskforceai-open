package handlertest

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type Endpoint struct {
	Name   string
	Method string
	Path   string
	Body   string
}

func ServeStatus(t *testing.T, handler http.Handler, expectedStatus int, method, target string, bodies ...io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if len(bodies) > 0 {
		body = bodies[0]
	}
	request := httptest.NewRequestWithContext(context.Background(), method, target, body)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	require.Equal(t, expectedStatus, response.Code)
	return response
}

func ServeEndpointStatus(t *testing.T, handler http.Handler, expectedStatus int, endpoint Endpoint) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if endpoint.Body != "" {
		body = strings.NewReader(endpoint.Body)
	}
	return ServeStatus(t, handler, expectedStatus, endpoint.Method, endpoint.Path, body)
}
