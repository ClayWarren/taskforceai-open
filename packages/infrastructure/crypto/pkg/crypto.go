// Package crypto provides cryptographic utilities.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"slices"
	"strings"
)

const (
	DefaultKeyVersion = "v1"
	IVLength          = 16
	TagLength         = 16

	SaltLength = 32

	// HKDF parameters for key derivation (FC-H3).
	hkdfSalt = "taskforceai-encryption-v1"
	hkdfInfo = "aes-gcm-encryption"
)

var (
	ErrInvalidKey                       = errors.New("invalid key length")
	ErrDecryption                       = errors.New("decryption failed")
	ErrInvalidFormat                    = errors.New("invalid encrypted format")
	ErrInvalidKeyVersion                = errors.New("invalid encryption key version")
	ErrInvalidLegacyFallback            = errors.New("invalid legacy raw-key decrypt fallback override")
	ErrLegacyFallbackDisabled           = errors.New("legacy raw-key decrypt fallback disabled")
	legacyFallbackEnvVar                = "ALLOW_LEGACY_RAW_KEY_DECRYPT_FALLBACK"
	encryptionRandomReader    io.Reader = rand.Reader
	deriveEncryptionKey                 = deriveKey
	newAESCipher                        = aes.NewCipher
	newGCMWithNonceSize                 = cipher.NewGCMWithNonceSize
)

func getEncryptionKey(version string) ([]byte, error) {
	normalizedVersion, err := normalizeKeyVersion(version)
	if err != nil {
		return nil, err
	}
	envName := "ENCRYPTION_KEY"
	if normalizedVersion != DefaultKeyVersion {
		envName = fmt.Sprintf("ENCRYPTION_KEY_%s", strings.ToUpper(normalizedVersion))
	}
	val := os.Getenv(envName)
	if len(val) != 64 {
		slog.Error("Invalid encryption key length", "envVar", envName, "expectedLength", 64, "actualLength", len(val))
		return nil, fmt.Errorf("encryption key %s must be 64 hex characters", envName)
	}
	return hex.DecodeString(val)
}

func normalizeKeyVersion(version string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(version))
	if !isValidKeyVersion(normalized) {
		return "", fmt.Errorf("%w: %q", ErrInvalidKeyVersion, version)
	}
	return normalized, nil
}

func isValidKeyVersion(version string) bool {
	if len(version) < 2 || version[0] != 'v' {
		return false
	}
	for _, r := range version[1:] {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// deriveKey uses HKDF-SHA256 to derive a 32-byte encryption subkey from the
// raw input key material. This provides better key separation than using the
// raw hex-decoded environment variable key directly.
func deriveKey(rawKey []byte) ([]byte, error) {
	return hkdf.Key(sha256.New, rawKey, []byte(hkdfSalt), hkdfInfo, 32)
}

func getActiveKeyVersion() string {
	v := os.Getenv("ENCRYPTION_KEY_ACTIVE_VERSION")
	if v == "" {
		return DefaultKeyVersion
	}
	return strings.ToLower(v)
}

func isProductionRuntime() bool {
	nodeEnv := strings.TrimSpace(os.Getenv("NODE_ENV"))
	goEnv := strings.TrimSpace(os.Getenv("GO_ENV"))
	vercelEnv := strings.TrimSpace(os.Getenv("VERCEL_ENV"))

	return strings.EqualFold(nodeEnv, "production") ||
		strings.EqualFold(goEnv, "production") ||
		strings.EqualFold(vercelEnv, "production")
}

func allowLegacyRawKeyFallback() (bool, error) {
	raw := strings.TrimSpace(os.Getenv(legacyFallbackEnvVar))
	if raw == "" {
		return !isProductionRuntime(), nil
	}
	if strings.EqualFold(raw, "true") {
		return true, nil
	}
	if strings.EqualFold(raw, "false") {
		return false, nil
	}
	return false, fmt.Errorf("%w: %s=%q (expected true or false)", ErrInvalidLegacyFallback, legacyFallbackEnvVar, raw)
}

func Encrypt(plaintext string) (string, error) {
	version := getActiveKeyVersion()
	rawKey, err := getEncryptionKey(version)
	if err != nil {
		slog.Error("Failed to get encryption key", "version", version, "error", err)
		return "", err
	}

	key, err := deriveEncryptionKey(rawKey)
	if err != nil {
		slog.Error("HKDF key derivation failed", "error", err)
		return "", fmt.Errorf("HKDF key derivation failed: %w", err)
	}

	block, err := newAESCipher(key)
	if err != nil {
		slog.Error("AES cipher creation failed", "error", err)
		return "", err
	}

	gcm, err := newGCMWithNonceSize(block, IVLength)
	if err != nil {
		slog.Error("GCM initialization failed", "error", err)
		return "", err
	}

	nonce := make([]byte, IVLength)
	if _, err := io.ReadFull(encryptionRandomReader, nonce); err != nil {
		slog.Error("Nonce generation failed", "error", err)
		return "", err
	}

	encrypted := gcm.Seal(nil, nonce, []byte(plaintext), nil) // #nosec G407
	// encrypted = ciphertext + tag
	tagSize := gcm.Overhead()
	ciphertextLen := len(encrypted) - tagSize
	ciphertext := encrypted[:ciphertextLen]
	tag := encrypted[ciphertextLen:]

	return fmt.Sprintf("%s:%s:%s:%s",
		version,
		hex.EncodeToString(nonce),
		hex.EncodeToString(tag),
		hex.EncodeToString(ciphertext),
	), nil
}

// decryptWithKey attempts AES-GCM decryption using the provided key.
func decryptWithKey(key, iv, tag, ciphertext []byte) (string, error) {
	block, err := newAESCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := newGCMWithNonceSize(block, IVLength)
	if err != nil {
		return "", err
	}

	combined := slices.Concat(ciphertext, tag)

	plaintext, err := gcm.Open(nil, iv, combined, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

func Decrypt(encrypted string) (string, error) {
	parts := strings.Split(encrypted, ":")
	var version, ivHex, tagHex, ctHex string

	switch len(parts) {
	case 4:
		version = parts[0]
		ivHex = parts[1]
		tagHex = parts[2]
		ctHex = parts[3]
	case 3:
		version = DefaultKeyVersion
		ivHex = parts[0]
		tagHex = parts[1]
		ctHex = parts[2]
	default:
		return "", ErrInvalidFormat
	}

	rawKey, err := getEncryptionKey(version)
	if err != nil {
		slog.Error("Failed to get encryption key for decryption", "version", version, "error", err)
		return "", err
	}

	iv, err := hex.DecodeString(ivHex)
	if err != nil {
		slog.Error("Failed to decode IV", "error", err)
		return "", err
	}
	tag, err := hex.DecodeString(tagHex)
	if err != nil {
		slog.Error("Failed to decode tag", "error", err)
		return "", err
	}
	ciphertext, err := hex.DecodeString(ctHex)
	if err != nil {
		slog.Error("Failed to decode ciphertext", "error", err)
		return "", err
	}
	if len(iv) != IVLength {
		slog.Error("Invalid IV length", "expectedLength", IVLength, "actualLength", len(iv))
		return "", ErrInvalidFormat
	}
	if len(tag) != TagLength {
		slog.Error("Invalid GCM tag length", "expectedLength", TagLength, "actualLength", len(tag))
		return "", ErrInvalidFormat
	}

	derivedKey, err := deriveEncryptionKey(rawKey)
	if err != nil {
		slog.Error("HKDF key derivation failed during decryption", "error", err)
		return "", fmt.Errorf("HKDF key derivation failed: %w", err)
	}

	if plaintext, err := decryptWithKey(derivedKey, iv, tag, ciphertext); err == nil {
		return plaintext, nil
	}

	legacyFallbackAllowed, err := allowLegacyRawKeyFallback()
	if err != nil {
		slog.Error("Failed to check legacy fallback", "error", err)
		return "", err
	}
	if !legacyFallbackAllowed {
		slog.Error("Decryption failed and legacy fallback disabled", "version", version)
		return "", fmt.Errorf("%w: set %s=true to allow decrypting pre-HKDF ciphertext", ErrLegacyFallbackDisabled, legacyFallbackEnvVar)
	}

	if plaintext, err := decryptWithKey(rawKey, iv, tag, ciphertext); err == nil {
		return plaintext, nil
	}

	slog.Error("Decryption failed after all attempts", "version", version)
	return "", ErrDecryption
}

func Hash(plaintext string) string {
	sum := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(sum[:])
}
