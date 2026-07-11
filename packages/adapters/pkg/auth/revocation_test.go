package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockTokenRevoker struct {
	storage map[string][]byte
	setErr  error
	getErr  error
}

func (m *mockTokenRevoker) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if m.setErr != nil {
		return m.setErr
	}
	m.storage[key] = value
	return nil
}

func (m *mockTokenRevoker) Get(ctx context.Context, key string) (string, error) {
	if m.getErr != nil {
		return "", m.getErr
	}
	val, ok := m.storage[key]
	if !ok {
		return "", nil
	}
	return string(val), nil
}

func TestRevokeToken(t *testing.T) {
	store := &mockTokenRevoker{storage: make(map[string][]byte)}
	ctx := context.Background()
	token := "some-raw-token"

	// Test with expiration
	exp := time.Now().Add(time.Hour).Unix()
	claims := jwt.MapClaims{"exp": float64(exp)}
	err := RevokeToken(ctx, store, token, claims)
	require.NoError(t, err)

	revoked, err := IsTokenRevoked(ctx, store, token)
	require.NoError(t, err)
	assert.True(t, revoked)
}

// TestRevokeToken_NoExpClaim verifies that tokens without an exp claim are still
// stored in the revocation blacklist using a default TTL. Previously, RevokeToken
// returned nil without storing, making revocation a silent no-op for these tokens.
func TestRevokeToken_NoExpClaim(t *testing.T) {
	store := &mockTokenRevoker{storage: make(map[string][]byte)}
	ctx := context.Background()

	err := RevokeToken(ctx, store, "no-exp-token", jwt.MapClaims{})
	require.NoError(t, err)

	revoked, err := IsTokenRevoked(ctx, store, "no-exp-token")
	require.NoError(t, err)
	assert.True(t, revoked, "token with no exp claim must still be blacklisted after revocation")
}

// TestRevokeToken_AlreadyExpired verifies that tokens whose exp is in the past
// are stored with a default TTL rather than being silently dropped.
func TestRevokeToken_AlreadyExpired(t *testing.T) {
	store := &mockTokenRevoker{storage: make(map[string][]byte)}
	ctx := context.Background()

	pastExp := time.Now().Add(-time.Hour).Unix()
	claims := jwt.MapClaims{"exp": float64(pastExp)}

	err := RevokeToken(ctx, store, "expired-token", claims)
	require.NoError(t, err)

	revoked, err := IsTokenRevoked(ctx, store, "expired-token")
	require.NoError(t, err)
	assert.True(t, revoked, "already-expired token must still be blacklisted after revocation")
}

func TestIsTokenRevoked_Errors(t *testing.T) {
	ctx := context.Background()

	// Test nil store
	revoked, err := IsTokenRevoked(ctx, nil, "token")
	require.NoError(t, err)
	assert.False(t, revoked)

	// Test store error
	store := &mockTokenRevoker{getErr: errors.New("redis down")}
	revoked, err = IsTokenRevoked(ctx, store, "token")
	require.Error(t, err)
	assert.False(t, revoked)
}

func TestIsTokenRevoked_MissingKeyMeansActiveToken(t *testing.T) {
	ctx := context.Background()

	for _, err := range []error{
		ErrTokenRevocationKeyNotFound,
		errors.New("key not found"),
		errors.New("redis: nil"),
	} {
		store := &mockTokenRevoker{getErr: err}
		revoked, checkErr := IsTokenRevoked(ctx, store, "token")

		require.NoError(t, checkErr)
		assert.False(t, revoked)
	}
}

func TestIsRevocationKeyNotFoundNil(t *testing.T) {
	assert.False(t, isRevocationKeyNotFound(nil))
}
