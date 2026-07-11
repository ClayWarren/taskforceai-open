package testutils

import (
	"context"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/oauth2"
)

func TestMockGitHubClient_GetAuthCodeURL(t *testing.T) {
	m := &MockGitHubClient{
		AuthURL: "http://mock-auth-url",
	}
	url := m.GetAuthCodeURL("state")
	assert.Equal(t, "http://mock-auth-url", url)
}

func TestMockGitHubClient_Exchange(t *testing.T) {
	expectedToken := &oauth2.Token{AccessToken: "fake-token"}
	m := &MockGitHubClient{
		Token: expectedToken,
	}
	token, err := m.Exchange(context.Background(), "code")
	require.NoError(t, err)
	assert.Equal(t, expectedToken, token)
}

func TestMockGitHubClient_GetUserInfo(t *testing.T) {
	expectedUser := &providers.GitHubUser{
		ID:    1,
		Login: "mockuser",
		Email: "mock@example.com",
	}
	m := &MockGitHubClient{
		User: expectedUser,
	}
	user, err := m.GetUserInfo(context.Background(), &oauth2.Token{})
	require.NoError(t, err)
	assert.Equal(t, expectedUser, user)
}
