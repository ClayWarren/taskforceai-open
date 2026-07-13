package refresh

import (
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
)

const impersonationRefreshMaxAgeSeconds = 1800

var (
	verifyToken       = authpkg.VerifyToken
	isTokenNearExpiry = authpkg.IsTokenNearExpiry
	encodeSession     = authpkg.EncodeSessionToken
)

// Handler handles POST /api/v1/auth/refresh
// It refreshes the session token if the current token is past 50% of its lifetime.
func Handler(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodPost {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Extract the current token from session cookie
	tokenString := handler.ExtractToken(r)
	if tokenString == "" {
		handler.JSONError(w, http.StatusUnauthorized, "No session token")
		return
	}

	token, claimsMap, ok := validatedRefreshToken(w, tokenString)
	if !ok {
		return
	}

	if !refreshTokenIsActive(w, r, tokenString) {
		return
	}

	// Check if the token is in the renewal window (past 50% of lifetime)
	if !isTokenNearExpiry(token, 0.5) {
		handler.JSON(w, http.StatusOK, map[string]any{
			"refreshed": false,
			"message":   "Token not yet eligible for refresh",
		})
		return
	}

	userID := getStringClaim(claimsMap, "sub", "id", "user_id")
	if userID == "" {
		handler.JSONError(w, http.StatusUnauthorized, "Invalid user claims")
		return
	}

	// Validate user existence and status in DB before refreshing
	if err := validateUser(r, w, userID); err != nil {
		return
	}

	sessionUser := sessionUserFromClaims(userID, claimsMap)
	maxAgeOverride, ok := refreshMaxAge(w, sessionUser, claimsMap)
	if !ok {
		return
	}

	// Issue a new token
	secret := strings.TrimSpace(os.Getenv("AUTH_SECRET"))
	newToken, err := encodeSession(sessionUser, secret, maxAgeOverride)
	if err != nil {
		handler.GetLogger().Error("Failed to encode refreshed session token", map[string]any{
			"error": err.Error(),
		})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to refresh session")
		return
	}

	applyRefreshedSessionCookies(w, newToken, sessionUser, maxAgeOverride)

	handler.JSON(w, http.StatusOK, map[string]any{
		"refreshed": true,
	})
}

func validatedRefreshToken(w http.ResponseWriter, tokenString string) (*jwt.Token, jwt.MapClaims, bool) {
	token, err := verifyToken(tokenString)
	if err != nil || token == nil || !token.Valid {
		handler.JSONError(w, http.StatusUnauthorized, "Invalid or expired session")
		return nil, nil, false
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		handler.JSONError(w, http.StatusInternalServerError, "Failed to read token claims")
		return nil, nil, false
	}
	if adapterhandler.IsMFAPendingClaims(claims) {
		handler.JSONError(w, http.StatusUnauthorized, "Invalid or expired session")
		return nil, nil, false
	}
	return token, claims, true
}

func refreshTokenIsActive(w http.ResponseWriter, r *http.Request, tokenString string) bool {
	rc := handler.GetRedisClient()
	if rc == nil {
		return true
	}
	revoked, err := adapterauth.IsTokenRevoked(r.Context(), rc, tokenString)
	if err != nil {
		handler.GetLogger().Error("Token revocation check failed during refresh", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusServiceUnavailable, "Service unavailable")
		return false
	}
	if revoked {
		handler.JSONError(w, http.StatusUnauthorized, "Session has been revoked")
		return false
	}
	return true
}

func sessionUserFromClaims(userID string, claims jwt.MapClaims) authpkg.SessionUser {
	user := authpkg.SessionUser{ID: userID}
	user.Email, _ = claims["email"].(string)
	user.FullName, _ = claims["name"].(string)
	if orgID, ok := claims["workos_org_id"].(string); ok {
		user.OrgID = &orgID
	}
	if internalOrgID, ok := claims["org_id"].(float64); ok && internalOrgID > 0 && internalOrgID <= float64(math.MaxInt32) {
		id := int(internalOrgID)
		user.InternalOrgID = &id
	}
	if picture, ok := claims["picture"].(string); ok {
		user.Avatar = &picture
	}
	if actAs, ok := claims["act_as"].(string); ok {
		user.ImpersonatorID = &actAs
	}
	return user
}

func refreshMaxAge(w http.ResponseWriter, user authpkg.SessionUser, claims jwt.MapClaims) (int, bool) {
	if user.ImpersonatorID == nil {
		return 0, true
	}
	remaining, err := getRemainingTokenLifetimeSeconds(claims, time.Now().Unix())
	if err != nil {
		handler.GetLogger().Warn("Rejected impersonation refresh due to invalid token lifetime", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusUnauthorized, "Invalid or expired session")
		return 0, false
	}
	return remaining, true
}

func applyRefreshedSessionCookies(w http.ResponseWriter, token string, user authpkg.SessionUser, maxAge int) {
	isSecure := strings.TrimSpace(os.Getenv("NODE_ENV")) == "production" || strings.TrimSpace(os.Getenv("VERCEL")) != ""
	if maxAge > 0 {
		authpkg.ApplySessionCookies(w, token, user, isSecure, maxAge)
		return
	}
	authpkg.ApplySessionCookies(w, token, user, isSecure)
}

// getStringClaim extracts a string value from claims, trying multiple keys.
func getStringClaim(claims jwt.MapClaims, keys ...string) string {
	for _, key := range keys {
		if val, ok := claims[key]; ok {
			switch v := val.(type) {
			case string:
				return v
			case float64:
				return fmt.Sprintf("%d", int64(v))
			}
		}
	}
	return ""
}

func getRemainingTokenLifetimeSeconds(claims jwt.MapClaims, nowUnix int64) (int, error) {
	rawExp, ok := claims["exp"]
	if !ok {
		return 0, fmt.Errorf("missing exp")
	}

	expUnix, ok := claimToUnixSeconds(rawExp)
	if !ok {
		return 0, fmt.Errorf("invalid exp claim type")
	}

	remaining := expUnix - nowUnix
	if remaining <= 0 {
		return 0, fmt.Errorf("token already expired")
	}
	if remaining > int64(impersonationRefreshMaxAgeSeconds) {
		remaining = int64(impersonationRefreshMaxAgeSeconds)
	}
	return int(remaining), nil
}

func claimToUnixSeconds(raw any) (int64, bool) {
	switch v := raw.(type) {
	case float64:
		if v > 0 && v <= float64(math.MaxInt64) {
			return int64(v), true
		}
	case int64:
		if v > 0 {
			return v, true
		}
	case int:
		if v > 0 {
			return int64(v), true
		}
	}
	return 0, false
}

func validateUser(r *http.Request, w http.ResponseWriter, userID string) error {
	idInt64, err := strconv.ParseInt(userID, 10, 64)
	if err != nil {
		handler.JSONError(w, http.StatusUnauthorized, "Invalid user ID")
		return fmt.Errorf("failed to parse user ID: %w", err)
	}

	if idInt64 < math.MinInt32 || idInt64 > math.MaxInt32 {
		handler.JSONError(w, http.StatusUnauthorized, "Invalid user ID range")
		return fmt.Errorf("user ID out of range")
	}

	q, ok := handler.RequireQueriesWithStatus(w, r, nil, http.StatusServiceUnavailable, "Database unavailable")
	if !ok {
		return fmt.Errorf("database unavailable")
	}

	userIDInt32 := int32(idInt64) // #nosec G115 -- bounded by math.MinInt32/math.MaxInt32 above.
	user, err := q.GetUserRefreshStatus(r.Context(), userIDInt32)
	if err != nil || user.Disabled {
		handler.GetLogger().Warn("Rejected token refresh for disabled/deleted user", map[string]any{"user_id": userID})
		handler.JSONError(w, http.StatusUnauthorized, "User account disabled or not found")
		return fmt.Errorf("user disabled or not found")
	}
	return nil
}
