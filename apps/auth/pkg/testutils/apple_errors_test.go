package testutils

import (
	"errors"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMockAppleClient_VerifyError(t *testing.T) {
	am := &MockAppleClient{ValidationErr: errors.New("verify failed")}
	_, err := am.VerifyIdentityToken("token")
	assert.Error(t, err)
}

func TestMockAppleClient_VerifySuccess(t *testing.T) {
	am := &MockAppleClient{
		ValidationResponse: &providers.AppleClaims{Email: "user@example.com"},
	}
	claims, err := am.VerifyIdentityToken("token")
	require.NoError(t, err)
	assert.Equal(t, "user@example.com", claims.Email)
}
