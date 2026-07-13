package auth

import (
	"os"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVerifyToken_HS256Fallback(t *testing.T) {
	secret := "test_secret_must_be_long_enough_32_chars"
	_ = os.Setenv("AUTH_SECRET", secret)
	_ = os.Unsetenv("AUTH_PUBLIC_KEY")
	_ = os.Unsetenv("AUTH_PUBLIC_KEYS")
	_ = os.Unsetenv("AUTH_PRIVATE_KEY")
	_ = os.Unsetenv("AUTH_EXPECTED_ISSUER")
	_ = os.Unsetenv("AUTH_EXPECTED_ISS")
	_ = os.Unsetenv("AUTH_EXPECTED_AUDIENCE")
	_ = os.Unsetenv("AUTH_EXPECTED_AUD")
	_ = os.Unsetenv("AUTH_REQUIRE_AUD_ISS")
	_ = os.Unsetenv("AUTH_STRICT_AUD_ISS")
	t.Cleanup(func() {
		_ = os.Unsetenv("AUTH_SECRET")
		_ = os.Unsetenv("AUTH_EXPECTED_ISSUER")
		_ = os.Unsetenv("AUTH_EXPECTED_ISS")
		_ = os.Unsetenv("AUTH_EXPECTED_AUDIENCE")
		_ = os.Unsetenv("AUTH_EXPECTED_AUD")
		_ = os.Unsetenv("AUTH_REQUIRE_AUD_ISS")
		_ = os.Unsetenv("AUTH_STRICT_AUD_ISS")
		ResetJWTKeysForTest()
	})

	ResetJWTKeysForTest()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	parsed, err := VerifyToken(signed)
	require.NoError(t, err)
	require.NotNil(t, parsed)
	assert.True(t, parsed.Valid)
}

func TestVerifyTokenRejectsMissingExpiration(t *testing.T) {
	secret := "test_secret_must_be_long_enough_32_chars"
	t.Setenv("AUTH_SECRET", secret)
	t.Setenv("AUTH_PUBLIC_KEY", "")
	t.Setenv("AUTH_PUBLIC_KEYS", "")
	t.Setenv("AUTH_PRIVATE_KEY", "")
	t.Setenv("AUTH_REQUIRE_AUD_ISS", "")
	t.Setenv("AUTH_STRICT_AUD_ISS", "")
	t.Cleanup(ResetJWTKeysForTest)
	ResetJWTKeysForTest()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "1",
	})
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	parsed, err := VerifyToken(signed)
	require.Error(t, err)
	assert.Nil(t, parsed)
}

func TestVerifyTokenRejectsInvalidConfiguredPublicKeyBeforeHS256Fallback(t *testing.T) {
	secret := "test_secret_must_be_long_enough_32_chars"
	t.Setenv("AUTH_SECRET", secret)
	t.Setenv("AUTH_PUBLIC_KEY", "not-a-public-key")
	t.Setenv("AUTH_PUBLIC_KEYS", "")
	t.Setenv("AUTH_PRIVATE_KEY", "")
	t.Cleanup(ResetJWTKeysForTest)
	ResetJWTKeysForTest()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	parsed, err := VerifyToken(signed)
	require.Error(t, err)
	assert.Nil(t, parsed)
	assert.Contains(t, err.Error(), "invalid JWT public key configuration")
}

func TestVerifyTokenEnforcesStrictIssuerAndAudience(t *testing.T) {
	secret := "test_secret_must_be_long_enough_32_chars"
	t.Setenv("AUTH_SECRET", secret)
	t.Setenv("AUTH_PUBLIC_KEY", "")
	t.Setenv("AUTH_PUBLIC_KEYS", "")
	t.Setenv("AUTH_PRIVATE_KEY", "")
	t.Setenv("AUTH_EXPECTED_ISSUER", "https://auth.example.com")
	t.Setenv("AUTH_EXPECTED_ISS", "")
	t.Setenv("AUTH_EXPECTED_AUDIENCE", "taskforceai")
	t.Setenv("AUTH_EXPECTED_AUD", "")
	t.Setenv("AUTH_REQUIRE_AUD_ISS", "true")
	t.Setenv("AUTH_STRICT_AUD_ISS", "")
	t.Cleanup(ResetJWTKeysForTest)
	ResetJWTKeysForTest()

	missingClaims := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "1",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	missingSigned, err := missingClaims.SignedString([]byte(secret))
	require.NoError(t, err)

	parsed, err := VerifyToken(missingSigned)
	require.Error(t, err)
	assert.Nil(t, parsed)

	validClaims := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "1",
		"exp": time.Now().Add(time.Hour).Unix(),
		"iss": "https://auth.example.com",
		"aud": "taskforceai",
	})
	validSigned, err := validClaims.SignedString([]byte(secret))
	require.NoError(t, err)

	parsed, err = VerifyToken(validSigned)
	require.NoError(t, err)
	require.NotNil(t, parsed)
	assert.True(t, parsed.Valid)
}
