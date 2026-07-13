package state

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSecret = "super-secret-key-for-testing-32chars"

func TestReadRandom(t *testing.T) {
	b := make([]byte, 32)
	n, err := ReadRandom(b)
	require.NoError(t, err)
	assert.Equal(t, len(b), n)
}

func TestBuildStatePayload_WithCallbackURL(t *testing.T) {
	nonce := "abc123"
	callbackURL := "https://example.com/callback"

	stateParam, fullState, err := BuildStatePayload(nonce, callbackURL, testSecret)

	require.NoError(t, err)

	// State param should be nonce.signature
	parts := strings.Split(stateParam, ".")
	assert.Len(t, parts, 2, "stateParam should have nonce.signature format")
	assert.Equal(t, nonce, parts[0], "First part should be the nonce")

	// Full state should include the encoded callback URL
	assert.True(t, strings.HasPrefix(fullState, stateParam), "Full state should start with stateParam")
	assert.Contains(t, fullState, "|", "Full state should contain pipe separator")

	// Decode and verify callback URL
	fullParts := strings.Split(fullState, "|")
	require.Len(t, fullParts, 2)
	decodedURL, err := base64.URLEncoding.DecodeString(fullParts[1])
	require.NoError(t, err)
	assert.Equal(t, callbackURL, string(decodedURL))
}

func TestBuildStatePayload_WithoutCallbackURL(t *testing.T) {
	nonce := "def456"
	callbackURL := ""

	stateParam, fullState, err := BuildStatePayload(nonce, callbackURL, testSecret)

	require.NoError(t, err)

	// When no callback URL, stateParam and fullState should be identical
	assert.Equal(t, stateParam, fullState, "Without callback, stateParam and fullState should match")

	// State param should be nonce.signature
	parts := strings.Split(stateParam, ".")
	assert.Len(t, parts, 2)
	assert.Equal(t, nonce, parts[0])

	// Should not contain pipe separator in full state
	assert.NotContains(t, fullState, "|")
}

func TestBuildStatePayload_EmptyNonce(t *testing.T) {
	nonce := ""
	callbackURL := "https://example.com"

	stateParam, fullState, err := BuildStatePayload(nonce, callbackURL, testSecret)

	require.NoError(t, err)
	// Should still work, just with empty nonce part
	assert.True(t, strings.HasPrefix(stateParam, "."), "Should start with dot when nonce is empty")
	assert.NotEmpty(t, fullState)
}

func TestBuildStatePayload_SpecialCharactersInCallbackURL(t *testing.T) {
	testCases := []struct {
		name        string
		callbackURL string
	}{
		{"URL with query params", "https://example.com/callback?param=value&other=123"},
		{"URL with fragment", "https://example.com/callback#section"},
		{"URL with unicode", "https://example.com/callback?name=\u4e2d\u6587"},
		{"URL with spaces encoded", "https://example.com/path%20with%20spaces"},
		{"URL with port", "https://localhost:3000/callback"},
		{"URL with special chars", "https://example.com/callback?token=abc+def/ghi="},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			nonce := "test-nonce"
			stateParam, fullState, err := BuildStatePayload(nonce, tc.callbackURL, testSecret)

			require.NoError(t, err)
			assert.NotEmpty(t, stateParam)
			assert.NotEmpty(t, fullState)

			// Extract and decode the URL to verify round-trip
			fullParts := strings.Split(fullState, "|")
			require.Len(t, fullParts, 2)
			decodedURL, err := base64.URLEncoding.DecodeString(fullParts[1])
			require.NoError(t, err)
			assert.Equal(t, tc.callbackURL, string(decodedURL))
		})
	}
}

func TestBuildStatePayload_ConsistentSignature(t *testing.T) {
	nonce := "consistent-nonce"
	callbackURL := "https://example.com"

	// Call multiple times with same inputs
	state1, _, _ := BuildStatePayload(nonce, callbackURL, testSecret)
	state2, _, _ := BuildStatePayload(nonce, callbackURL, testSecret)

	assert.Equal(t, state1, state2, "Same inputs should produce same output")
}

func TestBuildStatePayload_DifferentSecretsProduceDifferentSignatures(t *testing.T) {
	nonce := "test-nonce"
	callbackURL := "https://example.com"

	state1, _, _ := BuildStatePayload(nonce, callbackURL, "secret1")
	state2, _, _ := BuildStatePayload(nonce, callbackURL, "secret2")

	assert.NotEqual(t, state1, state2, "Different secrets should produce different signatures")
}

func TestVerifySignedState_ValidSignature(t *testing.T) {
	nonce := "verify-test"
	callbackURL := "https://example.com/callback"

	stateParam, _, err := BuildStatePayload(nonce, callbackURL, testSecret)
	require.NoError(t, err)

	// Build the expected stateTarget (base64 encoded callback URL)
	stateTarget := base64.URLEncoding.EncodeToString([]byte(callbackURL))

	valid := VerifySignedState(stateParam, stateTarget, testSecret)

	assert.True(t, valid, "Should verify correctly with matching signature")
}

func TestVerifySignedState_ValidSignatureNoCallback(t *testing.T) {
	nonce := "verify-no-callback"
	callbackURL := ""

	stateParam, _, err := BuildStatePayload(nonce, callbackURL, testSecret)
	require.NoError(t, err)

	// Without callback, stateTarget is empty
	valid := VerifySignedState(stateParam, "", testSecret)

	assert.True(t, valid, "Should verify correctly with no callback URL")
}

func TestVerifySignedState_TamperedSignature(t *testing.T) {
	nonce := "tamper-test"
	callbackURL := "https://example.com"

	stateParam, _, err := BuildStatePayload(nonce, callbackURL, testSecret)
	require.NoError(t, err)

	// Tamper with the signature by modifying a character
	parts := strings.Split(stateParam, ".")
	require.Len(t, parts, 2)

	tamperedSig := parts[1]
	if len(tamperedSig) > 0 {
		// Flip a bit in the signature
		runes := []rune(tamperedSig)
		runes[0] = 'X'
		tamperedSig = string(runes)
	}
	tamperedState := parts[0] + "." + tamperedSig

	stateTarget := base64.URLEncoding.EncodeToString([]byte(callbackURL))
	valid := VerifySignedState(tamperedState, stateTarget, testSecret)

	assert.False(t, valid, "Tampered signature should not verify")
}

func TestVerifySignedState_MalformedStateNoDot(t *testing.T) {
	// State without a dot separator
	malformedState := "nodotinthisstate"
	stateTarget := base64.URLEncoding.EncodeToString([]byte("https://example.com"))

	valid := VerifySignedState(malformedState, stateTarget, testSecret)

	assert.False(t, valid, "Malformed state without dot should not verify")
}

func TestVerifySignedState_EmptyStateParam(t *testing.T) {
	valid := VerifySignedState("", "", testSecret)

	assert.False(t, valid, "Empty state param should not verify")
}

func TestVerifySignedState_WrongSecret(t *testing.T) {
	nonce := "wrong-secret-test"
	callbackURL := "https://example.com"

	stateParam, _, err := BuildStatePayload(nonce, callbackURL, testSecret)
	require.NoError(t, err)

	stateTarget := base64.URLEncoding.EncodeToString([]byte(callbackURL))
	valid := VerifySignedState(stateParam, stateTarget, "wrong-secret")

	assert.False(t, valid, "Wrong secret should not verify")
}

func TestVerifySignedState_DifferentNonce(t *testing.T) {
	callbackURL := "https://example.com"

	stateParam, _, err := BuildStatePayload("nonce1", callbackURL, testSecret)
	require.NoError(t, err)

	// Try to verify with a different nonce substituted
	parts := strings.Split(stateParam, ".")
	require.Len(t, parts, 2)

	differentNonceState := "nonce2." + parts[1]
	stateTarget := base64.URLEncoding.EncodeToString([]byte(callbackURL))
	valid := VerifySignedState(differentNonceState, stateTarget, testSecret)

	assert.False(t, valid, "State with substituted nonce should not verify")
}

func TestVerifySignedState_DifferentCallback(t *testing.T) {
	nonce := "callback-mismatch"
	originalCallback := "https://example.com/original"
	maliciousCallback := "https://evil.com/steal"

	stateParam, _, err := BuildStatePayload(nonce, originalCallback, testSecret)
	require.NoError(t, err)

	// Try to verify with a different callback URL
	maliciousTarget := base64.URLEncoding.EncodeToString([]byte(maliciousCallback))
	valid := VerifySignedState(stateParam, maliciousTarget, testSecret)

	assert.False(t, valid, "State with different callback should not verify")
}

func TestVerifySignedState_PartiallyMatchingSignature(t *testing.T) {
	nonce := "partial-match"
	callbackURL := "https://example.com"

	stateParam, _, err := BuildStatePayload(nonce, callbackURL, testSecret)
	require.NoError(t, err)

	parts := strings.Split(stateParam, ".")
	require.Len(t, parts, 2)

	// Use only part of the signature
	truncatedSig := parts[1][:len(parts[1])/2]
	truncatedState := parts[0] + "." + truncatedSig

	stateTarget := base64.URLEncoding.EncodeToString([]byte(callbackURL))
	valid := VerifySignedState(truncatedState, stateTarget, testSecret)

	assert.False(t, valid, "Truncated signature should not verify")
}

func TestVerifySignedState_ExtraDataAppended(t *testing.T) {
	nonce := "extra-data"
	callbackURL := "https://example.com"

	stateParam, _, err := BuildStatePayload(nonce, callbackURL, testSecret)
	require.NoError(t, err)

	// Append extra data to signature
	modifiedState := stateParam + "extra"

	stateTarget := base64.URLEncoding.EncodeToString([]byte(callbackURL))
	valid := VerifySignedState(modifiedState, stateTarget, testSecret)

	assert.False(t, valid, "State with appended data should not verify")
}

// Test signState internal function behavior indirectly
func TestSignState_HMACSHA256(t *testing.T) {
	// Extract signature from BuildStatePayload
	nonce := "test"
	stateParam, _, _ := BuildStatePayload(nonce, "message", testSecret)
	parts := strings.Split(stateParam, ".")
	require.Len(t, parts, 2)

	// The message signed should be "test|<base64(message)>" not "test|message"
	// So we verify the algorithm is correct by building the expected
	stateTarget := base64.URLEncoding.EncodeToString([]byte("message"))
	expectedMessage := nonce + "|" + stateTarget
	mac := hmac.New(sha256.New, []byte(testSecret))
	mac.Write([]byte(expectedMessage))
	expectedSig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	assert.Equal(t, expectedSig, parts[1], "Signature should match HMAC-SHA256 computation")
}

func TestVerifySignedState_TimingAttackResistance(t *testing.T) {
	// This test documents that we use constant-time comparison
	// We can't easily test timing, but we verify the function exists and works
	nonce := "timing-test"
	callbackURL := "https://example.com"

	stateParam, _, err := BuildStatePayload(nonce, callbackURL, testSecret)
	require.NoError(t, err)

	stateTarget := base64.URLEncoding.EncodeToString([]byte(callbackURL))

	// Valid verification
	valid := VerifySignedState(stateParam, stateTarget, testSecret)
	assert.True(t, valid)

	// Invalid verification (uses same constant-time compare)
	invalid := VerifySignedState(stateParam, stateTarget, "wrong")
	assert.False(t, invalid)
}

func TestBuildStatePayload_LongCallbackURL(t *testing.T) {
	nonce := "long-url-test"
	// Create a very long callback URL
	longPath := strings.Repeat("path/", 500)
	callbackURL := "https://example.com/" + longPath

	stateParam, fullState, err := BuildStatePayload(nonce, callbackURL, testSecret)

	require.NoError(t, err)
	assert.NotEmpty(t, stateParam)

	// Verify we can decode it back
	fullParts := strings.SplitN(fullState, "|", 2)
	require.Len(t, fullParts, 2)
	decodedURL, err := base64.URLEncoding.DecodeString(fullParts[1])
	require.NoError(t, err)
	assert.Equal(t, callbackURL, string(decodedURL))

	// And verify it
	stateTarget := base64.URLEncoding.EncodeToString([]byte(callbackURL))
	valid := VerifySignedState(stateParam, stateTarget, testSecret)
	assert.True(t, valid)
}

func TestVerifySignedState_OnlyDot(t *testing.T) {
	// Edge case: state is just a dot
	valid := VerifySignedState(".", "", testSecret)

	// This should not crash and should return false (empty nonce and empty sig)
	assert.False(t, valid)
}

func TestVerifySignedState_MultipleDots(t *testing.T) {
	// Edge case: multiple dots in state
	// SplitN with n=2 should handle this correctly
	nonce := "multi.dot.nonce"
	callbackURL := ""

	stateParam, _, err := BuildStatePayload(nonce, callbackURL, testSecret)
	require.NoError(t, err)

	// The state will be "multi.dot.nonce.<signature>"
	// SplitN will split on first dot only, so this won't verify correctly
	// because the nonce extracted will be "multi" not "multi.dot.nonce"
	// This is expected behavior - nonces shouldn't contain dots
	valid := VerifySignedState(stateParam, "", testSecret)

	// This actually fails because the nonce contains dots
	// The signature is computed on "multi.dot.nonce|" but verification
	// extracts "multi" as the nonce and tries to verify "multi|"
	assert.False(t, valid, "Nonce with dots causes verification to fail (expected)")
}

func TestBuildAndVerify_RoundTrip(t *testing.T) {
	testCases := []struct {
		name        string
		nonce       string
		callbackURL string
	}{
		{"simple", "abc123", "https://example.com"},
		{"no callback", "def456", ""},
		{"long nonce", strings.Repeat("x", 100), "https://example.com"},
		{"complex URL", "nonce", "https://example.com/path?a=1&b=2#hash"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			stateParam, fullState, err := BuildStatePayload(tc.nonce, tc.callbackURL, testSecret)
			require.NoError(t, err)

			// Extract stateTarget from fullState
			var stateTarget string
			if strings.Contains(fullState, "|") {
				parts := strings.SplitN(fullState, "|", 2)
				if len(parts) == 2 {
					stateTarget = parts[1]
				}
			}

			valid := VerifySignedState(stateParam, stateTarget, testSecret)
			assert.True(t, valid, "Round-trip should verify successfully")
		})
	}
}

// Benchmark to ensure the signing/verification is performant
func BenchmarkBuildStatePayload(b *testing.B) {
	nonce := "benchmark-nonce"
	callbackURL := "https://example.com/callback"

	b.ResetTimer()
	for b.Loop() {
		_, _, _ = BuildStatePayload(nonce, callbackURL, testSecret)
	}
}

func BenchmarkVerifySignedState(b *testing.B) {
	nonce := "benchmark-nonce"
	callbackURL := "https://example.com/callback"
	stateParam, _, _ := BuildStatePayload(nonce, callbackURL, testSecret)
	stateTarget := base64.URLEncoding.EncodeToString([]byte(callbackURL))

	b.ResetTimer()
	for b.Loop() {
		_ = VerifySignedState(stateParam, stateTarget, testSecret)
	}
}
