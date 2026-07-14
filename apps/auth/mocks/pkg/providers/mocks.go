package mocks

import (
	"context"

	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/stretchr/testify/mock"
	"github.com/workos/workos-go/v6/pkg/sso"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
	"golang.org/x/oauth2"
	"google.golang.org/api/idtoken"
)

type testingT interface {
	mock.TestingT
	Cleanup(func())
}

func register[T interface{ AssertExpectations(mock.TestingT) bool }](t testingT, m T) T {
	t.Cleanup(func() { m.AssertExpectations(t) })
	return m
}

func typedResult[T any](args mock.Arguments) (T, error) {
	var zero T
	if v := args.Get(0); v != nil {
		if typed, ok := v.(T); ok {
			return typed, args.Error(1)
		}
	}
	return zero, args.Error(1)
}

type AppleProvider struct{ mock.Mock }

func NewAppleProvider(t testingT) *AppleProvider {
	return register(t, &AppleProvider{})
}

func (m *AppleProvider) VerifyIdentityToken(token string) (*providers.AppleClaims, error) {
	return typedResult[*providers.AppleClaims](m.Called(token))
}

type GoogleProvider struct{ mock.Mock }

func NewGoogleProvider(t testingT) *GoogleProvider {
	return register(t, &GoogleProvider{})
}

func (m *GoogleProvider) GetAuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string {
	args := m.Called(append([]any{state}, authCodeOptionsArg(opts)...)...)
	return args.String(0)
}

func (m *GoogleProvider) Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	return typedResult[*oauth2.Token](m.Called(append([]any{ctx, code}, authCodeOptionsArg(opts)...)...))
}

func (m *GoogleProvider) GetUserInfo(ctx context.Context, token *oauth2.Token) (*providers.GoogleUser, error) {
	return typedResult[*providers.GoogleUser](m.Called(ctx, token))
}

func (m *GoogleProvider) ValidateIDToken(ctx context.Context, idToken string, audience string) (*idtoken.Payload, error) {
	return typedResult[*idtoken.Payload](m.Called(ctx, idToken, audience))
}

func authCodeOptionsArg(opts []oauth2.AuthCodeOption) []any {
	if len(opts) == 0 {
		return nil
	}
	return []any{opts}
}

type WorkOSProvider struct{ mock.Mock }

func NewWorkOSProvider(t testingT) *WorkOSProvider {
	return register(t, &WorkOSProvider{})
}

func (m *WorkOSProvider) GetHostedAuthURL(opts usermanagement.GetAuthorizationURLOpts) (string, error) {
	args := m.Called(opts)
	return args.String(0), args.Error(1)
}

func (m *WorkOSProvider) AuthenticateWithCode(ctx context.Context, opts usermanagement.AuthenticateWithCodeOpts) (usermanagement.AuthenticateResponse, error) {
	return typedResult[usermanagement.AuthenticateResponse](m.Called(ctx, opts))
}

func (m *WorkOSProvider) GetSSOAuthorizationURL(opts sso.GetAuthorizationURLOpts) (string, error) {
	args := m.Called(opts)
	return args.String(0), args.Error(1)
}

func (m *WorkOSProvider) GetSSOProfileAndToken(ctx context.Context, opts sso.GetProfileAndTokenOpts) (sso.ProfileAndToken, error) {
	return typedResult[sso.ProfileAndToken](m.Called(ctx, opts))
}

func (m *WorkOSProvider) Configure(apiKey, clientID string) {
	m.Called(apiKey, clientID)
}
