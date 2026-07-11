package handler

import (
	"context"
	"fmt"
	appdatabase "github.com/TaskForceAI/auth-service/pkg/database"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/adapters/pkg/utils"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

const (
	// MaxBodySize limits incoming request bodies to 1MB to prevent memory exhaustion (DoS).
	MaxBodySize = 1024 * 1024
)

var (
	queriesOverride func(ctx context.Context) (*db.Queries, error)
)

func init() {
	handler.SetRedisClientFactory(newHandlerRedisClient)
}

// getRedisClientForHandler is a package variable so tests can exercise both the
// success and failure branches of the redis client factory deterministically.
var getRedisClientForHandler = infraredis.GetClient

func newHandlerRedisClient() (handler.RedisClient, error) {
	client, err := getRedisClientForHandler()
	if err != nil {
		return nil, err
	}
	return client, nil
}

// SetQueriesOverride sets a global override for database queries (for testing).
var SetQueriesOverride = func(get func(ctx context.Context) (*db.Queries, error)) {
	queriesOverride = get
}

// ResolveQueries resolves database queries, respecting the test override when set.
func ResolveQueries(ctx context.Context, get func(ctx context.Context) (*db.Queries, error)) (*db.Queries, error) {
	if get == nil {
		if queriesOverride != nil {
			get = queriesOverride
		} else {
			get = appdatabase.GetQueries
		}
	}
	return get(ctx)
}

// ReadJSON decodes JSON from a request body with a size limit.
func ReadJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	return handler.ReadJSON(w, r, dst, MaxBodySize)
}

// ValidateSecureEnv ensures critical security environment variables meet minimum standards.
func ValidateSecureEnv() error {
	secret := strings.TrimSpace(os.Getenv("AUTH_SECRET"))
	if secret == "" {
		return fmt.Errorf("AUTH_SECRET is required")
	}
	if len(secret) < 32 {
		return fmt.Errorf("AUTH_SECRET must be at least 32 characters for security")
	}
	return nil
}

// RequireQueries resolves database queries or writes a standard error response.
func RequireQueries(w http.ResponseWriter, r *http.Request, get func(ctx context.Context) (*db.Queries, error)) (*db.Queries, bool) {
	q, err := ResolveQueries(r.Context(), get)
	if err != nil {
		GetLogger().Error("Failed to initialize database", map[string]any{"error": err.Error()})
		JSONError(w, http.StatusInternalServerError, "Server error")
		return nil, false
	}
	return q, true
}

// RequireQueriesWithStatus resolves database queries or writes a custom error response.
func RequireQueriesWithStatus(
	w http.ResponseWriter,
	r *http.Request,
	get func(ctx context.Context) (*db.Queries, error),
	status int,
	message string,
) (*db.Queries, bool) {
	q, err := ResolveQueries(r.Context(), get)
	if err != nil {
		GetLogger().Error("Failed to initialize database", map[string]any{"error": err.Error()})
		JSONError(w, status, message)
		return nil, false
	}
	return q, true
}

// Re-export context keys
const (
	UserContextKey   = handler.UserContextKey
	UserIDContextKey = handler.UserIDContextKey
	EmailContextKey  = handler.EmailContextKey
	OrgIDContextKey  = handler.OrgIDContextKey
)

// Bridge functions to shared handler
var HandleCORS = handler.HandleCORS
var JSON = handler.JSON
var JSONError = handler.JSONError
var GetAuthenticatedUser = handler.GetAuthenticatedUser
var GetUserID = handler.GetUserID
var WithAuth = handler.WithAuth
var WithOptionalAuth = handler.WithOptionalAuth
var GetLogger = handler.GetLogger
var ExtractToken = handler.ExtractToken
var WithSecurityHeaders = handler.WithSecurityHeaders
var WithCSRF = handler.WithCSRF
var WithRecovery = handler.WithRecovery
var IsProductionEnv = handler.IsProductionEnv
var ValidateStruct = handler.ValidateStruct
var FormatValidationErrors = handler.FormatValidationErrors
var GetRedisClient = handler.GetRedisClient
var SetRedisClient = handler.SetRedisClient
var SetRedisClientFactory = handler.SetRedisClientFactory
var GetClientIP = handler.GetClientIP

func ShouldUseSecureCookies(r *http.Request) bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_ENV")), "production") ||
		strings.TrimSpace(os.Getenv("VERCEL")) != "" {
		return true
	}

	if r == nil {
		return false
	}

	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if idx := strings.Index(proto, ","); idx >= 0 {
		proto = strings.TrimSpace(proto[:idx])
	}
	if strings.EqualFold(proto, "https") {
		return true
	}

	return r.TLS != nil
}

// IsAllowedRedirect validates that a redirect URL is safe (relative path or same-origin).
func IsAllowedRedirect(rawURL string) bool {
	if rawURL == "" || rawURL == "/" {
		return true
	}
	// Reject backslashes to prevent browser normalization into protocol-relative redirects.
	if strings.Contains(rawURL, `\`) {
		return false
	}
	// Allow relative paths, block protocol-relative (//example.com)
	if strings.HasPrefix(rawURL, "/") && !strings.HasPrefix(rawURL, "//") {
		// Prevent path traversal like /../../admin
		return !strings.Contains(rawURL, "..")
	}

	// For absolute URLs, check against allowed domain
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" {
		if scheme != "http" || !isLoopbackRedirectHost(parsed.Hostname()) {
			return false
		}
	}

	allowedHost, allowedPort, ok := normalizedAllowedRedirectDomain(os.Getenv("ALLOWED_REDIRECT_DOMAIN"))
	if !ok {
		return false
	}

	host := normalizeRedirectHost(parsed.Hostname())
	if host == "" {
		return false
	}
	if allowedPort != "" && parsed.Port() != allowedPort {
		return false
	}
	return host == allowedHost || strings.HasSuffix(host, "."+allowedHost)
}

func normalizedAllowedRedirectDomain(raw string) (string, string, bool) {
	allowedDomain := strings.ToLower(strings.TrimSpace(raw))
	if allowedDomain == "" {
		return "", "", false
	}
	if parsed, err := url.Parse(allowedDomain); err == nil && parsed.Scheme != "" {
		allowedDomain = parsed.Host
	}
	if beforeSlash, _, ok := strings.Cut(allowedDomain, "/"); ok {
		allowedDomain = beforeSlash
	}
	host := allowedDomain
	port := ""
	if splitHost, splitPort, err := net.SplitHostPort(allowedDomain); err == nil {
		host = splitHost
		port = splitPort
	}
	host = normalizeRedirectHost(host)
	if host == "" {
		return "", "", false
	}
	return host, port, true
}

func normalizeRedirectHost(host string) string {
	host = strings.TrimSpace(strings.ToLower(host))
	host = strings.Trim(host, "[]")
	host = strings.TrimSuffix(host, ".")
	host = strings.TrimPrefix(host, ".")
	return host
}

func isLoopbackRedirectHost(host string) bool {
	host = normalizeRedirectHost(host)
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// IsValidEmail checks if the email format is valid.
func IsValidEmail(email string) bool {
	return utils.IsValidEmail(email)
}

// GetUserAgent extracts user agent from request
func GetUserAgent(r *http.Request) *string {
	if ua := r.Header.Get("User-Agent"); ua != "" {
		return &ua
	}
	return nil
}

// MaskEmail redacts an email for safe application logging (PII protection)
func MaskEmail(email string) string {
	user, domain, ok := strings.Cut(email, "@")
	if !ok || strings.Contains(domain, "@") {
		return "***"
	}
	if len(user) <= 2 {
		return "***@" + domain
	}
	return user[:2] + "***@" + domain
}

// SanitizeMetadata recursively scrubs PII from metadata maps.
func SanitizeMetadata(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	newMap := make(map[string]any, len(m))

	for k, v := range m {
		// Mask specific PII keys
		if isPIIMetadataKey(k) {
			if str, ok := v.(string); ok && strings.Contains(str, "@") {
				newMap[k] = MaskEmail(str)
			} else {
				newMap[k] = "***"
			}
			continue
		}

		// Recurse into maps
		if subMap, ok := v.(map[string]any); ok {
			newMap[k] = SanitizeMetadata(subMap)
			continue
		}

		newMap[k] = v
	}
	return newMap
}

func isPIIMetadataKey(key string) bool {
	switch key {
	case "email", "email_address", "fullName", "full_name", "password", "token", "accessToken", "id_token":
		return true
	}

	switch strings.ToLower(key) {
	case "email", "email_address", "fullname", "full_name", "password", "token", "accesstoken", "id_token":
		return true
	default:
		return false
	}
}
