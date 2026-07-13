package providers

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVerifyIdentityToken_ParseError(t *testing.T) {
	client := NewAppleClient("com.taskforceai.app")
	_, err := client.VerifyIdentityToken("not-a-jwt")
	assert.Error(t, err)
}

func TestVerifyIdentityToken_MissingKid(t *testing.T) {
	client := NewAppleClient("com.taskforceai.app")
	token := jwt.NewWithClaims(jwt.SigningMethodNone, &AppleClaims{})
	signed, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	_, err = client.VerifyIdentityToken(signed)
	assert.Error(t, err)
}

func TestRefreshJWKS_NonOKStatus(t *testing.T) {
	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(strings.NewReader("{}")),
		}, nil
	})

	err := client.refreshJWKS()
	assert.Error(t, err)
}

func TestRefreshJWKS_InvalidJSON(t *testing.T) {
	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader("{")),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	err := client.refreshJWKS()
	assert.Error(t, err)
}

func TestGetPublicKey_KeyMissingAfterRefresh(t *testing.T) {
	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"keys":[]}`)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	_, err := client.getPublicKey("missing-kid")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no usable RSA keys")
}
