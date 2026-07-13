package providers

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"golang.org/x/oauth2"
)

func TestGitHubClient_GetUserInfo_TransportError(t *testing.T) {
	config := DefaultGitHubOAuthConfig("id", "secret", "http://localhost/callback")
	client := NewGitHubClient(config)
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, &http.Client{
		Transport: roundTripperFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("network down")
		}),
	})

	_, err := client.GetUserInfo(ctx, &oauth2.Token{AccessToken: "token"})
	assert.Error(t, err)
}
