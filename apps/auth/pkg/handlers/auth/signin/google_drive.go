package signin

import (
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"golang.org/x/oauth2"
)

type GoogleDriveSigninHandlerStruct struct {
	Google providers.GoogleProvider
}

func (h *GoogleDriveSigninHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodGet {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	clientID := strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_SECRET"))
	redirectURL := strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_REDIRECT_URL"))

	if clientID == "" || clientSecret == "" || redirectURL == "" {
		slog.Error("Google Drive OAuth configuration missing", "hasClientID", clientID != "", "hasClientSecret", clientSecret != "", "hasRedirectURL", redirectURL != "")
		handler.JSONError(w, http.StatusInternalServerError, "Google OAuth not configured")
		return
	}

	state, ok := writeOAuthStateCookie(w, "oauth_state_google_drive")
	if !ok {
		return
	}

	// Force consent to ensure we get a refresh token
	authURL := h.Google.GetAuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.ApprovalForce)
	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

func GoogleDriveSigninHandler(w http.ResponseWriter, r *http.Request) {
	config := providers.DefaultGoogleDriveOAuthConfig(
		os.Getenv("GOOGLE_CLIENT_ID"),
		os.Getenv("GOOGLE_CLIENT_SECRET"),
		os.Getenv("GOOGLE_DRIVE_REDIRECT_URL"),
	)
	client := providers.NewGoogleClient(config)
	h := &GoogleDriveSigninHandlerStruct{Google: client}
	h.ServeHTTP(w, r)
}
