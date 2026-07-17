package providers

import (
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetPublicKey_DoubleCheckAfterRefreshLock(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("refresh should not run after cache is repopulated")
	})

	client.jwksCache.keys["kid-dc"] = &key.PublicKey
	client.jwksCache.expiresAt = time.Now().Add(-time.Hour)
	client.jwksCache.refreshMu.Lock()

	var wg sync.WaitGroup
	const callers = 8
	wg.Add(callers)
	pubs := make([]*rsa.PublicKey, callers)
	errs := make([]error, callers)
	for i := range callers {
		go func(i int) {
			defer wg.Done()
			pubs[i], errs[i] = client.getPublicKey("kid-dc")
		}(i)
	}

	time.Sleep(50 * time.Millisecond)
	client.jwksCache.mu.Lock()
	client.jwksCache.expiresAt = time.Now().Add(time.Hour)
	client.jwksCache.mu.Unlock()
	client.jwksCache.refreshMu.Unlock()
	wg.Wait()

	for i := range callers {
		require.NoError(t, errs[i])
		assert.NotNil(t, pubs[i])
	}
}
