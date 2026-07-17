package handler

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"strings"
	"sync"
	"time"
)

const trustRewriteHeadersEnv = "TASKFORCE_TRUST_REWRITE_HEADERS"
const proxyCopyBufferSize = 32 * 1024

type proxyCopyBuffer [proxyCopyBufferSize]byte

type proxyBufferPool struct {
	pool sync.Pool
}

func (p *proxyBufferPool) Get() []byte {
	buf, ok := p.pool.Get().(*proxyCopyBuffer)
	if !ok {
		buf = new(proxyCopyBuffer)
	}
	return buf[:]
}

func (p *proxyBufferPool) Put(buf []byte) {
	if len(buf) != proxyCopyBufferSize {
		return
	}
	p.pool.Put((*proxyCopyBuffer)(buf[:proxyCopyBufferSize]))
}

var sharedProxyBufferPool = &proxyBufferPool{}

// RestorePath canonicalizes the request path from various Vercel-specific sources.
func RestorePath(r *http.Request) {
	// 1. Restore from query param (__path) - used by Vercel rewrites
	if queryPath := r.URL.Query().Get("__path"); queryPath != "" && canRestoreFromQueryPath(r.URL.Path) {
		if restored, ok := sanitizeQueryRewritePath(queryPath); ok {
			r.URL.Path = "/api/" + restored
		}
	} else if shouldTrustRewriteHeaders(r.URL.Path) {
		matchedPath := strings.TrimSpace(r.Header.Get("X-Matched-Path"))
		forwardedURI := strings.TrimSpace(r.Header.Get("X-Forwarded-Uri"))
		// 2. Restore from X-Matched-Path
		if matchedPath != "" && matchedPath != "/api/index" && matchedPath != "/api" {
			r.URL.Path = matchedPath
		} else if forwardedURI != "" {
			// 3. Restore from X-Forwarded-Uri
			r.URL.Path = forwardedURI
		}
	}

	// 4. Canonicalize and keep all restored traffic under /api.
	r.URL.Path = canonicalizeProxyPath(r.URL.Path)
	if !strings.HasPrefix(r.URL.Path, "/api") {
		r.URL.Path = NormalizeVercelPath(r.URL.Path)
	}

	// Add diagnostic headers
	r.Header.Set("X-TaskForce-Path-Restored", r.URL.Path)
	if mp := r.Header.Get("X-Matched-Path"); mp != "" {
		r.Header.Set("X-TaskForce-Matched-Path", mp)
	}
}

func canRestoreFromQueryPath(path string) bool {
	normalized := strings.TrimSpace(path)
	switch normalized {
	case "/api", "/api/":
		return true
	case "/api/index", "/api/index/":
		return true
	case "/api/index.go", "/api/index.go/":
		return true
	default:
		return strings.HasPrefix(normalized, "/apps/") &&
			(strings.HasSuffix(normalized, "/api/index.go") ||
				strings.HasSuffix(normalized, "/api/index.go/"))
	}
}

func shouldTrustRewriteHeaders(path string) bool {
	if !canRestoreFromQueryPath(path) {
		return false
	}

	return strings.EqualFold(strings.TrimSpace(os.Getenv(trustRewriteHeadersEnv)), "true")
}

func sanitizeQueryRewritePath(raw string) (string, bool) {
	trimmed := strings.TrimSpace(strings.TrimPrefix(raw, "/"))
	if trimmed == "" {
		return "", false
	}

	for segment := range strings.SplitSeq(trimmed, "/") {
		if segment == "." || segment == ".." {
			return "", false
		}
	}

	cleaned := strings.TrimPrefix(path.Clean("/"+trimmed), "/")
	if cleaned == "" || strings.HasPrefix(cleaned, "..") {
		return "", false
	}

	return cleaned, true
}

func canonicalizeProxyPath(raw string) string {
	return path.Clean("/" + strings.TrimSpace(raw))
}

func forwardedProtoForRequest(r *http.Request) string {
	if r.TLS != nil || os.Getenv("VERCEL") != "" {
		return "https"
	}
	return "http"
}

// NormalizeVercelPath ensures a path string follows the /api/... pattern.
func NormalizeVercelPath(path string) string {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	if !strings.HasPrefix(path, "/api") {
		path = "/api" + path
	}
	return path
}

// ProxyToService handles reverse proxying to a microservice with environment-aware defaults.
func ProxyToService(w http.ResponseWriter, r *http.Request, envVar, prodURL, localURL, serviceName string) {
	serviceURL := strings.TrimSpace(os.Getenv(envVar))
	if serviceURL == "" {
		if os.Getenv("VERCEL") != "" || os.Getenv("NODE_ENV") == "production" {
			serviceURL = prodURL
		} else {
			serviceURL = localURL
		}
	}

	target, err := url.Parse(serviceURL)
	if err != nil {
		JSONError(w, http.StatusInternalServerError, fmt.Sprintf("Invalid %s configuration", serviceName))
		return
	}
	if target.Host == "" || (target.Scheme != "http" && target.Scheme != "https") {
		JSONError(w, http.StatusInternalServerError, fmt.Sprintf("Invalid %s configuration", serviceName))
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(target) // #nosec G704 -- target is configuration, not request input, and is scheme/host validated above.
	proxy.FlushInterval = 100 * time.Millisecond
	proxy.BufferPool = sharedProxyBufferPool

	// Update the request to match the target host.
	originalHost := strings.TrimSpace(r.Host)
	if originalHost != "" {
		r.Header.Set("X-Forwarded-Host", originalHost)
	} else {
		r.Header.Del("X-Forwarded-Host")
	}
	r.Header.Set("X-Forwarded-Proto", forwardedProtoForRequest(r))
	r.Header.Set("X-TaskForce-Proxy", "core-api")
	// Drop untrusted client forwarding chain so downstream services see only proxy-added hops.
	r.Header.Del("X-Forwarded-For")
	r.Header.Del("X-Forwarded-Port")
	r.Header.Del("X-Forwarded-Server")
	r.Header.Del("Forwarded")
	r.URL.Host = target.Host
	r.URL.Scheme = target.Scheme
	r.Host = target.Host

	// Ensure we preserve the full path that has been restored by our middleware
	// httputil.ReverseProxy will use the r.URL.Path we've already corrected.

	proxy.ServeHTTP(w, r)
}
