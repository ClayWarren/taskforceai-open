package conversations

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func serveRequest(t *testing.T, handler http.Handler, expectedStatus int, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	assert.Equal(t, expectedStatus, response.Code)
	return response
}

func serveJSONRequest(t *testing.T, handler http.Handler, expectedStatus int, method, target string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, body)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	assert.Equal(t, expectedStatus, response.Code)
	return response
}
