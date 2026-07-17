package callback

import (
	"net/http"
	"time"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
)

type connectedOAuthCallbackRequest struct {
	user *adapterauth.AuthenticatedUser
	code string
}

func prepareConnectedOAuthCallbackRequest(
	w http.ResponseWriter,
	r *http.Request,
	authUserGetter func(r *http.Request) *adapterauth.AuthenticatedUser,
	stateCookieName string,
) (*connectedOAuthCallbackRequest, bool) {
	if handler.HandleCORS(w, r) {
		return nil, false
	}

	if r.Method != http.MethodGet {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return nil, false
	}

	user := authUserGetter(r)
	if user == nil {
		handler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
		return nil, false
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		handler.JSONError(w, http.StatusBadRequest, "Missing code")
		return nil, false
	}

	state := r.URL.Query().Get("state")
	stateCookie, err := r.Cookie(stateCookieName)
	if err != nil || stateCookie.Value != state {
		handler.JSONError(w, http.StatusBadRequest, "Invalid state")
		return nil, false
	}

	clearOAuthStateCookie(w, stateCookieName)
	return &connectedOAuthCallbackRequest{user: user, code: code}, true
}

func clearOAuthStateCookie(w http.ResponseWriter, cookieName string) {
	domain := auth.GetCookieDomain()
	http.SetCookie(w, &http.Cookie{ //nolint:gosec // clearing an OAuth state cookie requires matching the original provider cookie attributes.
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteNoneMode,
		Domain:   domain,
	})
}
