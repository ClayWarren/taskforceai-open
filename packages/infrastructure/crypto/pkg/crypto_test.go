package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
)

func TestHash(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{
			input:    "hello",
			expected: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		},
		{
			input:    "world",
			expected: "486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7",
		},
		{
			input:    "",
			expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			result := Hash(tc.input)
			if result != tc.expected {
				t.Errorf("Hash(%q) = %s, want %s", tc.input, result, tc.expected)
			}
		})
	}
}

func TestHash_Deterministic(t *testing.T) {
	input := "test input"
	result1 := Hash(input)
	result2 := Hash(input)

	if result1 != result2 {
		t.Errorf("Hash should be deterministic: %s != %s", result1, result2)
	}
}

func TestHash_DifferentInputs(t *testing.T) {
	result1 := Hash("input1")
	result2 := Hash("input2")

	if result1 == result2 {
		t.Error("Different inputs should produce different hashes")
	}
}

func TestHash_Length(t *testing.T) {
	result := Hash("any input")
	// SHA-256 produces 64 hex characters (32 bytes * 2)
	if len(result) != 64 {
		t.Errorf("Expected hash length 64, got %d", len(result))
	}
}

func TestDefaultKeyVersion(t *testing.T) {
	if DefaultKeyVersion != "v1" {
		t.Errorf("Expected DefaultKeyVersion 'v1', got %s", DefaultKeyVersion)
	}
}

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) {
	return 0, errors.New("random unavailable")
}

func TestGetActiveKeyVersion_Default(t *testing.T) {
	_ = os.Unsetenv("ENCRYPTION_KEY_ACTIVE_VERSION")
	version := getActiveKeyVersion()
	if version != DefaultKeyVersion {
		t.Errorf("Expected default version %s, got %s", DefaultKeyVersion, version)
	}
}

func TestGetActiveKeyVersion_Custom(t *testing.T) {
	_ = os.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "V2")
	defer func() { _ = os.Unsetenv("ENCRYPTION_KEY_ACTIVE_VERSION") }()

	version := getActiveKeyVersion()
	if version != "v2" {
		t.Errorf("Expected version 'v2', got %s", version)
	}
}

func TestGetEncryptionKey_Missing(t *testing.T) {
	_ = os.Unsetenv("ENCRYPTION_KEY")
	_, err := getEncryptionKey("v1")
	if err == nil {
		t.Error("Expected error for missing key")
	}
}

func TestGetEncryptionKey_WrongLength(t *testing.T) {
	_ = os.Setenv("ENCRYPTION_KEY", "tooshort")
	defer func() { _ = os.Unsetenv("ENCRYPTION_KEY") }()

	_, err := getEncryptionKey("v1")
	if err == nil {
		t.Error("Expected error for wrong length key")
	}
}

func TestGetEncryptionKey_InvalidHex(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("z", 64))

	if _, err := getEncryptionKey("v1"); err == nil {
		t.Fatal("expected invalid hex error")
	}
}

func TestGetEncryptionKey_Valid(t *testing.T) {
	// 64 hex chars = 32 bytes
	validKey := strings.Repeat("a", 64)
	_ = os.Setenv("ENCRYPTION_KEY", validKey)
	defer func() { _ = os.Unsetenv("ENCRYPTION_KEY") }()

	key, err := getEncryptionKey("v1")
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if len(key) != 32 {
		t.Errorf("Expected 32 byte key, got %d", len(key))
	}
}

func TestGetEncryptionKey_VersionedKey(t *testing.T) {
	validKey := strings.Repeat("b", 64)
	_ = os.Setenv("ENCRYPTION_KEY_V2", validKey)
	defer func() { _ = os.Unsetenv("ENCRYPTION_KEY_V2") }()

	key, err := getEncryptionKey("v2")
	if err != nil {
		t.Errorf("Unexpected error: %v", err)
	}
	if len(key) != 32 {
		t.Errorf("Expected 32 byte key, got %d", len(key))
	}
}

func TestGetEncryptionKey_InvalidVersion(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY_PATH", strings.Repeat("b", 64))

	_, err := getEncryptionKey("path")
	if !errors.Is(err, ErrInvalidKeyVersion) {
		t.Fatalf("expected ErrInvalidKeyVersion, got %v", err)
	}
}

func TestIsValidKeyVersion(t *testing.T) {
	tests := []struct {
		version string
		want    bool
	}{
		{version: "v1", want: true},
		{version: "v10", want: true},
		{version: "", want: false},   // too short
		{version: "v", want: false},  // missing digits
		{version: "1", want: false},  // missing leading 'v'
		{version: "x1", want: false}, // wrong prefix
		{version: "vx", want: false}, // non-digit suffix
		{version: "v1a", want: false},
	}

	for _, tt := range tests {
		if got := isValidKeyVersion(tt.version); got != tt.want {
			t.Errorf("isValidKeyVersion(%q) = %v, want %v", tt.version, got, tt.want)
		}
	}
}

func TestEncrypt_NoKey(t *testing.T) {
	_ = os.Unsetenv("ENCRYPTION_KEY")
	_ = os.Unsetenv("ENCRYPTION_KEY_ACTIVE_VERSION")

	_, err := Encrypt("test")
	if err == nil {
		t.Error("Expected error when encryption key is missing")
	}
}

func TestEncrypt_NonceGenerationFailure(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("c", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "")

	originalReader := encryptionRandomReader
	encryptionRandomReader = errorReader{}
	t.Cleanup(func() { encryptionRandomReader = originalReader })

	encrypted, err := Encrypt("test")
	if err == nil {
		t.Fatal("expected nonce generation error")
	}
	if encrypted != "" {
		t.Fatalf("expected empty ciphertext on failure, got %q", encrypted)
	}
}

func TestEncrypt_InternalPrimitiveFailures(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("c", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "")

	t.Run("derive key", func(t *testing.T) {
		original := deriveEncryptionKey
		deriveEncryptionKey = func([]byte) ([]byte, error) {
			return nil, errors.New("derive failed")
		}
		t.Cleanup(func() { deriveEncryptionKey = original })

		encrypted, err := Encrypt("test")
		if err == nil {
			t.Fatal("expected derive error")
		}
		if encrypted != "" {
			t.Fatalf("expected empty ciphertext, got %q", encrypted)
		}
	})

	t.Run("cipher", func(t *testing.T) {
		original := newAESCipher
		newAESCipher = func([]byte) (cipher.Block, error) {
			return nil, errors.New("cipher failed")
		}
		t.Cleanup(func() { newAESCipher = original })

		encrypted, err := Encrypt("test")
		if err == nil {
			t.Fatal("expected cipher error")
		}
		if encrypted != "" {
			t.Fatalf("expected empty ciphertext, got %q", encrypted)
		}
	})

	t.Run("gcm", func(t *testing.T) {
		original := newGCMWithNonceSize
		newGCMWithNonceSize = func(cipher.Block, int) (cipher.AEAD, error) {
			return nil, errors.New("gcm failed")
		}
		t.Cleanup(func() { newGCMWithNonceSize = original })

		encrypted, err := Encrypt("test")
		if err == nil {
			t.Fatal("expected gcm error")
		}
		if encrypted != "" {
			t.Fatalf("expected empty ciphertext, got %q", encrypted)
		}
	})
}

func TestEncryptDecrypt_RoundTrip(t *testing.T) {
	// 64 hex chars = 32 bytes for AES-256
	validKey := strings.Repeat("c", 64)
	_ = os.Setenv("ENCRYPTION_KEY", validKey)
	_ = os.Unsetenv("ENCRYPTION_KEY_ACTIVE_VERSION")
	defer func() { _ = os.Unsetenv("ENCRYPTION_KEY") }()

	tests := []string{
		"hello world",
		"",
		"special chars: !@#$%^&*()",
		"unicode: 你好世界 🌍",
		strings.Repeat("long ", 1000),
	}

	for _, plaintext := range tests {
		t.Run(plaintext[:min(10, len(plaintext))], func(t *testing.T) {
			encrypted, err := Encrypt(plaintext)
			if err != nil {
				t.Fatalf("Encrypt failed: %v", err)
			}

			// Verify format: version:iv:tag:ciphertext
			parts := strings.Split(encrypted, ":")
			if len(parts) != 4 {
				t.Errorf("Expected 4 parts, got %d", len(parts))
			}

			decrypted, err := Decrypt(encrypted)
			if err != nil {
				t.Fatalf("Decrypt failed: %v", err)
			}

			if decrypted != plaintext {
				t.Errorf("Round trip failed: got %q, want %q", decrypted, plaintext)
			}
		})
	}
}

func TestDecrypt_KeyAndPrimitiveFailures(t *testing.T) {
	validEncryptedShape := "v1:" + strings.Repeat("0", IVLength*2) + ":" + strings.Repeat("1", TagLength*2) + ":22"

	t.Run("missing key", func(t *testing.T) {
		t.Setenv("ENCRYPTION_KEY", "")

		plaintext, err := Decrypt(validEncryptedShape)
		if err == nil {
			t.Fatal("expected key error")
		}
		if plaintext != "" {
			t.Fatalf("expected empty plaintext, got %q", plaintext)
		}
	})

	t.Run("derive key", func(t *testing.T) {
		t.Setenv("ENCRYPTION_KEY", strings.Repeat("d", 64))
		original := deriveEncryptionKey
		deriveEncryptionKey = func([]byte) ([]byte, error) {
			return nil, errors.New("derive failed")
		}
		t.Cleanup(func() { deriveEncryptionKey = original })

		plaintext, err := Decrypt(validEncryptedShape)
		if err == nil {
			t.Fatal("expected derive error")
		}
		if plaintext != "" {
			t.Fatalf("expected empty plaintext, got %q", plaintext)
		}
	})

	t.Run("decrypt gcm", func(t *testing.T) {
		original := newGCMWithNonceSize
		newGCMWithNonceSize = func(cipher.Block, int) (cipher.AEAD, error) {
			return nil, errors.New("gcm failed")
		}
		t.Cleanup(func() { newGCMWithNonceSize = original })

		plaintext, err := decryptWithKey(make([]byte, 32), make([]byte, IVLength), make([]byte, TagLength), []byte("ciphertext"))
		if err == nil {
			t.Fatal("expected gcm error")
		}
		if plaintext != "" {
			t.Fatalf("expected empty plaintext, got %q", plaintext)
		}
	})
}

func TestEncryptUsesActiveVersionedKey(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "V2")
	t.Setenv("ENCRYPTION_KEY_V2", strings.Repeat("2", 64))

	encrypted, err := Encrypt("versioned")
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}
	if !strings.HasPrefix(encrypted, "v2:") {
		t.Fatalf("encrypted value should include active version prefix, got %q", encrypted)
	}

	decrypted, err := Decrypt(encrypted)
	if err != nil {
		t.Fatalf("Decrypt failed: %v", err)
	}
	if decrypted != "versioned" {
		t.Fatalf("decrypted = %q, want versioned", decrypted)
	}
}

func TestDecrypt_InvalidFormat(t *testing.T) {
	_, err := Decrypt("invalid")
	if !errors.Is(err, ErrInvalidFormat) {
		t.Errorf("Expected ErrInvalidFormat, got %v", err)
	}
}

func TestDecryptWithKeyRejectsInvalidKey(t *testing.T) {
	_, err := decryptWithKey([]byte("short"), make([]byte, IVLength), make([]byte, TagLength), nil)
	if err == nil {
		t.Fatal("expected invalid key error")
	}
}

func TestDecrypt_InvalidIVOrTagLength(t *testing.T) {
	validKey := strings.Repeat("d", 64)
	t.Setenv("ENCRYPTION_KEY", validKey)

	for _, encrypted := range []string{
		"v1:aabb:00112233445566778899aabbccddeeff:00",
		"v1:00112233445566778899aabbccddeeff:aabb:00",
	} {
		t.Run(encrypted, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("Decrypt panicked: %v", r)
				}
			}()

			_, err := Decrypt(encrypted)
			if !errors.Is(err, ErrInvalidFormat) {
				t.Fatalf("Decrypt error = %v, want ErrInvalidFormat", err)
			}
		})
	}
}

func TestDecrypt_ThreePartFormat(t *testing.T) {
	// 3-part format (no version prefix) should default to v1
	validKey := strings.Repeat("d", 64)
	_ = os.Setenv("ENCRYPTION_KEY", validKey)
	defer func() { _ = os.Unsetenv("ENCRYPTION_KEY") }()

	// First encrypt something to get valid format
	encrypted, err := Encrypt("test")
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Remove version prefix to create 3-part format
	parts := strings.Split(encrypted, ":")
	threePart := strings.Join(parts[1:], ":")

	decrypted, err := Decrypt(threePart)
	if err != nil {
		t.Fatalf("Decrypt 3-part failed: %v", err)
	}

	if decrypted != "test" {
		t.Errorf("Expected 'test', got %q", decrypted)
	}
}

func TestDecrypt_WrongKey(t *testing.T) {
	validKey1 := strings.Repeat("e", 64)
	_ = os.Setenv("ENCRYPTION_KEY", validKey1)
	encrypted, err := Encrypt("secret")
	if err != nil {
		t.Fatalf("Encrypt failed: %v", err)
	}

	// Change key
	validKey2 := strings.Repeat("f", 64)
	_ = os.Setenv("ENCRYPTION_KEY", validKey2)
	defer func() { _ = os.Unsetenv("ENCRYPTION_KEY") }()

	_, err = Decrypt(encrypted)
	if !errors.Is(err, ErrDecryption) {
		t.Errorf("Expected ErrDecryption, got %v", err)
	}
}

func TestErrors(t *testing.T) {
	if ErrInvalidKey.Error() == "" {
		t.Error("ErrInvalidKey should have message")
	}
	if ErrDecryption.Error() == "" {
		t.Error("ErrDecryption should have message")
	}
	if ErrInvalidFormat.Error() == "" {
		t.Error("ErrInvalidFormat should have message")
	}
	if ErrInvalidKeyVersion.Error() == "" {
		t.Error("ErrInvalidKeyVersion should have message")
	}
	if ErrLegacyFallbackDisabled.Error() == "" {
		t.Error("ErrLegacyFallbackDisabled should have message")
	}
	if ErrInvalidLegacyFallback.Error() == "" {
		t.Error("ErrInvalidLegacyFallback should have message")
	}
}

func TestDeriveKey_Deterministic(t *testing.T) {
	rawKey, _ := hex.DecodeString(strings.Repeat("a", 64))
	k1, err := deriveKey(rawKey)
	if err != nil {
		t.Fatalf("deriveKey failed: %v", err)
	}
	k2, err := deriveKey(rawKey)
	if err != nil {
		t.Fatalf("deriveKey failed: %v", err)
	}
	if !bytes_equal(k1, k2) {
		t.Error("deriveKey should be deterministic")
	}
	if len(k1) != 32 {
		t.Errorf("Expected 32-byte derived key, got %d", len(k1))
	}
}

func TestDeriveKey_DifferentFromRaw(t *testing.T) {
	rawKey, _ := hex.DecodeString(strings.Repeat("a", 64))
	derived, err := deriveKey(rawKey)
	if err != nil {
		t.Fatalf("deriveKey failed: %v", err)
	}
	if bytes_equal(rawKey, derived) {
		t.Error("Derived key should differ from raw key")
	}
}

func TestAllowLegacyRawKeyFallback_DefaultNonProduction(t *testing.T) {
	t.Setenv(legacyFallbackEnvVar, "")
	t.Setenv("NODE_ENV", "")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "")

	allowed, err := allowLegacyRawKeyFallback()
	if err != nil {
		t.Fatalf("allowLegacyRawKeyFallback failed: %v", err)
	}
	if !allowed {
		t.Fatal("expected fallback to be enabled by default in non-production")
	}
}

func TestAllowLegacyRawKeyFallback_DefaultProduction(t *testing.T) {
	t.Setenv(legacyFallbackEnvVar, "")
	t.Setenv("NODE_ENV", "production")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "")

	allowed, err := allowLegacyRawKeyFallback()
	if err != nil {
		t.Fatalf("allowLegacyRawKeyFallback failed: %v", err)
	}
	if allowed {
		t.Fatal("expected fallback to be disabled by default in production")
	}
}

func TestIsProductionRuntimeVariants(t *testing.T) {
	t.Setenv("NODE_ENV", "")
	t.Setenv("GO_ENV", "production")
	t.Setenv("VERCEL_ENV", "")
	if !isProductionRuntime() {
		t.Fatal("GO_ENV=production should be production")
	}

	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "production")
	if !isProductionRuntime() {
		t.Fatal("VERCEL_ENV=production should be production")
	}
}

func TestAllowLegacyRawKeyFallbackExplicitTrue(t *testing.T) {
	t.Setenv(legacyFallbackEnvVar, "true")

	allowed, err := allowLegacyRawKeyFallback()
	if err != nil {
		t.Fatalf("allowLegacyRawKeyFallback failed: %v", err)
	}
	if !allowed {
		t.Fatal("expected explicit true to allow fallback")
	}
}

func TestDecryptDecodeErrors(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))

	for _, encrypted := range []string{
		"v1:not-hex:00112233445566778899aabbccddeeff:0011",
		"v1:00112233445566778899aabb:not-hex:0011",
		"v1:00112233445566778899aabb:00112233445566778899aabbccddeeff:not-hex",
	} {
		if _, err := Decrypt(encrypted); err == nil {
			t.Fatalf("expected decrypt error for %s", encrypted)
		}
	}
}

func TestAllowLegacyRawKeyFallback_ExplicitDisableNonProduction(t *testing.T) {
	t.Setenv(legacyFallbackEnvVar, "false")
	t.Setenv("NODE_ENV", "")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "")

	allowed, err := allowLegacyRawKeyFallback()
	if err != nil {
		t.Fatalf("allowLegacyRawKeyFallback failed: %v", err)
	}
	if allowed {
		t.Fatal("expected fallback to be disabled with explicit false override")
	}
}

func TestAllowLegacyRawKeyFallback_InvalidOverride(t *testing.T) {
	t.Setenv(legacyFallbackEnvVar, "enabled")

	_, err := allowLegacyRawKeyFallback()
	if !errors.Is(err, ErrInvalidLegacyFallback) {
		t.Fatalf("expected ErrInvalidLegacyFallback, got %v", err)
	}
}

// TestDecrypt_BackwardCompatibility verifies that data encrypted with the raw
// key (pre-HKDF) can still be decrypted via the fallback path.
func TestDecrypt_BackwardCompatibility(t *testing.T) {
	validKey := strings.Repeat("c", 64)
	t.Setenv("ENCRYPTION_KEY", validKey)
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "")
	t.Setenv(legacyFallbackEnvVar, "")
	t.Setenv("NODE_ENV", "")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "")

	legacy := newLegacyCiphertext(t, validKey)

	plaintext, err := Decrypt(legacy)
	if err != nil {
		t.Fatalf("Decrypt legacy data failed: %v", err)
	}
	if plaintext != "legacy secret" {
		t.Errorf("Expected 'legacy secret', got %q", plaintext)
	}
}

func TestDecrypt_BackwardCompatibility_DisabledInProductionByDefault(t *testing.T) {
	validKey := strings.Repeat("c", 64)
	t.Setenv("ENCRYPTION_KEY", validKey)
	t.Setenv("NODE_ENV", "production")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "")
	t.Setenv(legacyFallbackEnvVar, "")

	legacy := newLegacyCiphertext(t, validKey)

	_, err := Decrypt(legacy)
	if !errors.Is(err, ErrLegacyFallbackDisabled) {
		t.Fatalf("expected ErrLegacyFallbackDisabled, got %v", err)
	}
	if !strings.Contains(err.Error(), legacyFallbackEnvVar+"=true") {
		t.Fatalf("expected error to mention override, got %v", err)
	}
}

func TestDecrypt_BackwardCompatibility_ExplicitlyAllowedInProduction(t *testing.T) {
	validKey := strings.Repeat("c", 64)
	t.Setenv("ENCRYPTION_KEY", validKey)
	t.Setenv("NODE_ENV", "production")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "")
	t.Setenv(legacyFallbackEnvVar, "true")

	legacy := newLegacyCiphertext(t, validKey)

	plaintext, err := Decrypt(legacy)
	if err != nil {
		t.Fatalf("Decrypt legacy data failed: %v", err)
	}
	if plaintext != "legacy secret" {
		t.Errorf("Expected 'legacy secret', got %q", plaintext)
	}
}

func TestDecrypt_BackwardCompatibility_InvalidOverride(t *testing.T) {
	validKey := strings.Repeat("c", 64)
	t.Setenv("ENCRYPTION_KEY", validKey)
	t.Setenv("NODE_ENV", "production")
	t.Setenv("GO_ENV", "")
	t.Setenv("VERCEL_ENV", "")
	t.Setenv(legacyFallbackEnvVar, "enabled")

	legacy := newLegacyCiphertext(t, validKey)

	_, err := Decrypt(legacy)
	if !errors.Is(err, ErrInvalidLegacyFallback) {
		t.Fatalf("expected ErrInvalidLegacyFallback, got %v", err)
	}
}

func newLegacyCiphertext(t *testing.T, keyHex string) string {
	t.Helper()

	rawKey, err := hex.DecodeString(keyHex)
	if err != nil {
		t.Fatalf("DecodeString: %v", err)
	}

	block, err := aes.NewCipher(rawKey)
	if err != nil {
		t.Fatalf("NewCipher: %v", err)
	}

	gcm, err := cipher.NewGCMWithNonceSize(block, IVLength)
	if err != nil {
		t.Fatalf("NewGCMWithNonceSize: %v", err)
	}

	nonce := make([]byte, IVLength)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		t.Fatalf("rand: %v", err)
	}

	sealed := gcm.Seal(nil, nonce, []byte("legacy secret"), nil)
	tagSize := gcm.Overhead()
	ciphertext := sealed[:len(sealed)-tagSize]
	tag := sealed[len(sealed)-tagSize:]

	return fmt.Sprintf("v1:%s:%s:%s", hex.EncodeToString(nonce), hex.EncodeToString(tag), hex.EncodeToString(ciphertext))
}

func bytes_equal(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
