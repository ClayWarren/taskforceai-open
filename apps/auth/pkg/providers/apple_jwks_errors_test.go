package providers

import (
	"encoding/base64"
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRefreshJWKS_TransportError(t *testing.T) {
	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return nil, errors.New("network down")
	})
	err := client.refreshJWKS()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to fetch JWKS")
}

func TestJwkToRSAPublicKey_ExponentTooLarge(t *testing.T) {
	hugeExponent := base64.RawURLEncoding.EncodeToString([]byte{0xff, 0xff, 0xff, 0xff, 0x01})
	_, err := jwkToRSAPublicKey(appleJWK{
		Kty: "RSA",
		N:   base64.RawURLEncoding.EncodeToString([]byte{0x01}),
		E:   hugeExponent,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exponent too large")
}

func TestJwkToRSAPublicKey_ExponentTooSmall(t *testing.T) {
	_, err := jwkToRSAPublicKey(appleJWK{
		Kty: "RSA",
		N:   base64.RawURLEncoding.EncodeToString([]byte{0x01}),
		E:   base64.RawURLEncoding.EncodeToString([]byte{0x01}),
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exponent")
}
