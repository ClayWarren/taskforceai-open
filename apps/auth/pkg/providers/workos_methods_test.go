package providers

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/workos/workos-go/v6/pkg/sso"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

func TestWorkOSClient_Configure(t *testing.T) {
	client := NewWorkOSClient("initial-key", "initial-client")
	client.Configure("rotated-key", "rotated-client")
	assert.Equal(t, "rotated-key", client.APIKey)
	assert.Equal(t, "rotated-client", client.ClientID)
}

func TestWorkOSClient_GetHostedAuthURL_FillsClientID(t *testing.T) {
	client := NewWorkOSClient("test_api_key", "client_from_ctor")
	_, err := client.GetHostedAuthURL(usermanagement.GetAuthorizationURLOpts{
		RedirectURI: "https://auth.example.com/callback",
	})
	assert.Error(t, err)
}

func TestWorkOSClient_GetHostedAuthURL_Success(t *testing.T) {
	client := NewWorkOSClient("test_api_key", "client_from_ctor")
	url, err := client.GetHostedAuthURL(usermanagement.GetAuthorizationURLOpts{
		RedirectURI: "https://auth.example.com/callback",
		Provider:    "GoogleOAuth",
	})

	require.NoError(t, err)
	assert.Contains(t, url, "client_from_ctor")
	assert.Contains(t, url, "GoogleOAuth")
}

func TestWorkOSClient_AuthenticateWithCode_SetsClientID(t *testing.T) {
	client := NewWorkOSClient("test_api_key", "client_from_ctor")
	_, err := client.AuthenticateWithCode(context.Background(), usermanagement.AuthenticateWithCodeOpts{
		Code: "auth-code",
	})
	assert.Error(t, err)
}

func TestWorkOSClient_GetSSOAuthorizationURL_Success(t *testing.T) {
	client := NewWorkOSClient("test_api_key", "client_from_ctor")
	url, err := client.GetSSOAuthorizationURL(sso.GetAuthorizationURLOpts{
		Domain:       "example.com",
		RedirectURI:  "https://auth.example.com/callback",
		Organization: "org_test",
	})
	require.NoError(t, err)
	assert.NotEmpty(t, url)
}

func TestWorkOSClient_GetSSOAuthorizationURL_Error(t *testing.T) {
	client := NewWorkOSClient("test_api_key", "client_from_ctor")
	url, err := client.GetSSOAuthorizationURL(sso.GetAuthorizationURLOpts{
		RedirectURI: "\n",
	})
	assert.Empty(t, url)
	assert.Error(t, err)
}

func TestWorkOSClient_GetSSOProfileAndToken_Error(t *testing.T) {
	client := NewWorkOSClient("test_api_key", "client_from_ctor")
	_, err := client.GetSSOProfileAndToken(context.Background(), sso.GetProfileAndTokenOpts{
		Code: "invalid-code",
	})
	assert.Error(t, err)
}
