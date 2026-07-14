package testutils

import (
	"context"

	"github.com/TaskForceAI/auth-service/pkg/providers"
	"golang.org/x/oauth2"
	"google.golang.org/api/idtoken"
)

type MockGoogleClient struct {
	AuthURL    string
	Token      *oauth2.Token
	TokenErr   error
	User       *providers.GoogleUser
	UserErr    error
	Payload    *idtoken.Payload
	PayloadErr error
}

func (m *MockGoogleClient) GetAuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string {
	return m.AuthURL
}

func (m *MockGoogleClient) Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	return m.Token, m.TokenErr
}

func (m *MockGoogleClient) GetUserInfo(ctx context.Context, token *oauth2.Token) (*providers.GoogleUser, error) {
	return m.User, m.UserErr
}

func (m *MockGoogleClient) ValidateIDToken(ctx context.Context, idToken string, audience string) (*idtoken.Payload, error) {
	return m.Payload, m.PayloadErr
}
