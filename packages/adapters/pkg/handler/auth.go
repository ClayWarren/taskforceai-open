package handler

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
)

// ContextKey is a type for context keys to avoid collisions.
type ContextKey string

const (
	// UserContextKey is the key for the authenticated user in the context.
	UserContextKey ContextKey = "user"
	// UserIDContextKey is the key for the user ID in the context.
	UserIDContextKey ContextKey = "user_id"
	// EmailContextKey is the key for the user email in the context.
	EmailContextKey ContextKey = "email"
	// OrgIDContextKey is the key for the organization ID in the context.
	OrgIDContextKey ContextKey = "org_id"
	// TokenIssuedAtContextKey stores the token issue time (unix seconds) for
	// downstream handlers that need server-verified recent-auth checks.
	TokenIssuedAtContextKey ContextKey = "token_iat"
	// AuthMethodContextKey stores the authentication mechanism used for a request.
	AuthMethodContextKey ContextKey = "auth_method"
)

const (
	AuthMethodAPIKey  = "api-key"
	AuthMethodSession = "session"
)

// GetAuthenticatedUser retrieves the authenticated user from the context.
func GetAuthenticatedUser(r *http.Request) *auth.AuthenticatedUser {
	user, ok := r.Context().Value(UserContextKey).(*auth.AuthenticatedUser)
	if !ok {
		return nil
	}
	return user
}

// GetUserID retrieves the authenticated user ID from the context.
func GetUserID(r *http.Request) int {
	if user := GetAuthenticatedUser(r); user != nil {
		return user.ID
	}
	// Fallback if only ID was set (e.g. partial auth)
	id, _ := r.Context().Value(UserIDContextKey).(int)
	return id
}

// GetOrgID retrieves the organization ID from the context.
func GetOrgID(r *http.Request) int {
	orgID, _ := r.Context().Value(OrgIDContextKey).(int)
	return orgID
}

// GetUserIdentifier returns the user's email or a string representation of their ID.
func GetUserIdentifier(r *http.Request) string {
	if user := GetAuthenticatedUser(r); user != nil {
		return user.Email
	}
	if email, ok := r.Context().Value(EmailContextKey).(string); ok {
		return email
	}
	return ""
}

// ExtractToken extracts the Bearer token from the Authorization header.
func ExtractToken(r *http.Request) string {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader != "" {
		parts := strings.Fields(authHeader)
		if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") && parts[1] != "" {
			return parts[1]
		}
	}
	for _, cookieName := range []string{"__Secure-session_token", "session_token"} {
		cookie, err := r.Cookie(cookieName)
		if err == nil && cookie.Value != "" {
			return cookie.Value
		}
	}
	return ""
}

func BuildAuthenticatedUser(claims map[string]any) (*auth.AuthenticatedUser, error) {
	user := &auth.AuthenticatedUser{}
	if email, ok := claims["email"].(string); ok {
		user.Email = email
	}

	// Resilient ID extraction from multiple common keys
	idKeys := []string{"id", "user_id", "sub"}
	for _, key := range idKeys {
		if user.ID != 0 {
			break
		}
		if val, ok := claims[key]; ok {
			switch v := val.(type) {
			case float64:
				if v > 0 && v <= math.MaxInt32 {
					user.ID = int(v)
				}
			case string:
				if parsed, err := strconv.ParseInt(strings.TrimSpace(v), 10, 32); err == nil && parsed > 0 {
					user.ID = int(parsed)
				}
			}
		}
	}

	if user.ID == 0 {
		slog.Warn("User ID not found or invalid in token claims")
		return nil, fmt.Errorf("user ID not found or invalid in token claims")
	}

	if orgID, ok := claims["org_id"].(float64); ok {
		if orgID < 0 || orgID > math.MaxInt32 {
			slog.Error("Org ID out of range", "orgID", orgID)
			return nil, fmt.Errorf("org ID out of range")
		}
		org := int(orgID)
		user.OrgID = &org
	}
	if workosOrgID, ok := claims["workos_org_id"].(string); ok {
		trimmed := strings.TrimSpace(workosOrgID)
		if trimmed != "" {
			user.WorkosOrgID = &trimmed
		}
	}
	if expiresAtUnix, ok := TokenExpiresAtUnixFromClaims(claims); ok {
		expiresAt := time.Unix(expiresAtUnix, 0).UTC()
		user.ExpiresAt = &expiresAt
	}
	return user, nil
}

// TokenIssuedAtUnixFromClaims extracts a server-verifiable auth timestamp from
// token claims. It prefers `auth_time` and falls back to `iat`.
func TokenIssuedAtUnixFromClaims(claims map[string]any) (int64, bool) {
	for _, key := range []string{"auth_time", "iat"} {
		raw, ok := claims[key]
		if !ok || raw == nil {
			continue
		}
		if unix, ok := claimUnixSeconds(raw); ok {
			return unix, true
		}
	}
	return 0, false
}

func TokenExpiresAtUnixFromClaims(claims map[string]any) (int64, bool) {
	raw, ok := claims["exp"]
	if !ok || raw == nil {
		return 0, false
	}
	return claimUnixSeconds(raw)
}

func claimUnixSeconds(raw any) (int64, bool) {
	switch v := raw.(type) {
	case int64:
		if v > 0 {
			return v, true
		}
	case int:
		if v > 0 {
			return int64(v), true
		}
	case float64:
		if v > 0 && v <= math.MaxInt64 {
			return int64(v), true
		}
	case string:
		if parsed, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64); err == nil && parsed > 0 {
			return parsed, true
		}
	}
	return 0, false
}

// buildAuthenticatedUser is maintained for backward compatibility within this package
func buildAuthenticatedUser(claims map[string]any) (*auth.AuthenticatedUser, error) {
	return BuildAuthenticatedUser(claims)
}

func IsMFAPendingClaims(claims map[string]any) bool {
	pending, _ := claims["mfa_pending"].(bool)
	return pending
}

func isMFAPendingClaims(claims map[string]any) bool {
	return IsMFAPendingClaims(claims)
}

// WithAuth validates the request token when auth context was not pre-populated.
func WithAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if existing := GetAuthenticatedUser(r); existing != nil {
			next(w, r)
			return
		}
		token := ExtractToken(r)
		if token == "" {
			JSONError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		claims, err := ValidateToken(token)
		if err != nil {
			slog.Warn("Token validation failed", "error", err)
			JSONError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if isMFAPendingClaims(claims) {
			slog.Warn("MFA pending token rejected from authenticated service path")
			JSONError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		// Check token revocation blacklist.
		if IsTokenRevoked != nil && IsTokenRevoked(r.Context(), token) {
			JSONError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		user, buildErr := buildAuthenticatedUser(claims)
		if buildErr != nil {
			slog.Error("Failed to build authenticated user from claims", "error", buildErr)
			JSONError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		next(w, requestWithAuthenticatedClaims(r, user, claims))
	}
}

// WithOptionalAuth attempts to validate the request token but proceeds even if it fails.
func WithOptionalAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if existing := GetAuthenticatedUser(r); existing != nil {
			next(w, r)
			return
		}

		token := ExtractToken(r)
		if token == "" {
			next(w, r)
			return
		}

		claims, err := ValidateToken(token)
		if err != nil {
			next(w, r)
			return
		}
		if isMFAPendingClaims(claims) {
			next(w, r)
			return
		}

		// Check token revocation blacklist.
		if IsTokenRevoked != nil && IsTokenRevoked(r.Context(), token) {
			next(w, r)
			return
		}

		user, buildErr := buildAuthenticatedUser(claims)
		if buildErr != nil {
			next(w, r)
			return
		}

		next(w, requestWithAuthenticatedClaims(r, user, claims))
	}
}

func requestWithAuthenticatedClaims(r *http.Request, user *auth.AuthenticatedUser, claims map[string]any) *http.Request {
	ctx := context.WithValue(r.Context(), UserContextKey, user)
	if user.ID != 0 {
		ctx = context.WithValue(ctx, UserIDContextKey, user.ID)
	}
	if user.Email != "" {
		ctx = context.WithValue(ctx, EmailContextKey, user.Email)
	}
	if user.OrgID != nil {
		ctx = context.WithValue(ctx, OrgIDContextKey, *user.OrgID)
	}
	if issuedAt, ok := TokenIssuedAtUnixFromClaims(claims); ok {
		ctx = context.WithValue(ctx, TokenIssuedAtContextKey, issuedAt)
	}
	return r.WithContext(ctx)
}

// ValidateToken validates a JWT token.
var ValidateToken = auth.ValidateToken

// IsTokenRevoked is checked by WithAuth after token validation.
// It defaults to a Redis-backed checker and can be overridden in tests.
// Signature: func(ctx context.Context, rawToken string) bool
var IsTokenRevoked = defaultTokenRevocationCheck
