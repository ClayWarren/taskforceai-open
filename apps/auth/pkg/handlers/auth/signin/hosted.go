package signin

import (
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	stateutil "github.com/TaskForceAI/auth-service/pkg/handlers/auth/state"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

type HostedHandlerStruct struct {
	WorkOS  providers.WorkOSProvider
	Limiter *ratelimit.RedisRateLimiter
}

var buildHostedStatePayload = stateutil.BuildStatePayload

func normalizeHost(raw string) string {
	host := strings.TrimSpace(raw)
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimRight(host, "/")
	if idx := strings.Index(host, ","); idx >= 0 {
		host = strings.TrimSpace(host[:idx])
	}
	return host
}

func isTrustedRedirectOrigin(rawURL string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" {
		return "", false
	}
	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return "", false
	}
	if host == "taskforceai.chat" || strings.HasSuffix(host, ".taskforceai.chat") {
		return scheme + "://" + strings.ToLower(parsed.Host), true
	}
	return "", false
}

func canonicalHost(raw string) string {
	host := strings.ToLower(normalizeHost(raw))
	if host == "" {
		return ""
	}
	if onlyHost, _, err := net.SplitHostPort(host); err == nil {
		host = onlyHost
	}
	host = strings.Trim(host, "[]")
	return strings.TrimSpace(host)
}

func allowedRedirectDomainHost() string {
	allowedDomain := strings.TrimSpace(os.Getenv("ALLOWED_REDIRECT_DOMAIN"))
	if allowedDomain == "" {
		return ""
	}
	return canonicalHost(allowedDomain)
}

func isTrustedRequestHost(host string) bool {
	normalized := canonicalHost(host)
	if normalized == "" {
		return false
	}

	if ip := net.ParseIP(normalized); ip != nil && ip.IsLoopback() {
		return true
	}
	if normalized == "localhost" || strings.HasSuffix(normalized, ".localhost") {
		return true
	}
	if normalized == "taskforceai.chat" || strings.HasSuffix(normalized, ".taskforceai.chat") {
		return true
	}

	allowedDomain := allowedRedirectDomainHost()
	if allowedDomain != "" && (normalized == allowedDomain || strings.HasSuffix(normalized, "."+allowedDomain)) {
		return true
	}

	return false
}

func requestPublicBaseURL(r *http.Request) string {
	if r == nil {
		return ""
	}

	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if idx := strings.Index(proto, ","); idx >= 0 {
		proto = strings.TrimSpace(proto[:idx])
	}
	proto = strings.ToLower(proto)
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	if proto != "https" && proto != "http" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}

	for _, candidate := range []string{
		r.Header.Get("X-Forwarded-Host"),
		r.Host,
	} {
		host := canonicalHost(candidate)
		if host == "" {
			continue
		}
		if !isTrustedRequestHost(host) {
			continue
		}
		return proto + "://" + host
	}

	return ""
}

func resolvePublicBaseURL(r *http.Request, callbackURL string) string {
	if origin, ok := isTrustedRedirectOrigin(callbackURL); ok {
		return origin
	}

	candidates := []string{
		strings.TrimSpace(os.Getenv("APP_URL")),
		strings.TrimSpace(os.Getenv("WEB_URL")),
		strings.TrimSpace(os.Getenv("NEXT_PUBLIC_APP_URL")),
	}
	for _, candidate := range candidates {
		if candidate != "" {
			return strings.TrimRight(candidate, "/")
		}
	}

	if requestBase := requestPublicBaseURL(r); requestBase != "" {
		return requestBase
	}

	authCandidates := []string{
		strings.TrimSpace(os.Getenv("AUTH_URL")),
	}
	for _, candidate := range authCandidates {
		if candidate != "" {
			return strings.TrimRight(candidate, "/")
		}
	}
	return "http://localhost:3000"
}

func (h *HostedHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}

	if h.writeRateLimitError(w, r) {
		return
	}

	if r.Method != http.MethodGet {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	clientID := strings.TrimSpace(os.Getenv("WORKOS_CLIENT_ID"))
	callbackURL := r.URL.Query().Get("callbackUrl")
	baseURL := strings.TrimSpace(os.Getenv("AUTH_URL"))
	if baseURL == "" {
		baseURL = resolvePublicBaseURL(r, callbackURL)
	}
	baseURL = strings.TrimRight(baseURL, "/")

	redirectURL := fmt.Sprintf("%s/api/v1/auth/callback", baseURL)

	if clientID == "" {
		handler.GetLogger().Error("WorkOS configuration missing", nil)
		// Redirect back to login page with error instead of returning JSON
		loginURL := fmt.Sprintf("%s/login?error=ConfigurationError", baseURL)
		http.Redirect(w, r, loginURL, http.StatusTemporaryRedirect) //nolint:gosec // loginURL is built from the configured public auth base URL.
		return
	}

	// Generate random state
	b := make([]byte, 32)
	_, err := readStateRandom(b)
	if err != nil {
		handler.JSONError(w, http.StatusInternalServerError, "Failed to generate state")
		return
	}
	state := base64.URLEncoding.EncodeToString(b)

	// Handle callbackUrl via state parameter
	if callbackURL == "undefined" || strings.Contains(callbackURL, "/undefined") {
		callbackURL = ""
	}

	secret := strings.TrimSpace(os.Getenv("AUTH_SECRET"))
	if secret == "" && handler.IsProductionEnv() {
		handler.GetLogger().Error("AUTH_SECRET missing for hosted OAuth state signing", nil)
		handler.JSONError(w, http.StatusInternalServerError, "Server configuration error")
		return
	}
	stateParam := state
	statePayload := state
	if secret != "" {
		signedStateParam, signedPayload, err := buildHostedStatePayload(state, callbackURL, secret)
		if err != nil {
			handler.GetLogger().Error("Failed to sign OAuth state", map[string]any{"error": err.Error()})
			handler.JSONError(w, http.StatusInternalServerError, "Failed to initiate login")
			return
		}
		stateParam = signedStateParam
		statePayload = signedPayload
	} else if callbackURL != "" {
		statePayload = fmt.Sprintf("%s|%s", state, base64.URLEncoding.EncodeToString([]byte(callbackURL)))
	}

	// Set state cookie
	domain := auth.GetCookieDomain()
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // Hosted OAuth state cookie is HttpOnly, SameSite=None, and Secure for provider redirects.
		Name:     "oauth_state",
		Value:    stateParam,
		Path:     "/",
		Expires:  time.Now().Add(10 * time.Minute),
		HttpOnly: true,
		Secure:   true, // Always true for SameSite=None
		SameSite: http.SameSiteNoneMode,
		Domain:   domain,
	})

	authURL, err := h.WorkOS.GetHostedAuthURL(usermanagement.GetAuthorizationURLOpts{
		ClientID:    clientID,
		RedirectURI: redirectURL,
		State:       statePayload,
		Provider:    "authkit",
	})

	if err != nil {
		handler.GetLogger().Error("Failed to generate WorkOS Auth URL", map[string]any{"error": err})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to initiate login")
		return
	}

	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

func (h *HostedHandlerStruct) writeRateLimitError(w http.ResponseWriter, r *http.Request) bool {
	if h.Limiter == nil {
		return false
	}
	ip := handler.GetClientIP(r)
	if ip == nil {
		return false
	}
	res, err := h.Limiter.Check(r.Context(), "signin:"+*ip, ratelimit.SigninMaxRequests, time.Minute)
	if err != nil {
		handler.GetLogger().Warn("Rate limiter check failed for signin", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
		return true
	}
	if res.Allowed {
		return false
	}
	handler.GetLogger().Warn("Rate limit exceeded for signin", map[string]any{"ip": *ip})
	handler.JSONError(w, http.StatusTooManyRequests, "Too many requests")
	return true
}

var hostedWorkOSFactory = func(apiKey, clientID string) providers.WorkOSProvider {
	return providers.NewWorkOSClient(apiKey, clientID)
}

// HostedHandler is the entry point for the Vercel function.
func HostedHandler(w http.ResponseWriter, r *http.Request) {
	client := hostedWorkOSFactory(
		strings.TrimSpace(os.Getenv("WORKOS_API_KEY")),
		strings.TrimSpace(os.Getenv("WORKOS_CLIENT_ID")),
	)

	// Explicitly handle nil Redis client to avoid typed-nil-in-interface issue
	var limiter *ratelimit.RedisRateLimiter
	if redisClient := handler.GetRedisClient(); redisClient != nil {
		limiter = ratelimit.NewRedisRateLimiter(redisClient, "")
	}

	h := &HostedHandlerStruct{
		WorkOS:  client,
		Limiter: limiter,
	}
	h.ServeHTTP(w, r)
}
