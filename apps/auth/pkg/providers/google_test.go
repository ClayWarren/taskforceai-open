package providers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/oauth2"
)

func TestGoogleClient_GetUserInfo(t *testing.T) {
	bodyBytes, _ := json.Marshal(GoogleUser{
		ID:            "user-1",
		Email:         "user@example.com",
		VerifiedEmail: true,
		Name:          "User",
		Picture:       "pic",
	})
	transport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(string(bodyBytes))),
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
	if assert.NotNil(t, user) {
		assert.Equal(t, "user@example.com", user.Email)
		assert.True(t, user.VerifiedEmail)
	}
}

func TestGoogleClient_GetUserInfo_NonOKStatus(t *testing.T) {
	transport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusUnauthorized,
			Body:       io.NopCloser(strings.NewReader(`{"error":"invalid_token"}`)),
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

	require.Error(t, err)
	assert.Nil(t, user)
}

func TestGoogleClient_GetUserInfo_RequestBuildError(t *testing.T) {
	previousURL := googleUserInfoURL
	googleUserInfoURL = "\n"
	t.Cleanup(func() { googleUserInfoURL = previousURL })
	conf := &oauth2.Config{}
	client := NewGoogleClient(conf)

	user, err := client.GetUserInfo(context.Background(), &oauth2.Token{AccessToken: "token"})

	assert.Nil(t, user)
	require.Error(t, err)
}

func TestBaseTransportFallsBackToDefault(t *testing.T) {
	assert.Equal(t, http.DefaultTransport, baseTransport(&http.Client{}))
	custom := staticGoogleTransport{}
	assert.Equal(t, custom, baseTransport(&http.Client{Transport: custom}))
}

type staticGoogleTransport struct{}

func (staticGoogleTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{}`))}, nil
}

func TestDefaultGoogleDriveOAuthConfig(t *testing.T) {
	config := DefaultGoogleDriveOAuthConfig("client-id", "client-secret", "https://auth.example.com/callback")

	assert.Equal(t, "client-id", config.ClientID)
	assert.Equal(t, "client-secret", config.ClientSecret)
	assert.Equal(t, "https://auth.example.com/callback", config.RedirectURL)
	assert.NotEmpty(t, config.Scopes)
}

func TestGoogleClientOAuthDelegates(t *testing.T) {
	transport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "authorization_code", req.FormValue("grant_type"))
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"access_token":"token","token_type":"Bearer"}`)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})
	config := &oauth2.Config{
		ClientID:     "client",
		ClientSecret: "secret",
		Endpoint:     oauth2.Endpoint{AuthURL: "https://auth.example.com", TokenURL: "https://token.example.com"},
		RedirectURL:  "https://app.example.com/callback",
	}
	client := NewGoogleClient(config)

	authURL := client.GetAuthCodeURL("state")
	assert.Contains(t, authURL, "state=state")

	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, &http.Client{Transport: transport})
	token, err := client.Exchange(ctx, "code")
	require.NoError(t, err)
	assert.Equal(t, "token", token.AccessToken)
}

func TestGoogleClientValidateIDTokenReportsMalformedToken(t *testing.T) {
	client := NewGoogleClient(&oauth2.Config{})

	payload, err := client.ValidateIDToken(context.Background(), "not-a-jwt", "client")

	assert.Nil(t, payload)
	require.Error(t, err)
}
