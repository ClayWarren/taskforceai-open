package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
)

const oauthProviderTimeout = 10 * time.Second

type GitHubProvider interface {
	GetAuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string
	Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error)
	GetUserInfo(ctx context.Context, token *oauth2.Token) (*GitHubUser, error)
}

type GitHubUser struct {
	ID    int64  `json:"id"`
	Login string `json:"login"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

// GitHubClient implements GitHubProvider using standard libs.
type GitHubClient struct {
	Config  *oauth2.Config
	BaseURL string
}

func NewGitHubClient(config *oauth2.Config) *GitHubClient {
	return &GitHubClient{
		Config:  config,
		BaseURL: "https://api.github.com",
	}
}

func DefaultGitHubOAuthConfig(clientID, clientSecret, redirectURL string) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     github.Endpoint,
		RedirectURL:  redirectURL,
		Scopes:       []string{"read:user"},
	}
}

func (c *GitHubClient) GetAuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string {
	return c.Config.AuthCodeURL(state, opts...)
}

func (c *GitHubClient) Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, oauthProviderTimeout)
	defer cancel()
	return c.Config.Exchange(timeoutCtx, code, opts...)
}

func (c *GitHubClient) GetUserInfo(ctx context.Context, token *oauth2.Token) (*GitHubUser, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, oauthProviderTimeout)
	defer cancel()
	client := c.Config.Client(timeoutCtx, token)
	req, err := http.NewRequestWithContext(timeoutCtx, http.MethodGet, c.BaseURL+"/user", nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("github userinfo request failed with status %d: %s", resp.StatusCode, string(body))
	}

	var user GitHubUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}
	if user.ID <= 0 {
		return nil, fmt.Errorf("github userinfo response missing id")
	}
	if user.Login == "" {
		return nil, fmt.Errorf("github userinfo response missing login")
	}

	return &user, nil
}
