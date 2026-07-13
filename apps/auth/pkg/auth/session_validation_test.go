package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func clearSessionClaimEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"AUTH_EXPECTED_AUDIENCE", "AUTH_EXPECTED_AUD",
		"AUTH_EXPECTED_ISSUER", "AUTH_EXPECTED_ISS", "AUTH_URL",
		"AUTH_REQUIRE_AUD_ISS", "AUTH_STRICT_AUD_ISS",
	} {
		t.Setenv(key, "")
	}
}

func TestValidateSessionTokenClaims(t *testing.T) {
	clearSessionClaimEnv(t)

	t.Run("non map claims", func(t *testing.T) {
		token := &jwt.Token{Claims: jwt.RegisteredClaims{}}
		require.ErrorIs(t, validateSessionTokenClaims(token), ErrInvalidToken)
	})

	t.Run("missing expiry", func(t *testing.T) {
		token := &jwt.Token{Claims: jwt.MapClaims{}}
		require.ErrorIs(t, validateSessionTokenClaims(token), ErrInvalidToken)
	})

	t.Run("valid claims", func(t *testing.T) {
		token := &jwt.Token{Claims: jwt.MapClaims{"exp": float64(time.Now().Add(time.Hour).Unix())}}
		require.NoError(t, validateSessionTokenClaims(token))
	})

	t.Run("audience validation error propagates", func(t *testing.T) {
		token := &jwt.Token{Claims: jwt.MapClaims{
			"exp": float64(time.Now().Add(time.Hour).Unix()),
			"aud": []any{123}, // non-string audience element is invalid
		}}
		require.ErrorIs(t, validateSessionTokenClaims(token), ErrInvalidToken)
	})
}

func TestValidateSessionIssuer(t *testing.T) {
	t.Run("invalid issuer type", func(t *testing.T) {
		err := validateSessionIssuer(jwt.MapClaims{"iss": 123}, sessionClaimValidationConfig{})
		require.ErrorIs(t, err, ErrInvalidToken)
	})

	t.Run("empty issuer required", func(t *testing.T) {
		cfg := sessionClaimValidationConfig{expectedIssuer: "https://auth", requireAudIss: true}
		require.ErrorIs(t, validateSessionIssuer(jwt.MapClaims{}, cfg), ErrInvalidToken)
	})

	t.Run("empty issuer allowed when not required", func(t *testing.T) {
		require.NoError(t, validateSessionIssuer(jwt.MapClaims{}, sessionClaimValidationConfig{}))
	})

	t.Run("issuer mismatch", func(t *testing.T) {
		cfg := sessionClaimValidationConfig{expectedIssuer: "https://auth"}
		require.ErrorIs(t, validateSessionIssuer(jwt.MapClaims{"iss": "https://evil"}, cfg), ErrInvalidToken)
	})

	t.Run("issuer match", func(t *testing.T) {
		cfg := sessionClaimValidationConfig{expectedIssuer: "https://auth"}
		require.NoError(t, validateSessionIssuer(jwt.MapClaims{"iss": "https://auth"}, cfg))
	})
}

func TestValidateSessionAudience(t *testing.T) {
	t.Run("invalid audience type", func(t *testing.T) {
		err := validateSessionAudience(jwt.MapClaims{"aud": []any{123}}, sessionClaimValidationConfig{})
		require.ErrorIs(t, err, ErrInvalidToken)
	})

	t.Run("empty audience required", func(t *testing.T) {
		cfg := sessionClaimValidationConfig{expectedAudience: "api", requireAudIss: true}
		require.ErrorIs(t, validateSessionAudience(jwt.MapClaims{}, cfg), ErrInvalidToken)
	})

	t.Run("empty audience allowed when not required", func(t *testing.T) {
		require.NoError(t, validateSessionAudience(jwt.MapClaims{}, sessionClaimValidationConfig{}))
	})

	t.Run("no expected audience accepts any", func(t *testing.T) {
		require.NoError(t, validateSessionAudience(jwt.MapClaims{"aud": "api"}, sessionClaimValidationConfig{}))
	})

	t.Run("audience match", func(t *testing.T) {
		cfg := sessionClaimValidationConfig{expectedAudience: "api"}
		require.NoError(t, validateSessionAudience(jwt.MapClaims{"aud": []string{"other", "api"}}, cfg))
	})

	t.Run("audience mismatch", func(t *testing.T) {
		cfg := sessionClaimValidationConfig{expectedAudience: "api"}
		require.ErrorIs(t, validateSessionAudience(jwt.MapClaims{"aud": "other"}, cfg), ErrInvalidToken)
	})
}

func TestVerifyToken_VerifyKeysSetWithoutError(t *testing.T) {
	ResetJWTKeysForTest()
	t.Cleanup(ResetJWTKeysForTest)

	// Consume keysOnce so VerifyToken's InitKeys() is a no-op, then simulate a
	// state where verification keys are marked configured but none resolved and
	// no error was recorded.
	keysOnce.Do(func() {})
	verifyKeys = nil
	verifyKeysSet = true
	verifyKeysErr = nil

	_, err := VerifyToken("header.payload.signature")
	require.ErrorIs(t, err, ErrInvalidToken)
}

func TestApplySessionIssuerAudienceClaims(t *testing.T) {
	clearSessionClaimEnv(t)
	t.Setenv("AUTH_EXPECTED_ISSUER", "https://auth")
	t.Setenv("AUTH_EXPECTED_AUDIENCE", "api")

	claims := jwt.MapClaims{}
	applySessionIssuerAudienceClaims(claims)

	assert.Equal(t, "https://auth", claims["iss"])
	assert.Equal(t, "api", claims["aud"])
}
