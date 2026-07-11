package providers

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGitHubUser_Struct(t *testing.T) {
	user := GitHubUser{
		ID:    12345,
		Login: "testuser",
		Email: "test@example.com",
		Name:  "Test User",
	}

	assert.Equal(t, int64(12345), user.ID)
	assert.Equal(t, "testuser", user.Login)
	assert.Equal(t, "test@example.com", user.Email)
	assert.Equal(t, "Test User", user.Name)
}

func TestGitHubClient_Struct(t *testing.T) {
	client := &GitHubClient{}
	assert.NotNil(t, client)
}

func TestWorkOSClient_Struct(t *testing.T) {
	client := &WorkOSClient{
		APIKey:   "test-key",
		ClientID: "test-client",
	}

	assert.Equal(t, "test-key", client.APIKey)
	assert.Equal(t, "test-client", client.ClientID)
}
