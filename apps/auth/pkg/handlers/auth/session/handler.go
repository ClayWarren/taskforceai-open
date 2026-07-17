package session

import (
	"net/http"
	"strings"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/handler"
)

const defaultSessionExpiryFallback = 30 * 24 * time.Hour

// SessionHandler handles GET /api/auth/session
// Handler returns the current session.
// Maps to: GET /api/auth/session
func Handler(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodGet {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := handler.GetAuthenticatedUser(r)
	if user == nil {
		rawCookies := r.Header.Get("Cookie")
		hasSessionCookie := strings.Contains(rawCookies, "session_token")
		hasSecureSessionCookie := strings.Contains(rawCookies, "__Secure-session_token")

		handler.GetLogger().Debug("No user found in context for session request", map[string]any{
			"has_session_cookie":        hasSessionCookie,
			"has_secure_session_cookie": hasSecureSessionCookie,
		})
		handler.JSONError(w, http.StatusUnauthorized, "No active session")
		return
	}

	// Build session object
	// {
	//   "user": {
	//     "name": "...",
	//     "email": "...",
	//     "image": "..."
	//   },
	//   "expires": "..."
	// }

	expiresAt := time.Now().Add(defaultSessionExpiryFallback)
	if user.ExpiresAt != nil {
		expiresAt = user.ExpiresAt.UTC()
	}

	session := map[string]any{
		"user": map[string]any{
			"name":  user.Email,
			"email": user.Email,
		},
		"expires": expiresAt.Format(time.RFC3339),
	}

	if user.FullName != nil {
		if userMap, ok := session["user"].(map[string]any); ok {
			userMap["name"] = *user.FullName
		}
	}
	// Add other fields if necessary

	handler.JSON(w, http.StatusOK, session)
}
