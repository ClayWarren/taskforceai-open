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

func TestJwkToRSAPublicKey_Invalid(t *testing.T) {
	_, err := jwkToRSAPublicKey(appleJWK{N: "!!", E: "!!"})
	assert.Error(t, err)
}

func TestJwkToRSAPublicKey_InvalidExponent(t *testing.T) {
	_, err := jwkToRSAPublicKey(appleJWK{
		N: base64.RawURLEncoding.EncodeToString([]byte{1, 2, 3}),
		E: "!!",
	})
	assert.Error(t, err)
}

func TestJwkToRSAPublicKey_Valid(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	eBytes := big.NewInt(int64(key.E)).Bytes()
	e := base64.RawURLEncoding.EncodeToString(eBytes)

	pub, err := jwkToRSAPublicKey(appleJWK{N: n, E: e})
	require.NoError(t, err)
	assert.NotNil(t, pub)
}

func TestGetPublicKey_FromCache(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	client := NewAppleClient("com.taskforceai.app")
	client.jwksCache.keys["kid1"] = &key.PublicKey
	client.jwksCache.expiresAt = time.Now().Add(time.Hour)

	pub, err := client.getPublicKey("kid1")
	require.NoError(t, err)
	assert.Equal(t, &key.PublicKey, pub)
}

func TestRefreshJWKS(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())
	jwks := `{"keys":[{"kty":"RSA","kid":"kid1","use":"sig","alg":"RS256","n":"` + n + `","e":"` + e + `"}]}`

	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(jwks)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	err = client.refreshJWKS()
	require.NoError(t, err)
	if assert.NotNil(t, client.jwksCache.keys["kid1"]) {
		assert.True(t, client.jwksCache.expiresAt.After(time.Now()))
	}
}

func TestRefreshJWKS_CreateRequestError(t *testing.T) {
	previousURL := appleJWKSURL
	appleJWKSURL = "\n"
	t.Cleanup(func() { appleJWKSURL = previousURL })

	client := NewAppleClient("com.taskforceai.app")
	err := client.refreshJWKS()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create request")
}

func TestRefreshJWKSSkipsInvalidRSAKeys(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())
	jwks := `{"keys":[` +
		`{"kty":"RSA","kid":"bad","use":"sig","alg":"RS256","n":"!!","e":"!!"},` +
		`{"kty":"RSA","kid":"good","use":"sig","alg":"RS256","n":"` + n + `","e":"` + e + `"}` +
		`]}`
	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(jwks)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	require.NoError(t, client.refreshJWKS())
	assert.Nil(t, client.jwksCache.keys["bad"])
	assert.NotNil(t, client.jwksCache.keys["good"])
}

func TestGetPublicKey_MissingAfterRefresh(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	n := base64.RawURLEncoding.EncodeToString(key.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes())
	jwks := `{"keys":[{"kty":"RSA","kid":"other","use":"sig","alg":"RS256","n":"` + n + `","e":"` + e + `"}]}`
	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(jwks)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	keyOut, err := client.getPublicKey("missing")

	assert.Nil(t, keyOut)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "key not found")
}

func TestVerifyIdentityToken_Success(t *testing.T) {
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	n := base64.RawURLEncoding.EncodeToString(privKey.N.Bytes())
	e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(privKey.E)).Bytes())
	jwks := `{"keys":[{"kty":"RSA","kid":"kid1","use":"sig","alg":"RS256","n":"` + n + `","e":"` + e + `"}]}`

	clientID := "com.taskforceai.app"
	client := NewAppleClient(clientID)
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(jwks)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	claims := AppleClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    appleIssuer,
			Audience:  []string{clientID},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			Subject:   "sub",
		},
		Email: "user@example.com",
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = "kid1"
	signed, err := token.SignedString(privKey)
	require.NoError(t, err)

	out, err := client.VerifyIdentityToken(signed)
	require.NoError(t, err)
	if assert.NotNil(t, out) {
		assert.Equal(t, "user@example.com", out.Email)
	}
}

func TestInvalidAppleToken(t *testing.T) {
	assert.True(t, invalidAppleToken(nil))
	assert.True(t, invalidAppleToken(&jwt.Token{Valid: false}))
	assert.False(t, invalidAppleToken(&jwt.Token{Valid: true}))
}

type roundTripperFunc func(req *http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
