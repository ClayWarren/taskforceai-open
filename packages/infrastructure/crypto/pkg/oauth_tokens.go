package crypto

import (
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
)

var ErrOAuthTokenEncryptionRequired = errors.New("oauth token encryption key is required")

func EncryptOAuthTokenField(value *string) (*string, error) {
	if value == nil || *value == "" {
		return value, nil
	}

	// Avoid double encryption if it already looks like an encrypted field
	if looksEncryptedOAuthToken(*value) {
		return value, nil
	}

	encrypted, err := Encrypt(*value)
	if err != nil {
		slog.Error("OAuth token encryption failed", "error", err)
		return nil, fmt.Errorf("%w: %w", ErrOAuthTokenEncryptionRequired, err)
	}

	return &encrypted, nil
}

func DecryptOAuthTokenField(value *string) (*string, error) {
	if value == nil || *value == "" {
		return value, nil
	}

	decrypted, err := Decrypt(*value)
	if err != nil {
		slog.Error("OAuth token decryption failed", "error", err)
		return nil, fmt.Errorf("failed to decrypt oauth token field: %w", err)
	}

	return &decrypted, nil
}

func looksEncryptedOAuthToken(value string) bool {
	parts := strings.Split(value, ":")
	if len(parts) != 4 {
		return false
	}

	if _, err := normalizeKeyVersion(parts[0]); err != nil {
		return false
	}

	ivHex := parts[1]
	tagHex := parts[2]
	cipherHex := parts[3]

	if len(ivHex) != IVLength*2 || len(tagHex) != 32 || len(cipherHex) == 0 {
		return false
	}

	if _, err := hex.DecodeString(ivHex); err != nil {
		return false
	}
	if _, err := hex.DecodeString(tagHex); err != nil {
		return false
	}
	if _, err := hex.DecodeString(cipherHex); err != nil {
		return false
	}

	return true
}
