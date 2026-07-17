package testutils

import (
	"context"

	"github.com/workos/workos-go/v6/pkg/sso"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

type MockWorkOSClient struct {
	AuthURL         string
	AuthURLErr      error
	LastHostedOpts  usermanagement.GetAuthorizationURLOpts
	AuthResponse    usermanagement.AuthenticateResponse
	AuthErr         error
	SSOURL          string
	SSOURLErr       error
	LastSSOOpts     sso.GetAuthorizationURLOpts
	SSOProfile      sso.ProfileAndToken
	SSOErr          error
	ConfigureCalled bool
}

func (m *MockWorkOSClient) GetHostedAuthURL(opts usermanagement.GetAuthorizationURLOpts) (string, error) {
	m.LastHostedOpts = opts
	if m.AuthURLErr != nil {
		return "", m.AuthURLErr
	}
	if m.AuthURL != "" {
		return m.AuthURL, nil
	}
	// Return a predictable string for testing
	return "https://api.workos.com/hosted-auth?client_id=" + opts.ClientID, nil
}

func (m *MockWorkOSClient) AuthenticateWithCode(ctx context.Context, opts usermanagement.AuthenticateWithCodeOpts) (usermanagement.AuthenticateResponse, error) {
	if m.AuthErr != nil {
		return usermanagement.AuthenticateResponse{}, m.AuthErr
	}
	return m.AuthResponse, nil
}

func (m *MockWorkOSClient) GetSSOAuthorizationURL(opts sso.GetAuthorizationURLOpts) (string, error) {
	m.LastSSOOpts = opts
	if m.SSOURLErr != nil {
		return "", m.SSOURLErr
	}
	return m.SSOURL, nil
}

func (m *MockWorkOSClient) GetSSOProfileAndToken(ctx context.Context, opts sso.GetProfileAndTokenOpts) (sso.ProfileAndToken, error) {
	if m.SSOErr != nil {
		return sso.ProfileAndToken{}, m.SSOErr
	}
	return m.SSOProfile, nil
}

func (m *MockWorkOSClient) Configure(apiKey, clientID string) {
	m.ConfigureCalled = true
}
