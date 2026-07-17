package signin

import (
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
)

type GitHubSigninHandlerStruct struct {
	GitHub providers.GitHubProvider
}

func (h *GitHubSigninHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if handler.HandleCORS(w, r) {
		return
	}

	if r.Method != http.MethodGet {
		handler.JSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	clientID := strings.TrimSpace(os.Getenv("GITHUB_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("GITHUB_CLIENT_SECRET"))
	redirectURL := strings.TrimSpace(os.Getenv("GITHUB_REDIRECT_URL"))

	if clientID == "" || clientSecret == "" || redirectURL == "" {
		slog.Error("GitHub OAuth configuration missing", "hasClientID", clientID != "", "hasClientSecret", clientSecret != "", "hasRedirectURL", redirectURL != "")
		handler.JSONError(w, http.StatusInternalServerError, "GitHub OAuth not configured")
		return
	}

	state, ok := writeOAuthStateCookie(w, "oauth_state_github")
	if !ok {
		return
	}

	authURL := h.GitHub.GetAuthCodeURL(state)
	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

var githubSigninFactory = func(clientID, clientSecret, redirectURL string) providers.GitHubProvider {
	return providers.NewGitHubClient(providers.DefaultGitHubOAuthConfig(clientID, clientSecret, redirectURL))
}

func GitHubSigninHandler(w http.ResponseWriter, r *http.Request) {
	client := githubSigninFactory(
		os.Getenv("GITHUB_CLIENT_ID"),
		os.Getenv("GITHUB_CLIENT_SECRET"),
		os.Getenv("GITHUB_REDIRECT_URL"),
	)
	h := &GitHubSigninHandlerStruct{GitHub: client}
	h.ServeHTTP(w, r)
}
