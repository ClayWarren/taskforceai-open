package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/idtoken"
)

type GoogleProvider interface {
	// OAuth2 Flow
	GetAuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string
	Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error)
	GetUserInfo(ctx context.Context, token *oauth2.Token) (*GoogleUser, error)

	// ID Token Validation (Mobile/Drive)
	ValidateIDToken(ctx context.Context, idToken string, audience string) (*idtoken.Payload, error)
}

type GoogleUser struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	VerifiedEmail bool   `json:"verified_email"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

var googleUserInfoURL = "https://www.googleapis.com/oauth2/v2/userinfo"

// GoogleClient implements GoogleProvider using standard libs.
type GoogleClient struct {
	Config *oauth2.Config
}

func NewGoogleClient(config *oauth2.Config) *GoogleClient {
	return &GoogleClient{Config: config}
}

func DefaultGoogleDriveOAuthConfig(clientID, clientSecret, redirectURL string) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint:     google.Endpoint,
		RedirectURL:  redirectURL,
		Scopes: []string{
			"https://www.googleapis.com/auth/drive.readonly",
			"https://www.googleapis.com/auth/userinfo.email",
		},
	}
}

func (c *GoogleClient) GetAuthCodeURL(state string, opts ...oauth2.AuthCodeOption) string {
	return c.Config.AuthCodeURL(state, opts...)
}

func (c *GoogleClient) Exchange(ctx context.Context, code string, opts ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	return c.Config.Exchange(ctx, code, opts...)
}

func (c *GoogleClient) GetUserInfo(ctx context.Context, token *oauth2.Token) (*GoogleUser, error) {
	client := c.Config.Client(ctx, token)
	// Wrap the transport with OTel, preserving the original one if possible
	client.Transport = otelhttp.NewTransport(baseTransport(client))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, googleUserInfoURL, nil)
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
		return nil, fmt.Errorf("google userinfo request failed with status %d: %s", resp.StatusCode, string(body))
	}

	var user GoogleUser
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, err
	}
	if user.ID == "" {
		return nil, fmt.Errorf("google userinfo response missing id")
	}

	return &user, nil
}

func baseTransport(client *http.Client) http.RoundTripper {
	if client.Transport == nil {
		return http.DefaultTransport
	}
	return client.Transport
}

func (c *GoogleClient) ValidateIDToken(ctx context.Context, idToken string, audience string) (*idtoken.Payload, error) {
	return idtoken.Validate(ctx, idToken, audience)
}
