package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEncodeSessionToken_RS256Path(t *testing.T) {
	ResetJWTKeysForTest()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)})
	t.Setenv("AUTH_PRIVATE_KEY", string(privPEM))
	t.Cleanup(func() {
		ResetJWTKeysForTest()
		_ = os.Unsetenv("AUTH_PRIVATE_KEY")
	})

	require.NoError(t, InitKeys())
	user := SessionUser{ID: "9", Email: "rs256@example.com"}
	token, err := EncodeSessionToken(user, "", DefaultSessionMaxAge)
	require.NoError(t, err)
	assert.NotEmpty(t, token)

	parsed, err := VerifyToken(token)
	require.NoError(t, err)
	assert.True(t, parsed.Valid)
}
