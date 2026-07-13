package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateTOTPSecretRejectsShortEntropyReads(t *testing.T) {
	previous := totpRandomReader
	totpRandomReader = strings.NewReader("short")
	t.Cleanup(func() { totpRandomReader = previous })

	secret, err := GenerateTOTPSecret()

	require.Error(t, err)
	assert.Empty(t, secret)
}

func TestVerifyTOTPCode(t *testing.T) {
	secret := "JBSWY3DPEHPK3PXP"
	secretBytes, err := decodeTOTPSecret(secret)
	require.NoError(t, err)

	now := time.Unix(1_234_567_890, 0)
	code := totpCodeForTest(secretBytes, uint64(now.Unix()/TOTPPeriodSeconds))

	assert.True(t, VerifyTOTPCode(secret, code, now))
	assert.True(t, VerifyTOTPCode(secret, " "+code[:3]+"-"+code[3:]+" ", now))
	assert.False(t, VerifyTOTPCode(secret, code, now.Add(2*time.Minute)))
	assert.False(t, VerifyTOTPCode(secret, "000000", now))
	assert.False(t, VerifyTOTPCode("not-base32", code, now))
}

func BenchmarkVerifyTOTPCode(b *testing.B) {
	secret := "JBSWY3DPEHPK3PXP"
	now := time.Unix(1_700_000_000, 0)
	secretBytes, err := decodeTOTPSecret(secret)
	require.NoError(b, err)
	code := totpCodeForTest(secretBytes, uint64(now.Unix()/TOTPPeriodSeconds))

	b.ReportAllocs()
	for b.Loop() {
		if !VerifyTOTPCode(secret, code, now) {
			b.Fatal("expected TOTP code to verify")
		}
	}
}

func BenchmarkHOTPDigits(b *testing.B) {
	secretBytes, err := decodeTOTPSecret("JBSWY3DPEHPK3PXP")
	require.NoError(b, err)

	b.ReportAllocs()
	for b.Loop() {
		if hotpDigits(secretBytes, 56_666_666) == [TOTPDigits]byte{} {
			b.Fatal("expected HOTP code")
		}
	}
}

func totpCodeForTest(secret []byte, counter uint64) string {
	code := hotpDigits(secret, counter)
	return string(code[:])
}

func TestMFAPendingTokenRoundTrip(t *testing.T) {
	ResetJWTKeysForTest()
	t.Cleanup(ResetJWTKeysForTest)
	t.Setenv("AUTH_PRIVATE_KEY", "")
	t.Setenv("AUTH_PUBLIC_KEYS", "")
	t.Setenv("AUTH_PUBLIC_KEY", "")
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	user := SessionUser{
		ID:       "42",
		Email:    "mfa@example.com",
		FullName: "MFA User",
	}
	token, err := EncodeMFAPendingToken(user, "/dashboard", "test-secret-32-characters-long!!")
	require.NoError(t, err)

	pending, err := VerifyMFAPendingToken(token)
	require.NoError(t, err)
	assert.Equal(t, user.ID, pending.User.ID)
	assert.Equal(t, user.Email, pending.User.Email)
	assert.Equal(t, user.FullName, pending.User.FullName)
	assert.Equal(t, "/dashboard", pending.RedirectURL)
}

func TestVerifyMFAPendingTokenRejectsRegularSession(t *testing.T) {
	ResetJWTKeysForTest()
	t.Cleanup(ResetJWTKeysForTest)
	t.Setenv("AUTH_PRIVATE_KEY", "")
	t.Setenv("AUTH_PUBLIC_KEYS", "")
	t.Setenv("AUTH_PUBLIC_KEY", "")
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	token, err := EncodeSessionToken(
		SessionUser{ID: "42", Email: "mfa@example.com"},
		"test-secret-32-characters-long!!",
		DefaultSessionMaxAge,
	)
	require.NoError(t, err)

	_, err = VerifyMFAPendingToken(token)
	assert.ErrorIs(t, err, ErrInvalidToken)
}
