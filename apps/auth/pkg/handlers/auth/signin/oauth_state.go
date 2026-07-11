package signin

import (
	"encoding/base64"
	"net/http"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
)

func writeOAuthStateCookie(w http.ResponseWriter) (string, bool) {
	b := make([]byte, 32)
	if _, err := readStateRandom(b); err != nil {
		handler.JSONError(w, http.StatusInternalServerError, "Failed to generate state")
		return "", false
	}
	state := base64.URLEncoding.EncodeToString(b)

	http.SetCookie(w, &http.Cookie{ //nolint:gosec // OAuth state cookie is HttpOnly, SameSite=None, and Secure for provider redirects.
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		Expires:  time.Now().Add(10 * time.Minute),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
		Domain:   auth.GetCookieDomain(),
	})
	return state, true
}
