package signin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/stretchr/testify/assert"
	"golang.org/x/oauth2"
)

type stubGitHubProvider struct{}

func (stubGitHubProvider) GetAuthCodeURL(state string, _ ...oauth2.AuthCodeOption) string {
	return "https://github.example.com/oauth?state=" + state
}

func (stubGitHubProvider) Exchange(context.Context, string, ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	return &oauth2.Token{AccessToken: "token"}, nil
}

func (stubGitHubProvider) GetUserInfo(context.Context, *oauth2.Token) (*providers.GitHubUser, error) {
	return &providers.GitHubUser{Email: "stub@example.com"}, nil
}

func TestGitHubSigninHandler_FactoryRedirect(t *testing.T) {
	t.Setenv("GITHUB_CLIENT_ID", "client")
	t.Setenv("GITHUB_CLIENT_SECRET", "secret")
	t.Setenv("GITHUB_REDIRECT_URL", "https://auth.example.com/callback")

	original := githubSigninFactory
	githubSigninFactory = func(_, _, _ string) providers.GitHubProvider {
		return stubGitHubProvider{}
	}
	t.Cleanup(func() { githubSigninFactory = original })

	req := httptest.NewRequest(http.MethodGet, "/api/auth/signin/github", nil)
	rr := httptest.NewRecorder()
	GitHubSigninHandler(rr, req)

	assert.Equal(t, http.StatusTemporaryRedirect, rr.Code)
	assert.Contains(t, rr.Header().Get("Location"), "github.example.com")
}
