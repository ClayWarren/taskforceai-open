package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // #nosec G505 -- HOTP/TOTP uses HMAC-SHA1 by standard.
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	TOTPPeriodSeconds = 30
	TOTPDigits        = 6
	TOTPIssuer        = "TaskForceAI"
)

var totpRandomReader = rand.Reader
var totpCodeNormalizer = strings.NewReplacer(" ", "", "-", "")

func GenerateTOTPSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := io.ReadFull(totpRandomReader, buf); err != nil {
		return "", fmt.Errorf("totp: generate secret: %w", err)
	}
	return strings.TrimRight(base32.StdEncoding.EncodeToString(buf), "="), nil
}

func BuildTOTPURI(email, secret string) string {
	label := TOTPIssuer
	normalizedEmail := strings.TrimSpace(email)
	if normalizedEmail != "" {
		label += ":" + normalizedEmail
	}
	values := url.Values{}
	values.Set("secret", secret)
	values.Set("issuer", TOTPIssuer)
	values.Set("algorithm", "SHA1")
	values.Set("digits", strconv.Itoa(TOTPDigits))
	values.Set("period", strconv.Itoa(TOTPPeriodSeconds))
	return "otpauth://totp/" + url.PathEscape(label) + "?" + values.Encode()
}

func VerifyTOTPCode(secret, code string, now time.Time) bool {
	normalizedCode := normalizeTOTPCode(code)
	if len(normalizedCode) != TOTPDigits {
		return false
	}
	secretBytes, err := decodeTOTPSecret(secret)
	if err != nil {
		return false
	}
	counter := now.Unix() / TOTPPeriodSeconds
	for offset := int64(-1); offset <= 1; offset++ {
		candidate := counter + offset
		if candidate < 0 {
			continue
		}
		expected := hotpDigits(secretBytes, uint64(candidate)) // #nosec G115 -- non-negative int64 fits in uint64.
		if constantTimeTOTPCodeEqual(expected, normalizedCode) {
			return true
		}
	}
	return false
}

func normalizeTOTPCode(code string) string {
	return totpCodeNormalizer.Replace(strings.TrimSpace(code))
}

func decodeTOTPSecret(secret string) ([]byte, error) {
	normalized := strings.ToUpper(strings.TrimSpace(secret))
	if normalized == "" {
		return nil, fmt.Errorf("totp: empty secret")
	}
	if rem := len(normalized) % 8; rem != 0 {
		normalized += strings.Repeat("=", 8-rem)
	}
	return base32.StdEncoding.DecodeString(normalized)
}

func hotpDigits(secret []byte, counter uint64) [TOTPDigits]byte {
	var counterBytes [8]byte
	binary.BigEndian.PutUint64(counterBytes[:], counter)
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write(counterBytes[:])
	var digest [sha1.Size]byte
	sum := mac.Sum(digest[:0])
	offset := sum[len(sum)-1] & 0x0f
	binCode := (uint32(sum[offset])&0x7f)<<24 |
		(uint32(sum[offset+1])&0xff)<<16 |
		(uint32(sum[offset+2])&0xff)<<8 |
		(uint32(sum[offset+3]) & 0xff)
	return formatTOTPDigits(binCode % 1_000_000)
}

func formatTOTPDigits(value uint32) [TOTPDigits]byte {
	var code [TOTPDigits]byte
	for i := TOTPDigits - 1; i >= 0; i-- {
		code[i] = byte('0' + value%10)
		value /= 10
	}
	return code
}

func constantTimeTOTPCodeEqual(expected [TOTPDigits]byte, actual string) bool {
	if len(actual) != TOTPDigits {
		return false
	}
	var result byte
	for i := range expected {
		result |= expected[i] ^ actual[i]
	}
	return subtle.ConstantTimeByteEq(result, 0) == 1
}
