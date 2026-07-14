package auth

import (
	"context"
	crand "crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"io"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type failingReader struct {
	err error
}

func (r failingReader) Read([]byte) (int, error) {
	return 0, r.err
}

type failOnReadNumber struct {
	failAt int
	reads  int
}

func (r *failOnReadNumber) Read(p []byte) (int, error) {
	r.reads++
	if r.reads == r.failAt {
		return 0, errors.New("random failed")
	}
	for i := range p {
		p[i] = byte(i + r.reads)
	}
	return len(p), nil
}

func withDeviceRandomReader(t *testing.T, reader io.Reader) {
	t.Helper()
	previous := deviceRandomReader
	deviceRandomReader = reader
	t.Cleanup(func() {
		deviceRandomReader = previous
	})
}

type coverageDeviceRepo struct {
	active         *DeviceLoginRecord
	activeErr      error
	createErr      error
	userCodeRecord *DeviceLoginRecord
	userCodeErr    error
	deviceRecord   *DeviceLoginRecord
	deviceErr      error
	updateErr      error
	user           *DeviceLoginUser
	userErr        error
	completed      bool
	completeErr    error
	pollDenied     bool
	pollErr        error
}

func (r *coverageDeviceRepo) FindActiveLoginByCodes(context.Context, string, string) (*DeviceLoginRecord, error) {
	return r.active, r.activeErr
}

func (r *coverageDeviceRepo) CreateLogin(_ context.Context, input DeviceLoginCreateInput) (*DeviceLoginRecord, error) {
	if r.createErr != nil {
		return nil, r.createErr
	}
	return &DeviceLoginRecord{
		DeviceCode:   input.DeviceCode,
		UserCode:     input.UserCode,
		ExpiresAt:    input.ExpiresAt,
		PollInterval: input.PollInterval,
	}, nil
}

func (r *coverageDeviceRepo) FindByUserCode(context.Context, string) (*DeviceLoginRecord, error) {
	return r.userCodeRecord, r.userCodeErr
}

func (r *coverageDeviceRepo) FindByDeviceCode(context.Context, string) (*DeviceLoginRecord, error) {
	return r.deviceRecord, r.deviceErr
}

func (r *coverageDeviceRepo) UpdateLogin(context.Context, int, DeviceLoginUpdate) error {
	return r.updateErr
}

func (r *coverageDeviceRepo) RecordDeviceLoginPoll(context.Context, int, time.Time) (bool, error) {
	return !r.pollDenied, r.pollErr
}

func (r *coverageDeviceRepo) MarkDeviceLoginAsCompleted(context.Context, int) (bool, error) {
	return r.completed, r.completeErr
}

func (r *coverageDeviceRepo) FindUserByID(context.Context, int) (*DeviceLoginUser, error) {
	return r.user, r.userErr
}

func TestGenerateDeviceLoginCodesRandomErrors(t *testing.T) {
	t.Run("device code random failure", func(t *testing.T) {
		withDeviceRandomReader(t, failingReader{err: errors.New("entropy unavailable")})

		codes, err := generateDeviceLoginCodes()

		require.ErrorContains(t, err, "failed to generate random bytes")
		assert.Empty(t, codes)
	})

	t.Run("user code random failure", func(t *testing.T) {
		withDeviceRandomReader(t, &failOnReadNumber{failAt: 2})

		codes, err := generateDeviceLoginCodes()

		require.ErrorContains(t, err, "failed to generate random bytes for user code")
		assert.Empty(t, codes)
	})
}

func TestDeviceLoginServiceBranches(t *testing.T) {
	t.Run("start propagates code generation error", func(t *testing.T) {
		withDeviceRandomReader(t, failingReader{err: errors.New("entropy unavailable")})
		service := NewDeviceLoginService(&coverageDeviceRepo{})

		payload, err := service.StartDeviceLogin(context.Background(), "https://auth.example.com")

		assert.Nil(t, payload)
		require.ErrorContains(t, err, "failed to generate random bytes")
	})

	t.Run("start create error", func(t *testing.T) {
		service := NewDeviceLoginService(&coverageDeviceRepo{createErr: errors.New("insert failed")})

		payload, err := service.StartDeviceLogin(context.Background(), "https://auth.example.com")

		assert.Nil(t, payload)
		require.ErrorContains(t, err, "failed to create login record")
	})

	t.Run("authorize lookup error", func(t *testing.T) {
		service := NewDeviceLoginService(&coverageDeviceRepo{userCodeErr: errors.New("lookup failed")})

		err := service.AuthorizeDeviceLogin(context.Background(), 7, "ABCD-1234")

		require.ErrorContains(t, err, "failed to find login by user code")
	})

	t.Run("authorize update error", func(t *testing.T) {
		service := NewDeviceLoginService(&coverageDeviceRepo{
			userCodeRecord: &DeviceLoginRecord{
				ID:        10,
				Status:    DeviceStatusPending,
				ExpiresAt: time.Now().Add(time.Hour),
			},
			updateErr: errors.New("update failed"),
		})

		err := service.AuthorizeDeviceLogin(context.Background(), 7, "ABCD-1234")

		require.ErrorContains(t, err, "failed to authorize login")
	})

	t.Run("missing exchange user update error", func(t *testing.T) {
		userID := 7
		service := NewDeviceLoginService(&coverageDeviceRepo{
			deviceRecord: &DeviceLoginRecord{
				ID:        11,
				Status:    DeviceStatusAuthorized,
				UserID:    &userID,
				ExpiresAt: time.Now().Add(time.Hour),
			},
			updateErr: errors.New("expire failed"),
		})

		outcome, err := service.ExchangeDeviceToken(context.Background(), "device", testAuthSecret())

		assert.Nil(t, outcome)
		require.ErrorContains(t, err, "failed to mark login expired")
	})

	t.Run("approved exchange copies full name", func(t *testing.T) {
		ResetJWTKeysForTest()
		t.Cleanup(ResetJWTKeysForTest)
		t.Setenv("AUTH_PRIVATE_KEY", "")
		t.Setenv("AUTH_PUBLIC_KEYS", "")
		t.Setenv("AUTH_PUBLIC_KEY", "")
		t.Setenv("AUTH_SECRET", "")
		userID := 8
		fullName := "Device User"
		service := NewDeviceLoginService(&coverageDeviceRepo{
			deviceRecord: &DeviceLoginRecord{
				ID:        12,
				Status:    DeviceStatusAuthorized,
				UserID:    &userID,
				ExpiresAt: time.Now().Add(time.Hour),
			},
			user:      &DeviceLoginUser{ID: userID, Email: "device@example.com", FullName: &fullName},
			completed: true,
		})

		outcome, err := service.ExchangeDeviceToken(context.Background(), "device", testAuthSecret())

		require.NoError(t, err)
		require.NotNil(t, outcome)
		assert.Equal(t, "APPROVED", outcome.Kind)
	})

	t.Run("exchange token signing error", func(t *testing.T) {
		ResetJWTKeysForTest()
		t.Cleanup(ResetJWTKeysForTest)
		t.Setenv("AUTH_PRIVATE_KEY", "")
		t.Setenv("AUTH_PUBLIC_KEYS", "")
		t.Setenv("AUTH_PUBLIC_KEY", "")
		t.Setenv("AUTH_SECRET", "")
		userID := 9
		service := NewDeviceLoginService(&coverageDeviceRepo{
			deviceRecord: &DeviceLoginRecord{
				ID:        13,
				Status:    DeviceStatusAuthorized,
				UserID:    &userID,
				ExpiresAt: time.Now().Add(time.Hour),
			},
			user: &DeviceLoginUser{ID: userID, Email: "device@example.com"},
		})

		outcome, err := service.ExchangeDeviceToken(context.Background(), "device", "")

		assert.Nil(t, outcome)
		require.ErrorContains(t, err, "failed to sign token")
	})
}

func TestSessionBranches(t *testing.T) {
	t.Run("has verify keys returns false on init error", func(t *testing.T) {
		resetKeyState(t)
		t.Setenv("AUTH_PRIVATE_KEY", "invalid-pem")

		require.Error(t, InitKeys())
		assert.Empty(t, verifyKeys)
	})

	t.Run("init skips empty public key entries", func(t *testing.T) {
		resetKeyState(t)
		t.Setenv("AUTH_PRIVATE_KEY", "")
		t.Setenv("AUTH_PUBLIC_KEY", "")
		t.Setenv("AUTH_PUBLIC_KEYS", " , ")

		require.NoError(t, InitKeys())
		assert.Empty(t, verifyKeys)
	})

	t.Run("verify token returns init error", func(t *testing.T) {
		resetKeyState(t)
		t.Setenv("AUTH_PRIVATE_KEY", "invalid-pem")

		token, err := VerifyToken("not-a-token")

		assert.Nil(t, token)
		require.ErrorContains(t, err, "failed to initialize JWT keys")
	})

	t.Run("verify token rejects non hmac fallback method", func(t *testing.T) {
		resetKeyState(t)
		t.Setenv("AUTH_PRIVATE_KEY", "")
		t.Setenv("AUTH_PUBLIC_KEYS", "")
		t.Setenv("AUTH_PUBLIC_KEY", "")
		t.Setenv("AUTH_SECRET", testAuthSecret())
		key, err := rsa.GenerateKey(crand.Reader, 2048)
		require.NoError(t, err)
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{"sub": "1", "exp": time.Now().Add(time.Hour).Unix()})
		signed, err := token.SignedString(key)
		require.NoError(t, err)

		parsed, err := VerifyToken(signed)

		assert.Nil(t, parsed)
		assert.ErrorIs(t, err, ErrInvalidToken)
	})

	t.Run("encode session returns init error", func(t *testing.T) {
		resetKeyState(t)
		t.Setenv("AUTH_PRIVATE_KEY", "invalid-pem")

		token, err := EncodeSessionToken(SessionUser{ID: "1"}, testAuthSecret(), DefaultSessionMaxAge)

		assert.Empty(t, token)
		require.ErrorContains(t, err, "failed to initialize JWT keys")
	})

	t.Run("encode session uses signing key", func(t *testing.T) {
		resetKeyState(t)
		key, err := rsa.GenerateKey(crand.Reader, 2048)
		require.NoError(t, err)
		privatePEM := pemPrivateKey(t, key)
		t.Setenv("AUTH_PRIVATE_KEY", string(privatePEM))
		t.Setenv("AUTH_PUBLIC_KEYS", "")
		t.Setenv("AUTH_PUBLIC_KEY", "")
		t.Setenv("AUTH_SECRET", "")

		token, err := EncodeSessionToken(SessionUser{ID: "1", Email: "rsa@example.com"}, "", DefaultSessionMaxAge)

		require.NoError(t, err)
		assert.NotEmpty(t, token)
	})

	t.Run("mfa pending token validation errors", func(t *testing.T) {
		ResetJWTKeysForTest()
		t.Cleanup(ResetJWTKeysForTest)
		t.Setenv("AUTH_PRIVATE_KEY", "")
		t.Setenv("AUTH_PUBLIC_KEYS", "")
		t.Setenv("AUTH_PUBLIC_KEY", "")
		t.Setenv("AUTH_SECRET", testAuthSecret())

		_, err := EncodeMFAPendingToken(SessionUser{ID: "1"}, "", "")
		require.ErrorContains(t, err, "AUTH_SECRET is required")

		_, err = VerifyMFAPendingToken("not-a-token")
		assert.Error(t, err)
	})

	t.Run("mfa pending token returns init error", func(t *testing.T) {
		resetKeyState(t)
		t.Setenv("AUTH_PRIVATE_KEY", "invalid-pem")

		token, err := EncodeMFAPendingToken(SessionUser{ID: "1"}, "/", testAuthSecret())

		assert.Empty(t, token)
		require.ErrorContains(t, err, "failed to initialize JWT keys")
	})

	t.Run("mfa pending token uses signing key", func(t *testing.T) {
		resetKeyState(t)
		key, err := rsa.GenerateKey(crand.Reader, 2048)
		require.NoError(t, err)
		t.Setenv("AUTH_PRIVATE_KEY", string(pemPrivateKey(t, key)))
		t.Setenv("AUTH_PUBLIC_KEYS", "")
		t.Setenv("AUTH_PUBLIC_KEY", "")
		t.Setenv("AUTH_SECRET", "")

		token, err := EncodeMFAPendingToken(SessionUser{ID: "1"}, "/", "")

		require.NoError(t, err)
		assert.NotEmpty(t, token)
	})

	t.Run("mfa pending token carries organizations", func(t *testing.T) {
		ResetJWTKeysForTest()
		t.Cleanup(ResetJWTKeysForTest)
		t.Setenv("AUTH_PRIVATE_KEY", "")
		t.Setenv("AUTH_PUBLIC_KEYS", "")
		t.Setenv("AUTH_PUBLIC_KEY", "")
		t.Setenv("AUTH_SECRET", testAuthSecret())
		orgID := "org-1"
		internalOrgID := 42

		token, err := EncodeMFAPendingToken(SessionUser{
			ID:            "1",
			Email:         "mfa@example.com",
			OrgID:         &orgID,
			InternalOrgID: &internalOrgID,
		}, "/return", testAuthSecret())
		require.NoError(t, err)

		pending, err := VerifyMFAPendingToken(token)

		require.NoError(t, err)
		require.NotNil(t, pending.User.OrgID)
		assert.Equal(t, orgID, *pending.User.OrgID)
		require.NotNil(t, pending.User.InternalOrgID)
		assert.Equal(t, internalOrgID, *pending.User.InternalOrgID)
	})

	t.Run("mfa pending claims reject non map claims", func(t *testing.T) {
		pending, err := mfaPendingSessionFromClaims(jwt.RegisteredClaims{})

		assert.Nil(t, pending)
		assert.ErrorIs(t, err, ErrInvalidToken)
	})

	t.Run("mfa pending claims fall back to subject and reject missing id", func(t *testing.T) {
		pending, err := mfaPendingSessionFromClaims(jwt.MapClaims{
			"mfa_pending": true,
			"sub":         "123",
		})
		require.NoError(t, err)
		assert.Equal(t, "123", pending.User.ID)

		pending, err = mfaPendingSessionFromClaims(jwt.MapClaims{
			"mfa_pending": true,
		})
		assert.Nil(t, pending)
		assert.ErrorIs(t, err, ErrInvalidToken)
	})

	t.Run("int claim supports private int values", func(t *testing.T) {
		value, ok := intClaim(jwt.MapClaims{"org_id": 7}, "org_id")

		assert.True(t, ok)
		assert.Equal(t, 7, value)
	})

	t.Run("near expiry supports float claims and invalid exp types", func(t *testing.T) {
		now := float64(time.Now().Unix())
		assert.True(t, IsTokenNearExpiry(&jwt.Token{Claims: jwt.MapClaims{
			"iat": now - 90,
			"exp": now + 10,
		}}, 0.5))
		assert.False(t, IsTokenNearExpiry(&jwt.Token{Claims: jwt.MapClaims{
			"iat": time.Now().Unix() - 10,
			"exp": "bad",
		}}, 0.5))
	})

	t.Run("mfa pending cookies", func(t *testing.T) {
		w := httptest.NewRecorder()
		ApplyMFAPendingCookie(w, "pending-token", false)
		ClearMFAPendingCookie(w, true)

		cookies := w.Result().Cookies()
		require.Len(t, cookies, 2)
		assert.Equal(t, MFAPendingCookieName, cookies[0].Name)
		assert.Equal(t, "pending-token", cookies[0].Value)
		assert.Equal(t, MFAPendingCookieName, cookies[1].Name)
		assert.Equal(t, -1, cookies[1].MaxAge)
	})
}

func TestTOTPBranches(t *testing.T) {
	t.Run("generate success and failure", func(t *testing.T) {
		previous := totpRandomReader
		totpRandomReader = strings.NewReader(strings.Repeat("a", 20))
		t.Cleanup(func() { totpRandomReader = previous })

		secret, err := GenerateTOTPSecret()
		require.NoError(t, err)
		assert.NotEmpty(t, secret)

		totpRandomReader = failingReader{err: errors.New("entropy unavailable")}
		secret, err = GenerateTOTPSecret()
		assert.Empty(t, secret)
		require.ErrorContains(t, err, "generate secret")
	})

	t.Run("uri labels", func(t *testing.T) {
		withEmail := BuildTOTPURI(" user@example.com ", "SECRET")
		withoutEmail := BuildTOTPURI(" ", "SECRET")

		parsed, err := url.Parse(withEmail)
		require.NoError(t, err)
		assert.Equal(t, "/TaskForceAI:user@example.com", parsed.Path)
		assert.Contains(t, withoutEmail, "otpauth://totp/TaskForceAI?")
	})

	t.Run("verification edge cases", func(t *testing.T) {
		secret := "JBSWY3DPEHPK3PXP"
		secretBytes, err := decodeTOTPSecret(secret)
		require.NoError(t, err)
		code := totpCodeForTest(secretBytes, 0)

		assert.False(t, VerifyTOTPCode(secret, "123", time.Now()))
		assert.True(t, VerifyTOTPCode(secret, code, time.Unix(0, 0)))

		_, err = decodeTOTPSecret(" ")
		require.ErrorContains(t, err, "empty secret")
		assert.False(t, constantTimeTOTPCodeEqual([TOTPDigits]byte{}, "123"))
	})
}

func pemPrivateKey(t *testing.T, key *rsa.PrivateKey) []byte {
	t.Helper()
	return pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
}
