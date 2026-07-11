package providers

import (
	"context"
	"testing"

	"github.com/workos/workos-go/v6/pkg/sso"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
	"golang.org/x/oauth2"
)

func TestAppleClient(t *testing.T) {
	c := NewAppleClient("com.taskforceai.app")
	// Token verification requires valid JWT format and network access to Apple's JWKS
	// This test just ensures the client can be instantiated
	_, err := c.VerifyIdentityToken("invalid-token")
	if err == nil {
		t.Error("expected error for invalid token")
	}
}

func TestGoogleClient(t *testing.T) {
	conf := &oauth2.Config{
		ClientID:     "client",
		ClientSecret: "secret",
		Endpoint:     oauth2.Endpoint{AuthURL: "http://a", TokenURL: "http://b"},
	}
	c := NewGoogleClient(conf)

	_ = c.GetAuthCodeURL("state")

	ctx := context.Background()
	_, _ = c.Exchange(ctx, "code")

	// GetUserInfo
	_, _ = c.GetUserInfo(ctx, &oauth2.Token{AccessToken: "token"})

	// ValidateIDToken - this usually calls an external URL to fetch keys
	// but we can at least call the wrapper.
	_, _ = c.ValidateIDToken(ctx, "token", "aud")
}

func TestWorkOSClient(t *testing.T) {
	c := NewWorkOSClient("key", "client")
	c.Configure("key2", "client2")

	ctx := context.Background()

	// Success-ish (wrapper logic)
	_, _ = c.GetHostedAuthURL(usermanagement.GetAuthorizationURLOpts{ClientID: "c"})
	_, _ = c.AuthenticateWithCode(ctx, usermanagement.AuthenticateWithCodeOpts{Code: "code"})
	_, _ = c.GetSSOAuthorizationURL(sso.GetAuthorizationURLOpts{Domain: "d"})
	_, _ = c.GetSSOProfileAndToken(ctx, sso.GetProfileAndTokenOpts{Code: "code"})

	// Exercise the "if opts.ClientID == """ paths
	_, _ = c.GetHostedAuthURL(usermanagement.GetAuthorizationURLOpts{})
	_, _ = c.AuthenticateWithCode(ctx, usermanagement.AuthenticateWithCodeOpts{})
}
