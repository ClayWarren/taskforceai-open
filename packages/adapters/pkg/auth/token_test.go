package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var hs256TestSecret = strings.Join([]string{"test", "secret", "32", "characters", "long!!"}, "-")

func clearTokenClaimValidationEnv(t *testing.T) {
	t.Helper()

	t.Setenv("AUTH_EXPECTED_ISSUER", "")
	t.Setenv("AUTH_EXPECTED_ISS", "")
	t.Setenv("AUTH_EXPECTED_AUDIENCE", "")
	t.Setenv("AUTH_EXPECTED_AUD", "")
	t.Setenv("AUTH_URL", "")
	t.Setenv("AUTH_REQUIRE_AUD_ISS", "")
	t.Setenv("AUTH_STRICT_AUD_ISS", "")
}

func resetValidateTokenKeyCache(t *testing.T) {
	t.Helper()

	verifyKeys = nil
	verifyKeysConfigured = false
	verifyKeysErr = nil
	keysOnce = sync.Once{}
}

func mustSignHS256Token(t *testing.T, claims jwt.MapClaims) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(hs256TestSecret))
	require.NoError(t, err)

	return tokenStr
}

func TestValidateToken_HS256(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_SECRET", hs256TestSecret)

	claims := jwt.MapClaims{
		"sub": "123",
		"exp": time.Now().Add(time.Hour).Unix(),
	}
	tokenStr := mustSignHS256Token(t, claims)

	validated, err := ValidateToken(tokenStr)
	require.NoError(t, err)
	assert.Equal(t, "123", validated["sub"])
}

func TestValidateToken_Invalid(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_SECRET", "secret")
	_, err := ValidateToken("invalid")
	assert.Error(t, err)
}

func TestValidateToken_RequiresExpirationClaim(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_SECRET", hs256TestSecret)

	tokenStr := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "123",
	})

	_, err := ValidateToken(tokenStr)
	assert.ErrorContains(t, err, "missing exp claim")
}

func TestValidateToken_RejectsExpiredToken(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_SECRET", hs256TestSecret)

	tokenStr := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "123",
		"exp": time.Now().Add(-time.Minute).Unix(),
	})

	_, err := ValidateToken(tokenStr)
	assert.Error(t, err)
}

func TestValidateToken_EnforcesIssuerAndAudienceWhenPresent(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_SECRET", hs256TestSecret)
	t.Setenv("AUTH_EXPECTED_ISSUER", "https://auth.taskforceai.chat/")
	t.Setenv("AUTH_EXPECTED_AUDIENCE", "taskforce-api")

	tokenStr := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "123",
		"iss": "https://auth.taskforceai.chat",
		"aud": []any{"taskforce-api", "other-audience"},
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	claims, err := ValidateToken(tokenStr)
	require.NoError(t, err)
	assert.Equal(t, "123", claims["sub"])
}

func TestValidateToken_AllowsLegacyMissingIssuerAudienceByDefault(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_SECRET", hs256TestSecret)
	t.Setenv("AUTH_EXPECTED_ISSUER", "https://auth.taskforceai.chat")
	t.Setenv("AUTH_EXPECTED_AUDIENCE", "taskforce-api")

	tokenStr := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "legacy-user",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	claims, err := ValidateToken(tokenStr)
	require.NoError(t, err)
	assert.Equal(t, "legacy-user", claims["sub"])
}

func TestValidateToken_RejectsMismatchedIssuerOrAudience(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_SECRET", hs256TestSecret)
	t.Setenv("AUTH_EXPECTED_ISSUER", "https://auth.taskforceai.chat")
	t.Setenv("AUTH_EXPECTED_AUDIENCE", "taskforce-api")

	mismatchedIssuer := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "123",
		"iss": "https://evil.example.com",
		"aud": "taskforce-api",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	_, err := ValidateToken(mismatchedIssuer)
	require.ErrorContains(t, err, "issuer mismatch")

	mismatchedAudience := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "123",
		"iss": "https://auth.taskforceai.chat",
		"aud": "some-other-service",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	_, err = ValidateToken(mismatchedAudience)
	assert.ErrorContains(t, err, "audience mismatch")
}

func TestValidateToken_StrictModeRequiresIssuerAndAudience(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_SECRET", hs256TestSecret)
	t.Setenv("AUTH_EXPECTED_ISSUER", "https://auth.taskforceai.chat")
	t.Setenv("AUTH_EXPECTED_AUDIENCE", "taskforce-api")
	t.Setenv("AUTH_REQUIRE_AUD_ISS", "true")

	missingBoth := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "strict-user",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	_, err := ValidateToken(missingBoth)
	require.ErrorContains(t, err, "missing issuer claim")

	missingAudience := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "strict-user",
		"iss": "https://auth.taskforceai.chat",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	_, err = ValidateToken(missingAudience)
	assert.ErrorContains(t, err, "missing audience claim")
}

func TestValidateToken_DoesNotFallbackToHS256WhenRSAConfigured(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PUBLIC KEY",
		Bytes: x509.MarshalPKCS1PublicKey(&privateKey.PublicKey),
	})

	t.Setenv("AUTH_PUBLIC_KEYS", string(pubPEM))
	t.Setenv("AUTH_SECRET", hs256TestSecret)

	tokenStr := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	_, err = ValidateToken(tokenStr)
	assert.Error(t, err)
}

func TestValidateToken_DoesNotFallbackToHS256WhenRSAPublicKeyMalformed(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_PUBLIC_KEY", "not a public key")
	t.Setenv("AUTH_SECRET", hs256TestSecret)

	tokenStr := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	_, err := ValidateToken(tokenStr)
	require.Error(t, err)
	assert.ErrorContains(t, err, "invalid RSA public key configuration")
}

func TestValidateToken_RejectsConfiguredButEmptyRSAKeys(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_PUBLIC_KEYS", " , ")
	t.Setenv("AUTH_SECRET", hs256TestSecret)

	tokenStr := mustSignHS256Token(t, jwt.MapClaims{
		"sub": "123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	_, err := ValidateToken(tokenStr)
	require.ErrorContains(t, err, "invalid RSA public key configuration")
}

func TestValidateToken_RequiresAuthSecretForHMACFallback(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_SECRET", "")

	_, err := ValidateToken("invalid")
	require.ErrorContains(t, err, "invalid token")
}

func mustSignRS256Token(t *testing.T, privateKey *rsa.PrivateKey, claims jwt.MapClaims) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tokenStr, err := token.SignedString(privateKey)
	require.NoError(t, err)

	return tokenStr
}

func TestValidateToken_RejectsCustomRSAAlgorithmName(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PUBLIC KEY",
		Bytes: x509.MarshalPKCS1PublicKey(&privateKey.PublicKey),
	})

	t.Setenv("AUTH_PUBLIC_KEYS", string(pubPEM))

	method := &jwt.SigningMethodRSA{Name: "NOPE", Hash: crypto.SHA256}
	jwt.RegisterSigningMethod(method.Alg(), func() jwt.SigningMethod { return method })
	tokenStr, err := jwt.NewWithClaims(method, jwt.MapClaims{
		"sub": "custom-rsa",
		"exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString(privateKey)
	require.NoError(t, err)

	_, err = ValidateToken(tokenStr)
	require.ErrorContains(t, err, "invalid RSA signing method")
}

func TestValidateToken_RS256Success(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PUBLIC KEY",
		Bytes: x509.MarshalPKCS1PublicKey(&privateKey.PublicKey),
	})

	t.Setenv("AUTH_PUBLIC_KEYS", string(pubPEM))

	tokenStr := mustSignRS256Token(t, privateKey, jwt.MapClaims{
		"sub": "rsa-user",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	claims, err := ValidateToken(tokenStr)
	require.NoError(t, err)
	assert.Equal(t, "rsa-user", claims["sub"])
}

func TestTokenClaimValidationEdgeBranches(t *testing.T) {
	clearTokenClaimValidationEnv(t)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	rsToken := mustSignRS256Token(t, privateKey, jwt.MapClaims{
		"sub": "rsa-token",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	claims, ok, err := validateHMACToken(rsToken, hs256TestSecret)
	assert.Nil(t, claims)
	assert.False(t, ok)
	require.NoError(t, err)

	claims, ok, err = validateHMACToken("not-a-token", hs256TestSecret)
	assert.Nil(t, claims)
	assert.False(t, ok)
	require.NoError(t, err)

	claims, ok, err = validHMACClaims(nil)
	assert.Nil(t, claims)
	assert.False(t, ok)
	require.NoError(t, err)

	claims, ok, err = validHMACClaims(&jwt.Token{Method: jwt.SigningMethodHS256, Claims: jwt.RegisteredClaims{}})
	assert.Nil(t, claims)
	assert.False(t, ok)
	require.NoError(t, err)

	require.ErrorContains(t, validateRequiredExpirationClaim(jwt.MapClaims{"exp": "bad"}), "invalid exp")
	require.ErrorContains(t, validateRequiredExpirationClaim(jwt.MapClaims{"exp": float64(time.Now().Add(-time.Hour).Unix())}), "expired")

	cfg := tokenClaimValidationConfig{
		expectedIssuers:   map[string]struct{}{"issuer": {}},
		expectedAudiences: map[string]struct{}{"audience": {}},
	}
	require.ErrorContains(t, validateExpectedIssuerClaim(jwt.MapClaims{"iss": 123}, cfg), "issuer claim type")
	require.ErrorContains(t, validateExpectedAudienceClaim(jwt.MapClaims{"aud": 123}, cfg), "audience claim type")

	audiences, hasAudience, err := audiencesFromClaims(jwt.MapClaims{"aud": "   "})
	require.NoError(t, err)
	assert.Nil(t, audiences)
	assert.False(t, hasAudience)

	audiences, hasAudience, err = audiencesFromClaims(jwt.MapClaims{"aud": []any{"   "}})
	require.NoError(t, err)
	assert.Nil(t, audiences)
	assert.False(t, hasAudience)
}

func TestValidateToken_RS256RejectsMissingExpiration(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PUBLIC KEY",
		Bytes: x509.MarshalPKCS1PublicKey(&privateKey.PublicKey),
	})

	t.Setenv("AUTH_PUBLIC_KEYS", string(pubPEM))

	tokenStr := mustSignRS256Token(t, privateKey, jwt.MapClaims{
		"sub": "rsa-user",
	})

	_, err = ValidateToken(tokenStr)
	assert.ErrorContains(t, err, "missing exp claim")
}

func TestValidateToken_SkipsEmptyPublicKeyParts(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PUBLIC KEY",
		Bytes: x509.MarshalPKCS1PublicKey(&privateKey.PublicKey),
	})

	t.Setenv("AUTH_PUBLIC_KEYS", " , "+string(pubPEM))

	tokenStr := mustSignRS256Token(t, privateKey, jwt.MapClaims{
		"sub": "123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	claims, err := ValidateToken(tokenStr)
	require.NoError(t, err)
	assert.Equal(t, "123", claims["sub"])
}

func TestValidateToken_SkipsMalformedPublicKeyWhenRotationHasValidKey(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PUBLIC KEY",
		Bytes: x509.MarshalPKCS1PublicKey(&privateKey.PublicKey),
	})

	t.Setenv("AUTH_PUBLIC_KEYS", "not a public key,"+string(pubPEM))

	tokenStr := mustSignRS256Token(t, privateKey, jwt.MapClaims{
		"sub": "rotation-user",
		"exp": time.Now().Add(time.Hour).Unix(),
	})

	claims, err := ValidateToken(tokenStr)
	require.NoError(t, err)
	assert.Equal(t, "rotation-user", claims["sub"])
}

func TestValidateToken_RejectsUnexpectedHS256Algorithm(t *testing.T) {
	resetValidateTokenKeyCache(t)
	clearTokenClaimValidationEnv(t)
	t.Setenv("AUTH_SECRET", hs256TestSecret)

	token := jwt.NewWithClaims(jwt.SigningMethodHS384, jwt.MapClaims{
		"sub": "123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenStr, err := token.SignedString([]byte(hs256TestSecret))
	require.NoError(t, err)

	_, err = ValidateToken(tokenStr)
	assert.Error(t, err)
}

func TestTokenClaimValidationHelpers(t *testing.T) {
	clearTokenClaimValidationEnv(t)

	t.Setenv("AUTH_EXPECTED_AUDIENCE", " api ,")
	t.Setenv("AUTH_EXPECTED_AUD", "mobile")
	t.Setenv("AUTH_EXPECTED_ISSUER", "https://auth.taskforceai.chat/")
	t.Setenv("AUTH_EXPECTED_ISS", "https://issuer.example.com/")
	t.Setenv("AUTH_REQUIRE_AUD_ISS", "yes")

	cfg := tokenClaimValidationConfigFromEnv()
	_, hasAPI := cfg.expectedAudiences["api"]
	_, hasMobile := cfg.expectedAudiences["mobile"]
	_, hasIssuer := cfg.expectedIssuers["https://auth.taskforceai.chat"]
	_, hasAltIssuer := cfg.expectedIssuers["https://issuer.example.com"]
	assert.True(t, hasAPI)
	assert.True(t, hasMobile)
	assert.True(t, hasIssuer)
	assert.True(t, hasAltIssuer)
	assert.True(t, cfg.requireClaims)
}

func TestIssuerAndAudienceClaimParsing(t *testing.T) {
	issuer, ok, err := issuerFromClaims(jwt.MapClaims{"iss": " https://auth.taskforceai.chat/ "})
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "https://auth.taskforceai.chat/", issuer)

	_, ok, err = issuerFromClaims(jwt.MapClaims{"iss": " "})
	require.NoError(t, err)
	assert.False(t, ok)

	_, _, err = issuerFromClaims(jwt.MapClaims{"iss": 123})
	require.ErrorContains(t, err, "issuer claim type")

	audiences, ok, err := audiencesFromClaims(jwt.MapClaims{"aud": []string{" api ", "", "mobile"}})
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, []string{"api", "mobile"}, audiences)

	audiences, ok, err = audiencesFromClaims(jwt.MapClaims{"aud": []any{"api", " ", "mobile"}})
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, []string{"api", "mobile"}, audiences)

	audiences, ok, err = audiencesFromClaims(jwt.MapClaims{"aud": " api "})
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, []string{"api"}, audiences)

	_, _, err = audiencesFromClaims(jwt.MapClaims{"aud": []any{"api", 123}})
	require.ErrorContains(t, err, "audience claim type")

	_, ok, err = audiencesFromClaims(jwt.MapClaims{"aud": []string{" "}})
	require.NoError(t, err)
	assert.False(t, ok)

	_, _, err = audiencesFromClaims(jwt.MapClaims{"aud": 123})
	assert.ErrorContains(t, err, "audience claim type")
}
