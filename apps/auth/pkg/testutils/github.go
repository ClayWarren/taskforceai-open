package testutils

import (
	"context"

	"github.com/TaskForceAI/auth-service/pkg/providers"
	"golang.org/x/oauth2"
)

type MockGitHubClient struct {
	AuthURL  string
	Token    *oauth2.Token
	TokenErr error
	User     *providers.GitHubUser
	UserErr  error
}

func (m *MockGitHubClient) GetAuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string {
	return m.AuthURL
}

func (m *MockGitHubClient) Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	return m.Token, m.TokenErr
}

func (m *MockGitHubClient) GetUserInfo(ctx context.Context, token *oauth2.Token) (*providers.GitHubUser, error) {
	return m.User, m.UserErr
}
