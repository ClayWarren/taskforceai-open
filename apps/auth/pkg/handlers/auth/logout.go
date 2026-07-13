// Package handler provides the logout API handler.
package auth

import (
	"context"
	"net/http"
	"os"
	"strconv"
	"strings"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
)

// getTokenRevoker returns the token revocation store.
// Injectable for testing. Returns nil when Redis is not available.
var getTokenRevoker = func() adapterauth.TokenRevoker {
	rc := handler.GetRedisClient()
	if rc == nil {
		return nil
	}
	return rc
}

func revokeTokenOnLogout(ctx context.Context, rawToken string) {
	if rawToken == "" {
		return
	}

	claims, err := adapterauth.ValidateToken(rawToken)
	if err != nil {
		return
	}

	revoker := getTokenRevoker()
	if revoker == nil {
		return
	}

	if err := adapterauth.RevokeToken(ctx, revoker, rawToken, claims); err != nil {
		handler.GetLogger().Warn("Failed to revoke token on logout", map[string]any{"error": err.Error()})
	}
}

// LogoutHandler handles POST /api/v1/auth/logout
func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	// Handle CORS
	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodPost {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	// Revoke the token server-side so it cannot be reused
	revokeTokenOnLogout(r.Context(), handler.ExtractToken(r))

	// Clear auth cookies using same options as login
	isSecure := strings.TrimSpace(os.Getenv("NODE_ENV")) == "production" || strings.TrimSpace(os.Getenv("VERCEL")) != ""
	opts := auth.GetSessionCookieOptions(-1, isSecure)

	cookies := []string{
		auth.SessionCookieName,
		auth.SecureSessionCookieName,
	}

	for _, name := range cookies {
		cookie := *opts //nolint:gosec // opts carries HttpOnly, SameSite, and environment-aware Secure.
		cookie.Name = name
		cookie.Value = ""
		http.SetCookie(w, &cookie)
	}

	// Parse form to get callbackUrl if provided
	if err := r.ParseForm(); err != nil {
		handler.GetLogger().Warn("Failed to parse logout form", map[string]any{"error": err})
	}
	callbackUrl := r.FormValue("callbackUrl")
	if callbackUrl == "" || !handler.IsAllowedRedirect(callbackUrl) {
		callbackUrl = "/login?error=sessionExpired"
	}

	// Log audit event
	q, err := getQueries(r.Context())
	if err == nil {
		auditService := auth.NewAuditService(auth.NewAuditLogRepository(q))
		user := handler.GetAuthenticatedUser(r)

		var userIDPtr *string
		var emailPtr *string

		if user != nil {
			uidStr := strconv.Itoa(user.ID)
			userIDPtr = &uidStr
			emailPtr = &user.Email
		}

		auditService.LogEvent(r.Context(), auth.AuditLogWrite{
			UserID:    userIDPtr,
			Email:     emailPtr,
			Action:    "LOGOUT",
			Resource:  "user",
			IPAddress: handler.GetClientIP(r),
			UserAgent: handler.GetUserAgent(r),
			Success:   true,
		})
	}

	handler.GetLogger().Info("User logged out", nil)

	handler.JSON(w, http.StatusOK, map[string]string{
		"message": "Logged out",
		"url":     callbackUrl,
	})
}
