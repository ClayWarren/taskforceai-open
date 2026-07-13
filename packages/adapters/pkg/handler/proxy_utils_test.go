package handler

import (
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRestorePath(t *testing.T) {
	tests := []struct {
		name         string
		queryPath    string
		matchedPath  string
		forwardedUri string
		initialPath  string
		expectedPath string
		trustHeaders bool
	}{
		{
			name:         "Vercel query param on index path",
			queryPath:    "/v1/users",
			initialPath:  "/api/index",
			expectedPath: "/api/v1/users",
		},
		{
			name:         "Vercel query param on Go API index path",
			queryPath:    "v1/users",
			initialPath:  "/apps/auth/api/index.go",
			expectedPath: "/api/v1/users",
		},
		{
			name:         "Vercel query param on root Go API index path",
			queryPath:    "v1/users",
			initialPath:  "/api/index.go",
			expectedPath: "/api/v1/users",
		},
		{
			name:         "Ignore query override on concrete API path",
			queryPath:    "/v1/users",
			initialPath:  "/api/v1/developer/keys",
			expectedPath: "/api/v1/developer/keys",
		},
		{
			name:         "X-Matched-Path ignored by default",
			matchedPath:  "/api/v1/projects",
			initialPath:  "/api",
			expectedPath: "/api",
		},
		{
			name:         "X-Forwarded-Uri ignored by default",
			forwardedUri: "/api/v1/billing",
			initialPath:  "/api",
			expectedPath: "/api",
		},
		{
			name:         "X-Matched-Path with trusted headers",
			matchedPath:  "/api/v1/projects",
			initialPath:  "/api",
			expectedPath: "/api/v1/projects",
			trustHeaders: true,
		},
		{
			name:         "X-Forwarded-Uri with trusted headers",
			forwardedUri: "/api/v1/billing",
			initialPath:  "/api",
			expectedPath: "/api/v1/billing",
			trustHeaders: true,
		},
		{
			name:         "Canonicalize double slashes",
			initialPath:  "/api//v1//users/",
			expectedPath: "/api/v1/users",
		},
		{
			name:         "Reject traversal query path",
			queryPath:    "../admin",
			initialPath:  "/api",
			expectedPath: "/api",
		},
		{
			name:         "Canonicalize trusted matched path traversal",
			matchedPath:  "/api/../admin",
			initialPath:  "/api",
			expectedPath: "/api/admin",
			trustHeaders: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if tc.trustHeaders {
				t.Setenv(trustRewriteHeadersEnv, "true")
			}

			req := httptest.NewRequest("GET", tc.initialPath, nil)
			if tc.queryPath != "" {
				q := req.URL.Query()
				q.Set("__path", tc.queryPath)
				req.URL.RawQuery = q.Encode()
			}
			if tc.matchedPath != "" {
				req.Header.Set("X-Matched-Path", tc.matchedPath)
			}
			if tc.forwardedUri != "" {
				req.Header.Set("X-Forwarded-Uri", tc.forwardedUri)
			}

			RestorePath(req)
			assert.Equal(t, tc.expectedPath, req.URL.Path)
		})
	}
}

func TestProxyPathHelpers(t *testing.T) {
	smallPool := &proxyBufferPool{}
	smallPool.Put(make([]byte, 8))
	assert.Len(t, smallPool.Get(), proxyCopyBufferSize)

	assert.False(t, canRestoreFromQueryPath("/not-api"))
	assert.False(t, shouldTrustRewriteHeaders("/not-api"))

	restored, ok := sanitizeQueryRewritePath("   ")
	assert.False(t, ok)
	assert.Empty(t, restored)

	restored, ok = sanitizeQueryRewritePath("/..")
	assert.False(t, ok)
	assert.Empty(t, restored)

	restored, ok = sanitizeQueryRewritePath("...")
	assert.False(t, ok)
	assert.Empty(t, restored)

	assert.Equal(t, "/", canonicalizeProxyPath(" "))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	assert.Equal(t, "http", forwardedProtoForRequest(req))

	req.TLS = &tls.ConnectionState{}
	assert.Equal(t, "https", forwardedProtoForRequest(req))

	req.TLS = nil
	t.Setenv("VERCEL", "1")
	assert.Equal(t, "https", forwardedProtoForRequest(req))
}

func TestNormalizeVercelPath(t *testing.T) {
	assert.Equal(t, "/api/v1", NormalizeVercelPath("v1"))
	assert.Equal(t, "/api/v1", NormalizeVercelPath("/v1"))
	assert.Equal(t, "/api/v1", NormalizeVercelPath("/api/v1"))
}

func TestProxyToService(t *testing.T) {
	// Setup mock target service
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "core-api", r.Header.Get("X-TaskForce-Proxy"))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("proxied"))
	}))
	defer target.Close()

	// Test 1: Explicit Env Var
	t.Run("EnvVar", func(t *testing.T) {
		t.Setenv("TEST_SERVICE_URL", target.URL)

		req := httptest.NewRequest("GET", "/api/test", nil)
		w := httptest.NewRecorder()

		ProxyToService(w, req, "TEST_SERVICE_URL", "http://prod", "http://local", "TestService")

		resp := w.Result()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Equal(t, "proxied", string(body))
	})

	// Test 2: Local Fallback
	t.Run("LocalFallback", func(t *testing.T) {
		t.Setenv("TEST_SERVICE_URL_2", "")
		_ = os.Unsetenv("VERCEL")
		_ = os.Unsetenv("NODE_ENV")

		req := httptest.NewRequest("GET", "/api/test", nil)
		w := httptest.NewRecorder()

		// Use target.URL as the "local" default
		ProxyToService(w, req, "TEST_SERVICE_URL_2", "http://prod", target.URL, "TestService")

		resp := w.Result()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Equal(t, "proxied", string(body))
	})

	// Test 3: Prod Fallback (simulate env)
	t.Run("ProdFallback", func(t *testing.T) {
		t.Setenv("TEST_SERVICE_URL_3", "")
		t.Setenv("NODE_ENV", "production")

		req := httptest.NewRequest("GET", "/api/test", nil)
		w := httptest.NewRecorder()

		// Use target.URL as the "prod" default
		ProxyToService(w, req, "TEST_SERVICE_URL_3", target.URL, "http://local", "TestService")

		resp := w.Result()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
		body, _ := io.ReadAll(resp.Body)
		assert.Equal(t, "proxied", string(body))
	})

	// Test 4: Invalid URL
	t.Run("InvalidURL", func(t *testing.T) {
		t.Setenv("TEST_SERVICE_URL_4", "://invalid")

		req := httptest.NewRequest("GET", "/api/test", nil)
		w := httptest.NewRecorder()

		ProxyToService(w, req, "TEST_SERVICE_URL_4", "", "", "TestService")

		resp := w.Result()
		assert.Equal(t, http.StatusInternalServerError, resp.StatusCode)
	})

	t.Run("InvalidURLWithoutHost", func(t *testing.T) {
		t.Setenv("TEST_SERVICE_URL_4B", "file:///tmp/service")

		req := httptest.NewRequest("GET", "/api/test", nil)
		w := httptest.NewRecorder()

		ProxyToService(w, req, "TEST_SERVICE_URL_4B", "", "", "TestService")

		resp := w.Result()
		assert.Equal(t, http.StatusInternalServerError, resp.StatusCode)
	})

	// Test 5: Client-provided forwarded chain should not be trusted.
	t.Run("SanitizeForwardedFor", func(t *testing.T) {
		var seenXFF string
		xffTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenXFF = r.Header.Get("X-Forwarded-For")
			w.WriteHeader(http.StatusOK)
		}))
		defer xffTarget.Close()

		t.Setenv("TEST_SERVICE_URL_5", xffTarget.URL)

		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("X-Forwarded-For", "203.0.113.9")
		req.RemoteAddr = "198.51.100.77:12345"
		w := httptest.NewRecorder()

		ProxyToService(w, req, "TEST_SERVICE_URL_5", "", "", "TestService")

		resp := w.Result()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
		assert.NotContains(t, seenXFF, "203.0.113.9")
		assert.Contains(t, seenXFF, "198.51.100.77")
	})

	t.Run("SanitizeForwardedHostAndProto", func(t *testing.T) {
		t.Setenv("TEST_SERVICE_URL_6", "")
		t.Setenv("VERCEL", "")

		var seenXFH string
		var seenXFP string
		forwardingTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenXFH = r.Header.Get("X-Forwarded-Host")
			seenXFP = r.Header.Get("X-Forwarded-Proto")
			w.WriteHeader(http.StatusOK)
		}))
		defer forwardingTarget.Close()

		t.Setenv("TEST_SERVICE_URL_6", forwardingTarget.URL)

		req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
		req.Host = "api.taskforce.local"
		req.Header.Set("X-Forwarded-Proto", "https")
		w := httptest.NewRecorder()

		ProxyToService(w, req, "TEST_SERVICE_URL_6", "", "", "TestService")

		resp := w.Result()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
		assert.Equal(t, "api.taskforce.local", seenXFH)
		assert.Equal(t, "http", seenXFP)
	})

	t.Run("EmptyOriginalHostRemovesForwardedHost", func(t *testing.T) {
		t.Setenv("TEST_SERVICE_URL_7", "")
		t.Setenv("VERCEL", "")

		var seenXFH string
		forwardingTarget := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenXFH = r.Header.Get("X-Forwarded-Host")
			w.WriteHeader(http.StatusOK)
		}))
		defer forwardingTarget.Close()

		t.Setenv("TEST_SERVICE_URL_7", forwardingTarget.URL)

		req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
		req.Host = ""
		req.Header.Set("X-Forwarded-Host", "spoofed.example")
		w := httptest.NewRecorder()

		ProxyToService(w, req, "TEST_SERVICE_URL_7", "", "", "TestService")

		resp := w.Result()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
		assert.Empty(t, seenXFH)
	})
}
