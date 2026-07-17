package mobile

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/api/idtoken"
)

func TestGoogleAuthenticationTimeClaimVariants(t *testing.T) {
	assert.True(t, googleAuthenticationTime(nil).IsZero())
	assert.Equal(t, time.Unix(12, 0).UTC(), googleAuthenticationTime(&idtoken.Payload{Claims: map[string]any{"auth_time": float64(12)}}))
	assert.Equal(t, time.Unix(13, 0).UTC(), googleAuthenticationTime(&idtoken.Payload{Claims: map[string]any{"auth_time": int64(13)}}))
	assert.Equal(t, time.Unix(14, 0).UTC(), googleAuthenticationTime(&idtoken.Payload{Claims: map[string]any{"auth_time": json.Number("14")}}))
	assert.Equal(t, time.Unix(15, 0).UTC(), googleAuthenticationTime(&idtoken.Payload{IssuedAt: 15, Claims: map[string]any{}}))
	assert.True(t, googleAuthenticationTime(&idtoken.Payload{Claims: map[string]any{"auth_time": json.Number("bad")}}).IsZero())
	assert.True(t, googleAuthenticationTime(&idtoken.Payload{Claims: map[string]any{"auth_time": "12"}}).IsZero())
}

func TestCachedAppleClientRepairsInvalidLoadOrStoreValue(t *testing.T) {
	original := loadOrStoreAppleClient
	t.Cleanup(func() { loadOrStoreAppleClient = original })
	loadOrStoreAppleClient = func(any, any) (any, bool) { return "invalid", true }
	audience := "com.taskforceai.invalid-load-or-store"
	t.Cleanup(func() { appleClientCache.Delete(audience) })

	client := cachedAppleClient(audience)
	require.NotNil(t, client)
	assert.Same(t, client, mustLoadAppleClient(t, audience))
}

func TestMobileMFAResponseHandlesPendingTokenFailure(t *testing.T) {
	original := createPendingMobileLoginToken
	t.Cleanup(func() { createPendingMobileLoginToken = original })
	createPendingMobileLoginToken = func(auth.SessionUser, string) (string, error) {
		return "", errors.New("sign failed")
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/mobile", nil)
	writeMobileSessionResponseAt(w, r, &auth.AuthUser{ID: 7, Email: "mfa@example.com", MFAEnabled: true}, nil, "test", time.Now())
	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestCachedAppleClientDropsInvalidCachedValues(t *testing.T) {
	audience := "com.taskforceai.invalid-cache"
	appleClientCache.Store(audience, "invalid")
	t.Cleanup(func() { appleClientCache.Delete(audience) })

	client := cachedAppleClient(audience)
	require.NotNil(t, client)
	assert.Same(t, client, mustLoadAppleClient(t, audience))
}

func mustLoadAppleClient(t *testing.T, audience string) any {
	t.Helper()
	client, ok := appleClientCache.Load(audience)
	require.True(t, ok)
	return client
}
