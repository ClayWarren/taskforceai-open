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

func TestGoogleClient_GetUserInfo_DecodeError(t *testing.T) {
	transport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       http.NoBody,
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

	_, err := client.GetUserInfo(ctx, &oauth2.Token{AccessToken: "token"})
	assert.Error(t, err)
}

func TestGoogleClient_GetUserInfo_MissingID(t *testing.T) {
	transport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"email":"user@gmail.com"}`)),
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

	_, err := client.GetUserInfo(ctx, &oauth2.Token{AccessToken: "token"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing id")
}

func TestGoogleClient_GetUserInfo_TransportError(t *testing.T) {
	transport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})

	conf := &oauth2.Config{
		ClientID:     "client",
		ClientSecret: "secret",
		Endpoint:     oauth2.Endpoint{AuthURL: "http://auth", TokenURL: "http://token"},
		RedirectURL:  "http://redirect",
	}
	client := NewGoogleClient(conf)
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, &http.Client{Transport: transport})

	_, err := client.GetUserInfo(ctx, &oauth2.Token{AccessToken: "token"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), assert.AnError.Error())
}
