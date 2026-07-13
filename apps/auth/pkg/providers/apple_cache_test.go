package providers

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"io"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetPublicKey_CacheHitAfterRefresh(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())
	jwks := `{"keys":[{"kty":"RSA","kid":"kid-cache","use":"sig","alg":"RS256","n":"` + n + `","e":"` + e + `"}]}`

	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(jwks)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	pub1, err := client.getPublicKey("kid-cache")
	require.NoError(t, err)

	client.jwksCache.expiresAt = time.Now().Add(time.Hour)
	pub2, err := client.getPublicKey("kid-cache")
	require.NoError(t, err)
	assert.Equal(t, pub1, pub2)
}
