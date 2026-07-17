package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testAuthSecret() string {
	return strings.Join([]string{"test", "secret", "32", "characters", "long!!"}, "-")
}

// resetKeyState clears the package-level JWT key cache so each test exercises a
// fresh initKeys run.
func resetKeyState(t testing.TB) {
	t.Helper()
	ResetJWTKeysForTest()
	// Also reset on exit so a cached InitKeys result (e.g. an invalid-PEM
	// error) can't leak into later tests under go test -shuffle.
	t.Cleanup(ResetJWTKeysForTest)
}

func TestBuildSessionPayload(t *testing.T) {
	name := "John Doe"
	user := &AuthUser{
		ID:       1,
		Email:    "john@example.com",
		FullName: &name,
	}

	payload := BuildSessionPayload(user)

	if payload.ID != "1" {
		t.Errorf("Expected ID 1, got %s", payload.ID)
	}
	if payload.Email != "john@example.com" {
		t.Errorf("Expected Email john@example.com, got %s", payload.Email)
	}
	if payload.FullName != "John Doe" {
		t.Errorf("Expected FullName John Doe, got %s", payload.FullName)
	}
}

func TestGetCookieDomain(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		expected string
	}{
		{
			name:     "no whitespace",
			envValue: ".taskforceai.chat",
			expected: ".taskforceai.chat",
		},
		{
			name:     "trailing newline",
			envValue: ".taskforceai.chat\n",
			expected: ".taskforceai.chat",
		},
		{
			name:     "leading/trailing whitespace",
			envValue: "  .taskforceai.chat  \t ",
			expected: ".taskforceai.chat",
		},
		{
			name:     "empty",
			envValue: "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_ = os.Setenv("COOKIE_DOMAIN", tt.envValue)
			defer func() { _ = os.Unsetenv("COOKIE_DOMAIN") }()

			got := GetCookieDomain()
			if got != tt.expected {
				t.Errorf("GetCookieDomain() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestEncodeSessionToken(t *testing.T) {
	payload := SessionUser{
		ID:       "1",
		Email:    "john@example.com",
		FullName: "John Doe",
	}
	secret := "test_secret"

	token, err := EncodeSessionToken(payload, secret, 3600)
	if err != nil {
		t.Fatalf("Failed to encode token: %v", err)
	}
	if token == "" {
		t.Error("Generated token is empty")
	}
}

func TestApplySessionCookies(t *testing.T) {
	_ = os.Setenv("COOKIE_DOMAIN", ".example.com")
	defer func() { _ = os.Unsetenv("COOKIE_DOMAIN") }()

	w := httptest.NewRecorder()
	user := SessionUser{ID: "1", Email: "test@example.com"}
	ApplySessionCookies(w, "test_token", user, true)

	resp := w.Result()
	cookies := resp.Cookies()

	foundNames := make(map[string]bool)
	for _, c := range cookies {
		foundNames[c.Name] = true
		if c.Value != "test_token" {
			t.Errorf("Cookie %s has wrong value: %s", c.Name, c.Value)
		}
		if c.Domain != "example.com" && c.Domain != ".example.com" {
			t.Errorf("Cookie %s has wrong domain: %s", c.Name, c.Domain)
		}
	}

	expected := []string{SessionCookieName, SecureSessionCookieName}
	for _, name := range expected {
		if !foundNames[name] {
			t.Errorf("Missing expected cookie: %s", name)
		}
	}
}

func TestGetSessionTTL_Consumer(t *testing.T) {
	user := SessionUser{
		ID:    "123",
		Email: "test@example.com",
	}

	ttl := GetSessionTTL(user)
	if ttl != DefaultSessionMaxAge {
		t.Errorf("expected TTL %d for consumer, got %d", DefaultSessionMaxAge, ttl)
	}
}

func TestGetSessionTTL_Enterprise(t *testing.T) {
	orgID := "org-123"
	user := SessionUser{
		ID:    "123",
		Email: "test@example.com",
		OrgID: &orgID,
	}

	ttl := GetSessionTTL(user)
	if ttl != EnterpriseSessionMaxAge {
		t.Errorf("expected TTL %d for enterprise, got %d", EnterpriseSessionMaxAge, ttl)
	}
}

func TestGetSessionTTL_Impersonation(t *testing.T) {
	impersonatorID := "admin-456"
	user := SessionUser{
		ID:             "123",
		Email:          "test@example.com",
		ImpersonatorID: &impersonatorID,
	}

	ttl := GetSessionTTL(user)
	expectedTTL := 60 * 60 // 1 hour for impersonation
	if ttl != expectedTTL {
		t.Errorf("expected TTL %d for impersonation, got %d", expectedTTL, ttl)
	}
}

func TestInitKeys_NoKeysConfigured(t *testing.T) {
	resetKeyState(t)

	if err := os.Unsetenv("AUTH_PRIVATE_KEY"); err != nil {
		t.Fatalf("failed to unset AUTH_PRIVATE_KEY: %v", err)
	}
	if err := os.Unsetenv("AUTH_PUBLIC_KEYS"); err != nil {
		t.Fatalf("failed to unset AUTH_PUBLIC_KEYS: %v", err)
	}

	err := InitKeys()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should have no keys initialized
	if signKey != nil {
		t.Error("expected signKey to be nil when no AUTH_PRIVATE_KEY is set")
	}
	if len(verifyKeys) != 0 {
		t.Errorf("expected empty verifyKeys, got %d keys", len(verifyKeys))
	}
}

func TestInitKeys_WithPrivateKey(t *testing.T) {
	resetKeyState(t)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)})

	if err := os.Setenv("AUTH_PRIVATE_KEY", string(privPEM)); err != nil {
		t.Fatalf("failed to set AUTH_PRIVATE_KEY: %v", err)
	}
	if err := os.Unsetenv("AUTH_PUBLIC_KEYS"); err != nil {
		t.Fatalf("failed to unset AUTH_PUBLIC_KEYS: %v", err)
	}
	defer func() { _ = os.Unsetenv("AUTH_PRIVATE_KEY") }()

	err = InitKeys()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if signKey == nil || len(verifyKeys) == 0 {
		t.Fatalf("expected keys to be initialized")
	}
}

func TestVerifyToken_RSA(t *testing.T) {
	resetKeyState(t)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)})
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PUBLIC KEY", Bytes: x509.MarshalPKCS1PublicKey(&privateKey.PublicKey)})

	if err := os.Setenv("AUTH_PRIVATE_KEY", string(privPEM)); err != nil {
		t.Fatalf("failed to set AUTH_PRIVATE_KEY: %v", err)
	}
	if err := os.Setenv("AUTH_PUBLIC_KEYS", string(pubPEM)); err != nil {
		t.Fatalf("failed to set AUTH_PUBLIC_KEYS: %v", err)
	}
	defer func() {
		_ = os.Unsetenv("AUTH_PRIVATE_KEY")
		_ = os.Unsetenv("AUTH_PUBLIC_KEYS")
	}()

	token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"sub": "123", "exp": time.Now().Add(time.Hour).Unix()})
	signed, err := token.SignedString(privateKey)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	parsed, err := VerifyToken(signed)
	if err != nil {
		t.Fatalf("failed to verify token: %v", err)
	}
	if !parsed.Valid {
		t.Fatal("expected token to be valid")
	}
}

func TestVerifyToken_FallbackToHS256(t *testing.T) {
	resetKeyState(t)

	if err := os.Unsetenv("AUTH_PRIVATE_KEY"); err != nil {
		t.Fatalf("failed to unset AUTH_PRIVATE_KEY: %v", err)
	}
	if err := os.Unsetenv("AUTH_PUBLIC_KEYS"); err != nil {
		t.Fatalf("failed to unset AUTH_PUBLIC_KEYS: %v", err)
	}
	if err := os.Unsetenv("AUTH_PUBLIC_KEY"); err != nil {
		t.Fatalf("failed to unset AUTH_PUBLIC_KEY: %v", err)
	}
	if err := os.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!"); err != nil {
		t.Fatalf("failed to set AUTH_SECRET: %v", err)
	}
	defer func() { _ = os.Unsetenv("AUTH_SECRET") }()

	// Create a token using HS256
	user := SessionUser{ID: "123", Email: "test@example.com"}
	token, err := EncodeSessionToken(user, "test-secret-32-characters-long!!", DefaultSessionMaxAge)
	if err != nil {
		t.Fatalf("failed to encode token: %v", err)
	}

	// Verify the token
	parsed, err := VerifyToken(token)
	if err != nil {
		t.Fatalf("failed to verify token: %v", err)
	}
	if !parsed.Valid {
		t.Error("expected token to be valid")
	}
}

func TestVerifyToken_DoesNotFallbackToHS256WhenRSAConfigured(t *testing.T) {
	resetKeyState(t)

	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate key: %v", err)
	}
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)})
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PUBLIC KEY", Bytes: x509.MarshalPKCS1PublicKey(&privateKey.PublicKey)})

	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		t.Fatalf("failed to generate auth secret: %v", err)
	}
	secret := hex.EncodeToString(secretBytes)
	t.Setenv("AUTH_PRIVATE_KEY", string(privPEM))
	t.Setenv("AUTH_PUBLIC_KEYS", string(pubPEM))
	t.Setenv("AUTH_SECRET", secret)

	hsToken := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "123",
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	rawHS, err := hsToken.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("failed to sign HS token: %v", err)
	}

	parsed, err := VerifyToken(rawHS)
	require.Error(t, err)
	assert.Nil(t, parsed)
}

func TestIsTokenNearExpiry(t *testing.T) {
	now := time.Now().Unix()

	tests := []struct {
		name              string
		iat               int64
		exp               int64
		thresholdFraction float64
		expected          bool
	}{
		{
			name:              "not near expiry",
			iat:               now - 100,
			exp:               now + 100,
			thresholdFraction: 0.8,
			expected:          false, // elapsed/lifetime = 100/200 = 0.5 < 0.8
		},
		{
			name:              "near expiry",
			iat:               now - 160,
			exp:               now + 40,
			thresholdFraction: 0.8,
			expected:          true, // elapsed/lifetime = 160/200 = 0.8 >= 0.8
		},
		{
			name:              "just past halfway",
			iat:               now - 51,
			exp:               now + 49,
			thresholdFraction: 0.5,
			expected:          true, // elapsed/lifetime = 51/100 = 0.51 >= 0.5
		},
		{
			name:              "zero lifetime",
			iat:               now,
			exp:               now,
			thresholdFraction: 0.5,
			expected:          false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token := &jwt.Token{
				Claims: jwt.MapClaims{
					"iat": tt.iat,
					"exp": tt.exp,
				},
			}
			got := IsTokenNearExpiry(token, tt.thresholdFraction)
			if got != tt.expected {
				t.Errorf("IsTokenNearExpiry() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestEncodeSessionToken_ExtraClaims(t *testing.T) {
	resetKeyState(t)

	orgID := "org-123"
	internalOrgID := 456
	avatar := "https://avatar.com"
	impersonatorID := "admin-789"
	user := SessionUser{
		ID:             "1",
		Email:          "test@example.com",
		OrgID:          &orgID,
		InternalOrgID:  &internalOrgID,
		Avatar:         &avatar,
		ImpersonatorID: &impersonatorID,
	}
	secret := testAuthSecret()

	token, err := EncodeSessionToken(user, secret, 0)
	require.NoError(t, err)
	assert.NotEmpty(t, token)

	// Verify claims
	parsed, err := jwt.Parse(token, func(token *jwt.Token) (any, error) {
		return []byte(secret), nil
	})
	require.NoError(t, err)
	claims, ok := parsed.Claims.(jwt.MapClaims)
	assert.True(t, ok)
	assert.Equal(t, orgID, claims["workos_org_id"])
	assert.Equal(t, float64(internalOrgID), claims["org_id"])
	assert.Equal(t, avatar, claims["picture"])
	assert.Equal(t, impersonatorID, claims["act_as"])
}

func TestEncodeSessionToken_NoSecret(t *testing.T) {
	resetKeyState(t)

	user := SessionUser{ID: "1"}
	_, err := EncodeSessionToken(user, "", 0)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "AUTH_SECRET is required")
}

func TestInitKeys_InvalidPrivateKey(t *testing.T) {
	resetKeyState(t)

	t.Setenv("AUTH_PRIVATE_KEY", "invalid-pem")
	err := InitKeys()
	assert.Error(t, err)
}

func TestInitKeys_InvalidPublicKey(t *testing.T) {
	resetKeyState(t)

	t.Setenv("AUTH_PUBLIC_KEYS", "invalid-pem")
	err := InitKeys()
	require.NoError(t, err) // Warning logged, but doesn't return error
	assert.Empty(t, verifyKeys)
}

func TestInitKeys_RejectsSignerMissingFromExplicitVerifierSet(t *testing.T) {
	resetKeyState(t)

	signer, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(signer)})
	otherPublicPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PUBLIC KEY", Bytes: x509.MarshalPKCS1PublicKey(&other.PublicKey)})
	t.Setenv("AUTH_PRIVATE_KEY", string(privatePEM))
	t.Setenv("AUTH_PUBLIC_KEYS", string(otherPublicPEM))

	err = InitKeys()
	require.Error(t, err)
	assert.ErrorContains(t, err, "AUTH_PRIVATE_KEY is not present")
}

func TestIsTokenNearExpiry_InvalidClaims(t *testing.T) {
	// 1. Not MapClaims
	assert.False(t, IsTokenNearExpiry(&jwt.Token{}, 0.5))

	// 2. Missing iat/exp
	token := &jwt.Token{Claims: jwt.MapClaims{"sub": "123"}}
	assert.False(t, IsTokenNearExpiry(token, 0.5))

	// 3. Wrong type for iat
	token = &jwt.Token{Claims: jwt.MapClaims{"iat": "string", "exp": float64(123)}}
	assert.False(t, IsTokenNearExpiry(token, 0.5))
}

func BenchmarkVerifyTokenHS256(b *testing.B) {
	resetKeyState(b)
	secret := testAuthSecret()
	b.Setenv("AUTH_SECRET", secret)
	b.Setenv("AUTH_PRIVATE_KEY", "")
	b.Setenv("AUTH_PUBLIC_KEYS", "")
	b.Setenv("AUTH_PUBLIC_KEY", "")

	user := SessionUser{ID: "123", Email: "benchmark@example.com", FullName: "Benchmark User"}
	token, err := EncodeSessionToken(user, secret, DefaultSessionMaxAge)
	require.NoError(b, err)

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		parsed, err := VerifyToken(token)
		if err != nil {
			b.Fatal(err)
		}
		if !parsed.Valid {
			b.Fatal("expected token to be valid")
		}
	}
}

func BenchmarkEncodeSessionTokenHS256(b *testing.B) {
	resetKeyState(b)
	secret := testAuthSecret()
	b.Setenv("AUTH_PRIVATE_KEY", "")
	b.Setenv("AUTH_PUBLIC_KEYS", "")
	b.Setenv("AUTH_PUBLIC_KEY", "")

	user := SessionUser{ID: "123", Email: "benchmark@example.com", FullName: "Benchmark User"}

	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		token, err := EncodeSessionToken(user, secret, DefaultSessionMaxAge)
		if err != nil {
			b.Fatal(err)
		}
		if token == "" {
			b.Fatal("expected token")
		}
	}
}

func TestGetSessionCookieOptions(t *testing.T) {
	// 1. Secure (prod)
	opts := GetSessionCookieOptions(3600, true)
	assert.True(t, opts.Secure)
	assert.Equal(t, http.SameSiteLaxMode, opts.SameSite)

	// 2. Insecure (dev)
	opts = GetSessionCookieOptions(3600, false)
	assert.False(t, opts.Secure)
	assert.Equal(t, http.SameSiteLaxMode, opts.SameSite)
}

func TestVerifyToken_RSA_Missing(t *testing.T) {
	resetKeyState(t)
	t.Setenv("AUTH_SECRET", "")

	_, err := VerifyToken("token")
	assert.Error(t, err)
}
