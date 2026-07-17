package callback

import (
	"context"
	"errors"
	appdatabase "github.com/TaskForceAI/auth-service/pkg/database"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
)

type GitHubCallbackHandlerStruct struct {
	GitHub         providers.GitHubProvider
	AuthUserGetter func(r *http.Request) *adapterauth.AuthenticatedUser
	GetQueries     func(ctx context.Context) (*db.Queries, error)
}

func (h *GitHubCallbackHandlerStruct) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	callbackRequest, ok := prepareConnectedOAuthCallbackRequest(w, r, h.AuthUserGetter, "oauth_state_github")
	if !ok {
		return
	}
	user := callbackRequest.user

	token, err := h.GitHub.Exchange(r.Context(), callbackRequest.code)
	if err != nil {
		slog.Error("GitHub token exchange failed", "error", err)
		handler.JSONError(w, http.StatusInternalServerError, "Failed to exchange token")
		return
	}
	if token == nil || strings.TrimSpace(token.AccessToken) == "" {
		slog.Error("GitHub token exchange returned empty token")
		handler.JSONError(w, http.StatusBadGateway, "Invalid OAuth token response")
		return
	}

	ghUser, err := h.GitHub.GetUserInfo(r.Context(), token)
	if err != nil {
		slog.Error("GitHub user info retrieval failed", "error", err)
		handler.JSONError(w, http.StatusInternalServerError, "Failed to get GitHub user info")
		return
	}
	if ghUser == nil || ghUser.ID <= 0 {
		slog.Error("GitHub user info response missing required identifier")
		handler.JSONError(w, http.StatusBadGateway, "Invalid GitHub user response")
		return
	}

	providerAccountID := strconv.FormatInt(ghUser.ID, 10)
	scope := "repo,read:user"

	q, ok := handler.RequireQueries(w, r, h.GetQueries)
	if !ok {
		return
	}

	if err := replaceOAuthAccount(
		r.Context(),
		q,
		user.ID,
		auth.CreateAccountInput{
			UserID:            user.ID,
			Type:              "oauth",
			Provider:          "github",
			ProviderAccountID: providerAccountID,
			AccessToken:       &token.AccessToken,
			TokenType:         &token.TokenType,
			Scope:             &scope,
		},
	); err != nil {
		if errors.Is(err, errOAuthAccountDatabaseConnection) {
			handler.JSONError(w, http.StatusInternalServerError, "Database connection failed")
			return
		}
		handler.GetLogger().Error("GitHub transaction failed", map[string]any{"error": err.Error()})
		handler.JSONError(w, http.StatusInternalServerError, "Failed to update account")
		return
	}

	// Redirect back to profile
	http.Redirect(w, r, "/dashboard?modal=profile&tab=apps", http.StatusTemporaryRedirect)
}

func GitHubCallbackHandler(w http.ResponseWriter, r *http.Request) {
	clientID := strings.TrimSpace(os.Getenv("GITHUB_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("GITHUB_CLIENT_SECRET"))
	redirectURL := strings.TrimSpace(os.Getenv("GITHUB_REDIRECT_URL"))

	if clientID == "" || clientSecret == "" || redirectURL == "" {
		slog.Error("GitHub OAuth configuration missing", "hasClientID", clientID != "", "hasClientSecret", clientSecret != "", "hasRedirectURL", redirectURL != "")
		handler.JSONError(w, http.StatusInternalServerError, "GitHub OAuth not configured")
		return
	}

	config := providers.DefaultGitHubOAuthConfig(clientID, clientSecret, redirectURL)
	client := providers.NewGitHubClient(config)
	h := &GitHubCallbackHandlerStruct{
		GitHub:         client,
		AuthUserGetter: handler.GetAuthenticatedUser,
		GetQueries:     appdatabase.GetQueries,
	}
	h.ServeHTTP(w, r)
}
