package state

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"io"
	"strings"
)

// ReadRandom fills b with cryptographically secure random bytes.
func ReadRandom(b []byte) (int, error) {
	return io.ReadFull(rand.Reader, b)
}

// BuildStatePayload creates a signed OAuth state payload with an optional callback URL.
func BuildStatePayload(nonce string, callbackURL string, secret string) (string, string, error) {
	stateTarget := ""
	if callbackURL != "" {
		stateTarget = base64.URLEncoding.EncodeToString([]byte(callbackURL))
	}
	message := nonce + "|" + stateTarget
	signature := signState(message, secret)
	stateParam := nonce + "." + signature
	if stateTarget == "" {
		return stateParam, stateParam, nil
	}
	return stateParam, stateParam + "|" + stateTarget, nil
}

// VerifySignedState confirms the state signature matches the expected payload.
func VerifySignedState(stateParam string, stateTarget string, secret string) bool {
	nonce, signature, ok := strings.Cut(stateParam, ".")
	if !ok {
		return false
	}
	message := nonce + "|" + stateTarget
	expected := signState(message, secret)
	return constantTimeEqualString(signature, expected)
}

func signState(message string, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(message))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func constantTimeEqualString(left string, right string) bool {
	if len(left) != len(right) {
		return false
	}

	var result byte
	for i := 0; i < len(left); i++ {
		result |= left[i] ^ right[i]
	}
	return subtle.ConstantTimeByteEq(result, 0) == 1
}
