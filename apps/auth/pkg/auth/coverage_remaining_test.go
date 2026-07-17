package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestContainsRSAPublicKeyDefensiveInputs(t *testing.T) {
	assert.False(t, containsRSAPublicKey(nil, nil))
	assert.False(t, containsRSAPublicKey(nil, &rsa.PublicKey{}))
	target := &rsa.PublicKey{N: big.NewInt(17), E: 65537}
	assert.False(t, containsRSAPublicKey([]*rsa.PublicKey{nil, {N: big.NewInt(19), E: 65537}}, target))
	assert.True(t, containsRSAPublicKey([]*rsa.PublicKey{{N: big.NewInt(17), E: 65537}}, target))
}

func TestSessionTokensRejectFutureAuthenticationTime(t *testing.T) {
	resetKeyState(t)
	t.Setenv("AUTH_PRIVATE_KEY", "")
	t.Setenv("AUTH_PUBLIC_KEYS", "")
	t.Setenv("AUTH_SECRET", testAuthSecret())
	future := time.Now().Add(10 * time.Minute)
	user := SessionUser{ID: "1", Email: "future@example.com", AuthenticatedAt: &future}

	_, err := EncodeSessionToken(user, testAuthSecret(), 60)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "authentication time cannot be in the future")

	_, err = EncodeMFAPendingToken(user, "/", testAuthSecret())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "authentication time cannot be in the future")

	past := time.Now().Add(-time.Minute)
	valid := SessionUser{ID: "1", Email: "past@example.com", AuthenticatedAt: &past}
	_, err = EncodeSessionToken(valid, testAuthSecret(), 60)
	require.NoError(t, err)
	_, err = EncodeMFAPendingToken(valid, "/", testAuthSecret())
	require.NoError(t, err)
}

func TestInitKeysRejectsExplicitVerifierSetWithNoValidKeys(t *testing.T) {
	resetKeyState(t)
	signer, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(signer)})
	t.Setenv("AUTH_PRIVATE_KEY", string(privatePEM))
	t.Setenv("AUTH_PUBLIC_KEY", "")
	t.Setenv("AUTH_PUBLIC_KEYS", "invalid-pem")

	err = InitKeys()
	require.ErrorContains(t, err, "no valid AUTH_PUBLIC_KEYS")
}
