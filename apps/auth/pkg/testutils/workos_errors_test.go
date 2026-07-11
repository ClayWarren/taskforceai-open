package testutils

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/workos/workos-go/v6/pkg/sso"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

func TestMockWorkOSClient_ErrorBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("GetHostedAuthURL error", func(t *testing.T) {
		wm := &MockWorkOSClient{AuthURLErr: errors.New("auth url failed")}
		_, err := wm.GetHostedAuthURL(usermanagement.GetAuthorizationURLOpts{})
		assert.Error(t, err)
	})

	t.Run("AuthenticateWithCode error", func(t *testing.T) {
		wm := &MockWorkOSClient{AuthErr: errors.New("auth failed")}
		_, err := wm.AuthenticateWithCode(ctx, usermanagement.AuthenticateWithCodeOpts{})
		assert.Error(t, err)
	})

	t.Run("GetSSOAuthorizationURL error", func(t *testing.T) {
		wm := &MockWorkOSClient{SSOURLErr: errors.New("sso url failed")}
		_, err := wm.GetSSOAuthorizationURL(sso.GetAuthorizationURLOpts{})
		assert.Error(t, err)
	})

	t.Run("GetSSOProfileAndToken error", func(t *testing.T) {
		wm := &MockWorkOSClient{SSOErr: errors.New("sso profile failed")}
		_, err := wm.GetSSOProfileAndToken(ctx, sso.GetProfileAndTokenOpts{})
		assert.Error(t, err)
	})
}
