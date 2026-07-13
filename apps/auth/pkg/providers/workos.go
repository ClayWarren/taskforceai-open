package providers

import (
	"context"
	"sync"

	"github.com/workos/workos-go/v6/pkg/sso"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

// WorkOSProvider defines the interface for interacting with WorkOS.
type WorkOSProvider interface {
	// User Management (AuthKit)
	GetHostedAuthURL(opts usermanagement.GetAuthorizationURLOpts) (string, error)
	AuthenticateWithCode(ctx context.Context, opts usermanagement.AuthenticateWithCodeOpts) (usermanagement.AuthenticateResponse, error)

	// SSO
	GetSSOAuthorizationURL(opts sso.GetAuthorizationURLOpts) (string, error)
	GetSSOProfileAndToken(ctx context.Context, opts sso.GetProfileAndTokenOpts) (sso.ProfileAndToken, error)
	Configure(apiKey, clientID string) // For SSO package which uses global config sometimes
}

// WorkOSClient is the concrete implementation.
type WorkOSClient struct {
	mu sync.RWMutex

	APIKey     string
	ClientID   string
	userClient *usermanagement.Client
	ssoClient  *sso.Client
}

func NewWorkOSClient(apiKey, clientID string) *WorkOSClient {
	return &WorkOSClient{
		APIKey:     apiKey,
		ClientID:   clientID,
		userClient: usermanagement.NewClient(apiKey),
		ssoClient: &sso.Client{
			APIKey:   apiKey,
			ClientID: clientID,
		},
	}
}

func (c *WorkOSClient) GetHostedAuthURL(opts usermanagement.GetAuthorizationURLOpts) (string, error) {
	userClient, _, clientID := c.clients()
	// Ensure client ID is set if missing
	if opts.ClientID == "" {
		opts.ClientID = clientID
	}
	url, err := userClient.GetAuthorizationURL(opts)
	if err != nil {
		return "", err
	}
	return url.String(), nil
}

func (c *WorkOSClient) AuthenticateWithCode(ctx context.Context, opts usermanagement.AuthenticateWithCodeOpts) (usermanagement.AuthenticateResponse, error) {
	userClient, _, clientID := c.clients()
	if opts.ClientID == "" {
		opts.ClientID = clientID
	}
	return userClient.AuthenticateWithCode(ctx, opts)
}

func (c *WorkOSClient) GetSSOAuthorizationURL(opts sso.GetAuthorizationURLOpts) (string, error) {
	_, ssoClient, _ := c.clients()
	url, err := ssoClient.GetAuthorizationURL(opts)
	if err != nil {
		return "", err
	}
	return url.String(), nil
}

func (c *WorkOSClient) GetSSOProfileAndToken(ctx context.Context, opts sso.GetProfileAndTokenOpts) (sso.ProfileAndToken, error) {
	_, ssoClient, _ := c.clients()
	return ssoClient.GetProfileAndToken(ctx, opts)
}

func (c *WorkOSClient) Configure(apiKey, clientID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.APIKey = apiKey
	c.ClientID = clientID
	c.userClient = usermanagement.NewClient(apiKey)
	c.ssoClient = &sso.Client{
		APIKey:   apiKey,
		ClientID: clientID,
	}
}

func (c *WorkOSClient) clients() (*usermanagement.Client, *sso.Client, string) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return c.userClient, c.ssoClient, c.ClientID
}
