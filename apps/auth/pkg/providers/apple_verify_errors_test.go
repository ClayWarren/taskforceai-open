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

func TestVerifyIdentityToken_WrongAudience(t *testing.T) {
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	n := base64.RawURLEncoding.EncodeToString(privKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(privKey.E)).Bytes())
	jwks := `{"keys":[{"kty":"RSA","kid":"kid1","use":"sig","alg":"RS256","n":"` + n + `","e":"` + e + `"}]}`

	client := NewAppleClient("com.expected.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(jwks)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"sub": "user-1",
		"aud": "com.other.app",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	})
	token.Header["kid"] = "kid1"
	signed, err := token.SignedString(privKey)
	require.NoError(t, err)

	_, err = client.VerifyIdentityToken(signed)
	assert.Error(t, err)
}

func TestVerifyIdentityToken_InvalidParsedToken(t *testing.T) {
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	client := NewAppleClient("com.taskforceai.app")
	client.jwksCache.keys["kid1"] = &privKey.PublicKey
	client.jwksCache.expiresAt = time.Now().Add(time.Hour)

	original := parseAppleTokenWithClaims
	parseAppleTokenWithClaims = func(string, jwt.Claims, jwt.Keyfunc, ...jwt.ParserOption) (*jwt.Token, error) {
		return &jwt.Token{Valid: false}, nil
	}
	t.Cleanup(func() { parseAppleTokenWithClaims = original })

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"sub": "user-1",
		"aud": "com.taskforceai.app",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
	})
	token.Header["kid"] = "kid1"
	signed, err := token.SignedString(privKey)
	require.NoError(t, err)

	_, err = client.VerifyIdentityToken(signed)
	assert.Error(t, err)
}

func TestRefreshJWKS_HTTPError(t *testing.T) {
	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusInternalServerError, Body: io.NopCloser(strings.NewReader("fail"))}, nil
	})
	err := client.refreshJWKS()
	assert.Error(t, err)
}
