package csrf

import (
	"net/http"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/google/uuid"
)

// CsrfHandler handles GET /api/auth/csrf
func Handler(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}

	token := uuid.New().String()
	w.Header().Set("Cache-Control", "no-store")

	// Set CSRF cookie (not httpOnly so JS can read it for Double Submit)
	isSecure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	domain := auth.GetCookieDomain()
	sameSite := http.SameSiteLaxMode

	http.SetCookie(w, &http.Cookie{ //nolint:gosec // CSRF token must be readable by JS for double-submit validation.
		Name:     "csrf_token",
		Value:    token,
		Path:     "/",
		MaxAge:   3600, // 1 hour
		Secure:   isSecure,
		SameSite: sameSite,
		Domain:   domain,
	})

	// Standard CSRF response
	handler.JSON(w, http.StatusOK, map[string]string{
		"csrfToken": token,
	})
}
