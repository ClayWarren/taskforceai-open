package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestHandleNoContent(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()

	HandleNoContent(w, req)

	resp := w.Result()
	assert.Equal(t, http.StatusNoContent, resp.StatusCode)
}

func TestHandleRobots(t *testing.T) {
	req := httptest.NewRequest("GET", "/robots.txt", nil)
	w := httptest.NewRecorder()

	HandleRobots(w, req)

	resp := w.Result()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

func TestCommonRoutesIncludeAPINoisePaths(t *testing.T) {
	routes := CommonRoutes()
	patterns := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		patterns[route.Pattern] = struct{}{}
	}

	for _, expected := range []string{
		"/api",
		"/api/",
		"/api/favicon.ico",
		"/api/favicon.png",
		"/api/favicon-32x32.png",
		"/api/robots.txt",
		"/api/sitemap.xml",
	} {
		_, ok := patterns[expected]
		assert.Truef(t, ok, "expected common route %q to be registered", expected)
	}
}

func TestServiceHeader(t *testing.T) {
	handler := ServiceHeader("unit-service")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, "unit-service", resp.Header().Get("X-TaskForce-Service"))
}

func TestRegisterCommonRoutes(t *testing.T) {
	mux := &testCommonRouteMux{handlers: map[string]http.HandlerFunc{}}
	RegisterCommonRoutes(mux)

	resp := httptest.NewRecorder()
	mux.handlers["/api/robots.txt"](resp, httptest.NewRequest(http.MethodGet, "/api/robots.txt", nil))

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, "text/plain", resp.Header().Get("Content-Type"))
	assert.Contains(t, resp.Body.String(), "Disallow: /")
}

type testCommonRouteMux struct {
	handlers map[string]http.HandlerFunc
}

func (m *testCommonRouteMux) HandleFunc(pattern string, handler http.HandlerFunc) {
	m.handlers[pattern] = handler
}

func TestRegisterNotFound(t *testing.T) {
	mux := &testNotFoundMux{}
	RegisterNotFound(mux, "unit-service", "missing: ")

	req := httptest.NewRequest(http.MethodGet, "/not-here?__path=/original", nil)
	req.Header.Set("X-Matched-Path", "/api/:path")
	resp := httptest.NewRecorder()
	mux.handler(resp, req)

	assert.Equal(t, http.StatusNotFound, resp.Code)
	assert.Contains(t, resp.Body.String(), "missing: /not-here")
}

type testNotFoundMux struct {
	handler http.HandlerFunc
}

func (m *testNotFoundMux) NotFound(handler http.HandlerFunc) {
	m.handler = handler
}
