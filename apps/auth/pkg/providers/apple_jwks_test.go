package providers

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetPublicKey_KidNotFoundAfterRefresh(t *testing.T) {
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

func TestRefreshJWKS_RejectsNonRSAOnlyResponse(t *testing.T) {
	jwks := `{"keys":[{"kty":"EC","kid":"ec1","use":"sig","alg":"ES256","crv":"P-256","x":"abc","y":"def"}]}`
	client := NewAppleClient("com.taskforceai.app")
	client.httpClient.Transport = roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(jwks)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	err := client.refreshJWKS()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no usable RSA keys")
	assert.Empty(t, client.jwksCache.keys)
}
