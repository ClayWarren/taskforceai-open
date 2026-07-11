package crypto

import (
	"strings"
	"testing"
)

func TestEncryptOAuthTokenField_WithEncryptionKey(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	raw := "secret-token"
	encrypted, err := EncryptOAuthTokenField(&raw)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if encrypted == nil || *encrypted == raw {
		t.Fatal("expected encrypted token value")
	}

	decrypted, err := DecryptOAuthTokenField(encrypted)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if decrypted == nil || *decrypted != raw {
		t.Fatalf("expected decrypted token %q, got %#v", raw, decrypted)
	}
}

func TestEncryptOAuthTokenField_WithoutKeyFails(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "")
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "")

	raw := "secret-token"
	encrypted, err := EncryptOAuthTokenField(&raw)
	if err == nil {
		t.Fatal("expected encryption error in strict mode")
	}
	if encrypted != nil {
		t.Fatal("expected nil encrypted pointer when key is unavailable")
	}
}

func TestEncryptOAuthTokenField_PrefixedPlaintextStillEncrypts(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	raw := "v1:plain-token"
	encrypted, err := EncryptOAuthTokenField(&raw)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if encrypted == nil || *encrypted == raw {
		t.Fatal("expected prefixed plaintext to be encrypted")
	}

	decrypted, err := DecryptOAuthTokenField(encrypted)
	if err != nil {
		t.Fatalf("expected decrypt to succeed, got %v", err)
	}
	if decrypted == nil || *decrypted != raw {
		t.Fatalf("expected decrypted token %q, got %#v", raw, decrypted)
	}
}

func TestEncryptOAuthTokenField_AlreadyEncryptedValueIsUnchanged(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	raw := "secret-token"
	encrypted, err := EncryptOAuthTokenField(&raw)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if encrypted == nil {
		t.Fatal("expected encrypted value")
	}

	encryptedAgain, err := EncryptOAuthTokenField(encrypted)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if encryptedAgain == nil || *encryptedAgain != *encrypted {
		t.Fatalf("expected already-encrypted value to remain unchanged, got %#v", encryptedAgain)
	}
}

func TestEncryptOAuthTokenField_FutureVersionIsNotDoubleEncrypted(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v3")
	t.Setenv("ENCRYPTION_KEY_V3", strings.Repeat("3", 64))

	raw := "secret-token"
	encrypted, err := EncryptOAuthTokenField(&raw)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if encrypted == nil || !strings.HasPrefix(*encrypted, "v3:") {
		t.Fatalf("expected v3 ciphertext, got %#v", encrypted)
	}

	encryptedAgain, err := EncryptOAuthTokenField(encrypted)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if encryptedAgain == nil || *encryptedAgain != *encrypted {
		t.Fatalf("expected v3 ciphertext to remain unchanged, got %#v", encryptedAgain)
	}
}

func TestOAuthTokenFieldNilAndEmptyValues(t *testing.T) {
	encrypted, err := EncryptOAuthTokenField(nil)
	if err != nil || encrypted != nil {
		t.Fatalf("nil encrypt = %#v, %v", encrypted, err)
	}
	decrypted, err := DecryptOAuthTokenField(nil)
	if err != nil || decrypted != nil {
		t.Fatalf("nil decrypt = %#v, %v", decrypted, err)
	}

	empty := ""
	encrypted, err = EncryptOAuthTokenField(&empty)
	if err != nil || encrypted == nil || *encrypted != "" {
		t.Fatalf("empty encrypt = %#v, %v", encrypted, err)
	}
	decrypted, err = DecryptOAuthTokenField(&empty)
	if err != nil || decrypted == nil || *decrypted != "" {
		t.Fatalf("empty decrypt = %#v, %v", decrypted, err)
	}
}

func TestDecryptOAuthTokenField_InvalidCiphertext(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", strings.Repeat("a", 64))
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	raw := "not-encrypted"
	decrypted, err := DecryptOAuthTokenField(&raw)
	if err == nil {
		t.Fatal("expected decrypt error")
	}
	if decrypted != nil {
		t.Fatalf("expected nil decrypted value, got %#v", decrypted)
	}
}

func TestLooksEncryptedOAuthTokenRejectsMalformedValues(t *testing.T) {
	for _, value := range []string{
		"version3:00112233445566778899aabb:00112233445566778899aabbccddeeff:0011",
		"v1:short:00112233445566778899aabbccddeeff:0011",
		"v1:00112233445566778899aabb:short:0011",
		"v1:00112233445566778899aabb:00112233445566778899aabbccddeeff:",
		"v1:not-hex-0000000000:00112233445566778899aabbccddeeff:0011",
		"v1:00112233445566778899aabb:not-hex:0011",
		"v1:00112233445566778899aabb:00112233445566778899aabbccddeeff:not-hex",
		"v1:" + strings.Repeat("g", 32) + ":" + strings.Repeat("1", 32) + ":22",
		"v1:" + strings.Repeat("0", 32) + ":" + strings.Repeat("g", 32) + ":22",
		"v1:" + strings.Repeat("0", 32) + ":" + strings.Repeat("1", 32) + ":gg",
	} {
		if looksEncryptedOAuthToken(value) {
			t.Fatalf("value should not look encrypted: %s", value)
		}
	}
}
