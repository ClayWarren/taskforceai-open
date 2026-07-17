package providers

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/oauth2"
)

func TestGoogleClient_GetUserInfo_Success(t *testing.T) {
	body := `{"id":"google-1","email":"user@gmail.com","verified_email":true,"name":"Google User"}`
	transport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	conf := &oauth2.Config{
		ClientID:     "client",
		ClientSecret: "secret",
		Endpoint:     oauth2.Endpoint{AuthURL: "http://auth", TokenURL: "http://token"},
		RedirectURL:  "http://redirect",
	}
	client := NewGoogleClient(conf)
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, &http.Client{Transport: transport})

	user, err := client.GetUserInfo(ctx, &oauth2.Token{AccessToken: "token"})
	require.NoError(t, err)
	assert.Equal(t, "user@gmail.com", user.Email)
}
