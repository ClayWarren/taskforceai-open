package handler

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetTokenRevokerState(t *testing.T) {
	t.Helper()
	reset := func() {
		tokenRevokerMu.Lock()
		defer tokenRevokerMu.Unlock()
		tokenRevokerOnce = sync.Once{}
		tokenRevoker = nil
		SetRedisClient(nil)
	}
	reset()
	// Also reset on exit so revoker stubs can't leak into later tests
	// (order-dependent failures under go test -shuffle).
	t.Cleanup(reset)
}

func TestTokenRevokerAdapter(t *testing.T) {
	client := newRedisTestClient()
	revoker := tokenRevokerAdapter{client: client}
	ctx := context.Background()

	require.NoError(t, revoker.Set(ctx, "key", []byte("value"), time.Minute))

	value, err := revoker.Get(ctx, "key")
	require.NoError(t, err)
	assert.Equal(t, "value", value)

	value, err = revoker.Get(ctx, "missing")
	require.NoError(t, err)
	assert.Empty(t, value)
}

func TestDefaultTokenRevocationCheck_NoConfig(t *testing.T) {
	resetTokenRevokerState(t)
	t.Setenv("GO_ENV", "")
	t.Setenv("NODE_ENV", "")
	t.Setenv("VERCEL", "")

	revoked := defaultTokenRevocationCheck(context.Background(), "token")
	assert.False(t, revoked)
}

func TestDefaultTokenRevocationCheck_NoConfigProductionFailsClosed(t *testing.T) {
	resetTokenRevokerState(t)
	t.Setenv("VERCEL", "1")

	revoked := defaultTokenRevocationCheck(context.Background(), "token")
	assert.True(t, revoked, "production revocation store outages must not allow authenticated requests")
}

func TestDefaultTokenRevocationCheck_RedisError(t *testing.T) {
	resetTokenRevokerState(t)
	tokenRevoker = errorTokenRevoker{}

	revoked := defaultTokenRevocationCheck(context.Background(), "any-token")
	assert.True(t, revoked, "revocation store errors must fail closed for authenticated requests")
}

func TestDefaultTokenRevocationCheck_Revoked(t *testing.T) {
	resetTokenRevokerState(t)
	tokenRevoker = staticTokenRevoker{value: "1"}

	revoked := defaultTokenRevocationCheck(context.Background(), "any-token")
	assert.True(t, revoked)
}

type errorTokenRevoker struct{}

func (e errorTokenRevoker) Get(_ context.Context, _ string) (string, error) {
	return "", errors.New("connection refused")
}

func (e errorTokenRevoker) Set(_ context.Context, _ string, _ []byte, _ time.Duration) error {
	return errors.New("connection refused")
}

func TestGetTokenRevokerReturnsNilWithoutEnv(t *testing.T) {
	resetTokenRevokerState(t)

	assert.Nil(t, getTokenRevoker())
}

func TestGetTokenRevokerRetriesAfterInitializationFailure(t *testing.T) {
	resetTokenRevokerState(t)

	assert.Nil(t, getTokenRevoker())

	SetRedisClient(newRedisTestClient())

	require.NotNil(t, getTokenRevoker())
}

func TestCheckTokenRevocationStrict(t *testing.T) {
	tests := []struct {
		name      string
		value     string
		err       error
		wantError string
	}{
		{
			name:  "token is active",
			value: "",
		},
		{
			name:      "token is revoked",
			value:     "1",
			wantError: "token is revoked",
		},
		{
			name:      "store error",
			err:       errors.New("redis unavailable"),
			wantError: "redis unavailable",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			resetTokenRevokerState(t)
			tokenRevoker = staticTokenRevoker{value: tc.value, err: tc.err}

			err := CheckTokenRevocationStrict(context.Background(), "raw-token")
			if tc.wantError == "" {
				assert.NoError(t, err)
			} else {
				assert.ErrorContains(t, err, tc.wantError)
			}
		})
	}
}

func TestCheckTokenRevocationStrict_StoreUnavailable(t *testing.T) {
	resetTokenRevokerState(t)

	err := CheckTokenRevocationStrict(context.Background(), "raw-token")
	assert.ErrorContains(t, err, "token revocation store unavailable")
}

type staticTokenRevoker struct {
	value string
	err   error
}

func (s staticTokenRevoker) Get(_ context.Context, _ string) (string, error) {
	return s.value, s.err
}

func (s staticTokenRevoker) Set(_ context.Context, _ string, _ []byte, _ time.Duration) error {
	return nil
}
