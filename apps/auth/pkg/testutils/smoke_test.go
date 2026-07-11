package testutils

import (
	"context"
	"testing"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/workos/workos-go/v6/pkg/sso"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

// TestMockRepository_Methods verifies MockRepository methods return expected values
func TestMockRepository_Methods(t *testing.T) {
	ctx := context.Background()
	repo := &MockRepository{}

	t.Run("FindByEmail returns configured values", func(t *testing.T) {
		user, err := repo.FindByEmail(ctx, "test@example.com")
		assert.Nil(t, user, "Default mock should return nil user")
		require.NoError(t, err, "Default mock should return nil error")

		// Configure mock
		expectedUser := &auth.AuthUser{ID: 1, Email: "test@example.com"}
		repo.FindByEmailUser = expectedUser
		user, err = repo.FindByEmail(ctx, "test@example.com")
		assert.Equal(t, expectedUser, user)
		assert.NoError(t, err)
	})

	t.Run("FindByID returns configured values", func(t *testing.T) {
		repo := &MockRepository{}
		user, err := repo.FindByID(ctx, 1)
		assert.Nil(t, user)
		require.NoError(t, err)

		expectedUser := &auth.AuthUser{ID: 1}
		repo.FindByIDUser = expectedUser
		user, err = repo.FindByID(ctx, 1)
		assert.Equal(t, expectedUser, user)
		assert.NoError(t, err)
	})

	t.Run("FindExistingUser returns configured values", func(t *testing.T) {
		repo := &MockRepository{}
		record, err := repo.FindExistingUser(ctx, "test@example.com")
		assert.Nil(t, record)
		assert.NoError(t, err)
	})

	t.Run("CreateUser returns configured values", func(t *testing.T) {
		repo := &MockRepository{}
		record, err := repo.CreateUser(ctx, auth.RegisterUserInput{Email: "test@example.com"})
		assert.Nil(t, record)
		require.NoError(t, err)

		expectedRecord := &auth.RegisterUserRecord{ID: 1}
		repo.CreateUserRecord = expectedRecord
		record, err = repo.CreateUser(ctx, auth.RegisterUserInput{})
		assert.Equal(t, expectedRecord, record)
		assert.NoError(t, err)
	})

	t.Run("GetAccountByProvider returns configured values", func(t *testing.T) {
		repo := &MockRepository{}
		account, err := repo.GetAccountByProvider(ctx, "google", "12345")
		assert.Nil(t, account)
		assert.NoError(t, err)
	})

	t.Run("CreateAccount returns configured values", func(t *testing.T) {
		repo := &MockRepository{}
		account, err := repo.CreateAccount(ctx, auth.CreateAccountInput{})
		assert.Nil(t, account)
		assert.NoError(t, err)
	})

	t.Run("GetUserByAccount returns configured values", func(t *testing.T) {
		repo := &MockRepository{}
		user, err := repo.GetUserByAccount(ctx, "google", "12345")
		assert.Nil(t, user)
		assert.NoError(t, err)
	})

	t.Run("DeviceLogin methods return configured values", func(t *testing.T) {
		repo := &MockRepository{}

		// FindActiveLoginByCodes
		login, err := repo.FindActiveLoginByCodes(ctx, "device", "user")
		assert.Nil(t, login)
		require.NoError(t, err)

		// CreateLogin
		login, err = repo.CreateLogin(ctx, auth.DeviceLoginCreateInput{ExpiresAt: time.Now()})
		assert.NotNil(t, login, "CreateLogin should return a record with input values")
		require.NoError(t, err)

		// FindByUserCode
		login, err = repo.FindByUserCode(ctx, "user-code")
		assert.Nil(t, login)
		require.NoError(t, err)

		// FindByDeviceCode
		login, err = repo.FindByDeviceCode(ctx, "device-code")
		assert.Nil(t, login)
		require.NoError(t, err)

		// UpdateLogin
		err = repo.UpdateLogin(ctx, 1, auth.DeviceLoginUpdate{})
		require.NoError(t, err)

		// MarkDeviceLoginAsCompleted
		completed, err := repo.MarkDeviceLoginAsCompleted(ctx, 1)
		assert.False(t, completed)
		require.NoError(t, err)

		// FindUserByID
		deviceUser, err := repo.FindUserByID(ctx, 1)
		assert.Nil(t, deviceUser)
		assert.NoError(t, err)
	})

	t.Run("CreateAuditLog returns configured error", func(t *testing.T) {
		repo := &MockRepository{}
		err := repo.CreateAuditLog(ctx, auth.AuditLogWrite{})
		assert.NoError(t, err)
	})
}

// TestMockGoogleClient_Methods verifies MockGoogleClient methods return expected values
func TestMockGoogleClient_Methods(t *testing.T) {
	ctx := context.Background()
	gm := &MockGoogleClient{}

	t.Run("GetAuthCodeURL returns configured URL", func(t *testing.T) {
		url := gm.GetAuthCodeURL("state")
		assert.Empty(t, url, "Default mock should return empty URL")

		gm.AuthURL = "https://accounts.google.com/auth"
		url = gm.GetAuthCodeURL("state")
		assert.Equal(t, "https://accounts.google.com/auth", url)
	})

	t.Run("Exchange returns configured token", func(t *testing.T) {
		token, err := gm.Exchange(ctx, "code")
		assert.Nil(t, token)
		assert.NoError(t, err)
	})

	t.Run("GetUserInfo returns configured user", func(t *testing.T) {
		info, err := gm.GetUserInfo(ctx, nil)
		assert.Nil(t, info)
		assert.NoError(t, err)
	})

	t.Run("ValidateIDToken returns configured claims", func(t *testing.T) {
		claims, err := gm.ValidateIDToken(ctx, "token", "nonce")
		assert.Nil(t, claims)
		assert.NoError(t, err)
	})
}

// TestMockWorkOSClient_Methods verifies MockWorkOSClient methods return expected values
func TestMockWorkOSClient_Methods(t *testing.T) {
	ctx := context.Background()
	wm := &MockWorkOSClient{}

	t.Run("GetHostedAuthURL returns configured URL", func(t *testing.T) {
		// Default mock returns a predictable URL with client ID
		url, err := wm.GetHostedAuthURL(usermanagement.GetAuthorizationURLOpts{ClientID: "test-client"})
		assert.Equal(t, "https://api.workos.com/hosted-auth?client_id=test-client", url)
		require.NoError(t, err)

		// With configured URL
		wm.AuthURL = "https://custom.url.com/auth"
		url, err = wm.GetHostedAuthURL(usermanagement.GetAuthorizationURLOpts{})
		assert.Equal(t, "https://custom.url.com/auth", url)
		assert.NoError(t, err)
	})

	t.Run("AuthenticateWithCode returns configured response", func(t *testing.T) {
		resp, err := wm.AuthenticateWithCode(ctx, usermanagement.AuthenticateWithCodeOpts{})
		assert.Equal(t, usermanagement.AuthenticateResponse{}, resp)
		assert.NoError(t, err)
	})

	t.Run("GetSSOAuthorizationURL returns configured URL", func(t *testing.T) {
		url, err := wm.GetSSOAuthorizationURL(sso.GetAuthorizationURLOpts{})
		assert.Empty(t, url)
		assert.NoError(t, err)
	})

	t.Run("GetSSOProfileAndToken returns configured response", func(t *testing.T) {
		resp, err := wm.GetSSOProfileAndToken(ctx, sso.GetProfileAndTokenOpts{})
		assert.Equal(t, sso.ProfileAndToken{}, resp)
		assert.NoError(t, err)
	})

	t.Run("Configure does not panic", func(t *testing.T) {
		assert.NotPanics(t, func() {
			wm.Configure("api-key", "client-id")
		})
	})
}

// TestMockAppleClient_Methods verifies MockAppleClient methods return expected values
func TestMockAppleClient_Methods(t *testing.T) {
	am := &MockAppleClient{}

	t.Run("VerifyIdentityToken returns configured claims", func(t *testing.T) {
		claims, err := am.VerifyIdentityToken("id-token")
		assert.Nil(t, claims)
		assert.NoError(t, err)
	})
}
