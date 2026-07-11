package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/server/topology"
	"github.com/stretchr/testify/assert"
)

func TestProxyHandlers(t *testing.T) {
	// Setup a mock target server that echoes the request path
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("reached target"))
	}))
	defer target.Close()

	tests := []struct {
		name    string
		handler http.HandlerFunc
		envVar  string
	}{
		{
			name:    "AuthProxy",
			handler: ProxyAuthHandler,
			envVar:  "AUTH_SERVICE_URL",
		},
		{
			name:    "BillingProxy",
			handler: ProxyBillingHandler,
			envVar:  "BILLING_SERVICE_URL",
		},
		{
			name:    "DeveloperProxy",
			handler: ProxyDeveloperHandler,
			envVar:  "DEVELOPER_SERVICE_URL",
		},
		{
			name:    "EngineProxy",
			handler: ProxyEngineHandler,
			envVar:  "ENGINE_SERVICE_URL",
		},
		{
			name:    "SyncProxy",
			handler: ProxySyncHandler,
			envVar:  "SYNC_SERVICE_URL",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Point the specific service env var to our mock target
			t.Setenv(tc.envVar, target.URL)

			req := httptest.NewRequest("GET", "/api/test", nil)
			w := httptest.NewRecorder()

			tc.handler(w, req)

			resp := w.Result()
			assert.Equal(t, http.StatusOK, resp.StatusCode)

			body, _ := io.ReadAll(resp.Body)
			assert.Equal(t, "reached target", string(body))
		})
	}
}

func TestProxyTopology_DefaultPortsMatchServiceTopology(t *testing.T) {
	assert.Equal(t, "http://localhost:3006", topology.Get(topology.Engine).LocalURL)
	assert.Equal(t, "3006", topology.Get(topology.Engine).DefaultPort)
	assert.Equal(t, "http://localhost:3005", topology.Get(topology.Sync).LocalURL)
	assert.Equal(t, "3005", topology.Get(topology.Sync).DefaultPort)
}

func TestCoreServiceProxyAuthRouteDoesNotMatchPartialPrefix(t *testing.T) {
	authRoute := CoreServiceProxyRoutes[0]

	assert.True(t, authRoute.matches("/api/v1/auth"))
	assert.True(t, authRoute.matches("/api/v1/auth/callback"))
	assert.False(t, authRoute.matches("/api/v1/authanything"))
}

func TestProxyCoreServiceRoute(t *testing.T) {
	original := ProxyAuthHandler
	t.Cleanup(func() { ProxyAuthHandler = original })
	CoreServiceProxyRoutes[0].Handler = func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusAccepted)
	}
	t.Cleanup(func() { CoreServiceProxyRoutes[0].Handler = original })

	resp := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/session", nil)

	assert.True(t, ProxyCoreServiceRoute(resp, req))
	assert.Equal(t, http.StatusAccepted, resp.Code)

	miss := httptest.NewRecorder()
	assert.False(t, ProxyCoreServiceRoute(miss, httptest.NewRequest(http.MethodGet, "/api/v1/unknown", nil)))
}

func TestRegisterLimitedRoutes(t *testing.T) {
	mux := &testLimitedRouteMux{handlers: map[string]http.Handler{}}
	RegisterLimitedRoutes(mux, []LimitedRoute{{
		Path: "/limited",
		Limit: func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("X-Limited", "yes")
				next.ServeHTTP(w, r)
			})
		},
		Func: func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		},
	}})

	resp := httptest.NewRecorder()
	mux.handlers["/limited"].ServeHTTP(resp, httptest.NewRequest(http.MethodGet, "/limited", nil))

	assert.Equal(t, http.StatusNoContent, resp.Code)
	assert.Equal(t, "yes", resp.Header().Get("X-Limited"))
}

func TestRegisterMethodRoutes(t *testing.T) {
	mux := &testMethodRouteMux{handlers: map[string]http.HandlerFunc{}}
	RegisterMethodRoutes(mux, []MethodRoute{{
		Method: http.MethodPost,
		Path:   "/items",
		Func: func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusCreated)
		},
	}})

	resp := httptest.NewRecorder()
	mux.handlers[http.MethodPost+" /items"](resp, httptest.NewRequest(http.MethodPost, "/items", nil))

	assert.Equal(t, http.StatusCreated, resp.Code)
}

type testLimitedRouteMux struct {
	handlers map[string]http.Handler
}

func (m *testLimitedRouteMux) Handle(path string, handler http.Handler) {
	m.handlers[path] = handler
}

type testMethodRouteMux struct {
	handlers map[string]http.HandlerFunc
}

func (m *testMethodRouteMux) MethodFunc(method, path string, handler http.HandlerFunc) {
	m.handlers[method+" "+path] = handler
}
