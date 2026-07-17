package providers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/oauth2"
)

func TestGitHubClient_GetAuthCodeURL(t *testing.T) {
	config := DefaultGitHubOAuthConfig("client_id", "client_secret", "http://localhost/callback")
	client := NewGitHubClient(config)

	url := client.GetAuthCodeURL("state")
	assert.Contains(t, url, "client_id")
	assert.Contains(t, url, "state")
}

func TestGitHubClient_GetUserInfo(t *testing.T) {
	// Mock GitHub API server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/user", r.URL.Path)
		user := GitHubUser{
			ID:    1,
			Login: "testuser",
			Email: "test@example.com",
			Name:  "Test User",
		}
		_ = json.NewEncoder(w).Encode(user)
	}))
	defer server.Close()

	config := &oauth2.Config{
		Endpoint: oauth2.Endpoint{
			AuthURL:  server.URL + "/auth",
			TokenURL: server.URL + "/token",
		},
	}
	client := NewGitHubClient(config)
	client.BaseURL = server.URL

	token := &oauth2.Token{AccessToken: "fake-token"}
	user, err := client.GetUserInfo(context.Background(), token)

	require.NoError(t, err)
	assert.Equal(t, int64(1), user.ID)
	assert.Equal(t, "testuser", user.Login)
}

func TestGitHubClient_GetUserInfoAppliesProviderTimeout(t *testing.T) {
	transport := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		deadline, ok := req.Context().Deadline()
		assert.True(t, ok)
		assert.LessOrEqual(t, time.Until(deadline), oauthProviderTimeout)
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"id":1,"login":"testuser"}`)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})
	client := NewGitHubClient(&oauth2.Config{})
	client.BaseURL = "https://github.example"
	ctx := context.WithValue(context.Background(), oauth2.HTTPClient, &http.Client{Transport: transport})

	_, err := client.GetUserInfo(ctx, &oauth2.Token{AccessToken: "token"})
	require.NoError(t, err)
}

func TestGitHubClient_GetUserInfo_NonOKStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"bad credentials"}`))
	}))
	defer server.Close()

	config := &oauth2.Config{
		Endpoint: oauth2.Endpoint{
			AuthURL:  server.URL + "/auth",
			TokenURL: server.URL + "/token",
		},
	}
	client := NewGitHubClient(config)
	client.BaseURL = server.URL

	token := &oauth2.Token{AccessToken: "fake-token"}
	user, err := client.GetUserInfo(context.Background(), token)

	require.Error(t, err)
	assert.Nil(t, user)
}

func TestGitHubClient_Exchange(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/token", r.URL.Path)
		assert.NoError(t, r.ParseForm())
		assert.Equal(t, "code", r.Form.Get("code"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"token","token_type":"bearer"}`))
	}))
	defer server.Close()

	config := &oauth2.Config{
		ClientID:     "client",
		ClientSecret: "secret",
		RedirectURL:  "https://auth.example.com/callback",
		Endpoint: oauth2.Endpoint{
			AuthURL:  server.URL + "/auth",
			TokenURL: server.URL + "/token",
		},
	}
	client := NewGitHubClient(config)

	token, err := client.Exchange(context.Background(), "code")

	require.NoError(t, err)
	assert.Equal(t, "token", token.AccessToken)
	assert.True(t, strings.EqualFold("bearer", token.TokenType))
}

func TestGitHubClient_GetUserInfo_InvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("{"))
	}))
	defer server.Close()

	config := &oauth2.Config{
		Endpoint: oauth2.Endpoint{
			AuthURL:  server.URL + "/auth",
			TokenURL: server.URL + "/token",
		},
	}
	client := NewGitHubClient(config)
	client.BaseURL = server.URL

	_, err := client.GetUserInfo(context.Background(), &oauth2.Token{AccessToken: "fake-token"})
	assert.Error(t, err)
}

func TestGitHubClient_GetUserInfo_RequestBuildError(t *testing.T) {
	config := &oauth2.Config{}
	client := NewGitHubClient(config)
	client.BaseURL = "://bad-url"

	user, err := client.GetUserInfo(context.Background(), &oauth2.Token{AccessToken: "fake-token"})

	assert.Nil(t, user)
	require.Error(t, err)
}

func TestGitHubClient_GetUserInfo_MalformedUser(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":0,"login":""}`))
	}))
	defer server.Close()

	config := &oauth2.Config{
		Endpoint: oauth2.Endpoint{
			AuthURL:  server.URL + "/auth",
			TokenURL: server.URL + "/token",
		},
	}
	client := NewGitHubClient(config)
	client.BaseURL = server.URL

	_, err := client.GetUserInfo(context.Background(), &oauth2.Token{AccessToken: "fake-token"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing id")
}

func TestGitHubClient_GetUserInfo_MissingLogin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":1,"login":""}`))
	}))
	defer server.Close()

	config := &oauth2.Config{
		Endpoint: oauth2.Endpoint{
			AuthURL:  server.URL + "/auth",
			TokenURL: server.URL + "/token",
		},
	}
	client := NewGitHubClient(config)
	client.BaseURL = server.URL

	_, err := client.GetUserInfo(context.Background(), &oauth2.Token{AccessToken: "fake-token"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing login")
}

func TestDefaultGitHubOAuthConfig(t *testing.T) {
	config := DefaultGitHubOAuthConfig("id", "secret", "url")
	assert.Equal(t, "id", config.ClientID)
	assert.Equal(t, "secret", config.ClientSecret)
	assert.Equal(t, "url", config.RedirectURL)
}
