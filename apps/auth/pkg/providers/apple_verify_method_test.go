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

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVerifyIdentityToken_UnexpectedSigningMethod(t *testing.T) {
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	n := base64.RawURLEncoding.EncodeToString(privKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(privKey.E)).Bytes())
	jwks := `{"keys":[{"kty":"RSA","kid":"kid1","use":"sig","alg":"RS256","n":"` + n + `","e":"` + e + `"}]}`

	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(jwks)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "user-1",
		"aud": "com.taskforceai.app",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
		"iss": appleIssuer,
	})
	token.Header["kid"] = "kid1"
	signed, err := token.SignedString([]byte("secret"))
	require.NoError(t, err)

	_, err = client.VerifyIdentityToken(signed)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unexpected signing method")
}

func TestVerifyIdentityToken_GetPublicKeyError(t *testing.T) {
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"sub": "user-1",
		"aud": "com.taskforceai.app",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
		"iss": appleIssuer,
	})
	token.Header["kid"] = "kid-missing"
	signed, err := token.SignedString(privKey)
	require.NoError(t, err)

	_, err = client.VerifyIdentityToken(signed)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to get public key")
}
