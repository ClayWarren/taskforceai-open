package mfa

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1" // #nosec G505 -- test helper mirrors TOTP/HOTP standard.
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	servicehandler "github.com/TaskForceAI/auth-service/pkg/handler"
	sharedcrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoginVerifyHandlerFailsClosedWhenAccountLimiterUnavailableInProduction(t *testing.T) {
	withMFAEnv(t)
	resetMFAHooks(t)
	t.Setenv("NODE_ENV", "production")
	servicehandler.SetRedisClient(nil)
	t.Cleanup(func() { servicehandler.SetRedisClient(nil) })

	queriesCalled := false
	servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		queriesCalled = true
		return nil, errors.New("database should not be used when MFA login limiter is unavailable")
	})
	t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })

	verifyCalled := false
	verifyTOTPCode = func(string, string, time.Time) bool {
		verifyCalled = true
		return true
	}

	pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{ID: "123", Email: "user@example.com"}, "/", testAuthSecret)
	require.NoError(t, err)
	body, err := json.Marshal(LoginRequest{Code: "123456", MFAToken: pendingToken})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	LoginVerifyHandler(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	assert.Contains(t, rr.Body.String(), "Service unavailable")
	assert.False(t, queriesCalled)
	assert.False(t, verifyCalled)
}

func TestLoginVerifyHandlerSanitizesRedirectFallback(t *testing.T) {
	withMFAEnv(t)
	resetMFAHooks(t)
	decryptSecret = func(string) (string, error) { return testTOTPSecret, nil }
	verifyTOTPCode = func(string, string, time.Time) bool { return true }
	mock := dbtest.NewMockPoolRegexp(t)
	servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) { return db.New(mock), nil })
	t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })
	encryptedSecret := "encrypted"
	mock.ExpectQuery(`SELECT id, email, full_name, disabled`).
		WithArgs(int32(123)).
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 123, Email: "user@example.com", MFAEnabled: true, MFATOTPSecret: &encryptedSecret}))
	expectMFAAudit(mock)
	pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{ID: "123", Email: "user@example.com"}, "https://evil.example", testAuthSecret)
	require.NoError(t, err)
	body, err := json.Marshal(LoginRequest{Code: "123456", MFAToken: pendingToken})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/login/verify", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	LoginVerifyHandler(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"redirect_url":"/"`)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestLoginVerifyHandlerRejectsReplayedChallenge(t *testing.T) {
	withMFAEnv(t)
	resetMFAHooks(t)
	redis := infraredis.NewMockClient()
	servicehandler.SetRedisClient(redis)
	t.Cleanup(func() { servicehandler.SetRedisClient(nil) })

	mock := dbtest.NewMockPoolRegexp(t)
	servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) { return db.New(mock), nil })
	t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })

	encryptedSecret, err := sharedcrypto.Encrypt(testTOTPSecret)
	require.NoError(t, err)
	expectUser := func() {
		mock.ExpectQuery(`SELECT id, email, full_name, disabled`).
			WithArgs(int32(123)).
			WillReturnRows(dbtest.UserRow(dbtest.User{
				ID:            123,
				Email:         "user@example.com",
				MFAEnabled:    true,
				MFATOTPSecret: &encryptedSecret,
			}))
	}
	expectUser()
	expectMFAAudit(mock)
	expectUser()

	pendingToken, err := authpkg.EncodeMFAPendingToken(
		authpkg.SessionUser{ID: "123", Email: "user@example.com"},
		"/",
		testAuthSecret,
	)
	require.NoError(t, err)
	body, err := json.Marshal(LoginRequest{Code: currentTOTPCode(t), MFAToken: pendingToken})
	require.NoError(t, err)

	first := httptest.NewRecorder()
	firstRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/login", bytes.NewReader(body))
	firstRequest.Header.Set("Content-Type", "application/json")
	LoginVerifyHandler(first, firstRequest)

	second := httptest.NewRecorder()
	secondRequest := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/login", bytes.NewReader(body))
	secondRequest.Header.Set("Content-Type", "application/json")
	LoginVerifyHandler(second, secondRequest)

	assert.Equal(t, http.StatusOK, first.Code)
	assert.Equal(t, http.StatusUnauthorized, second.Code)
	assert.Contains(t, second.Body.String(), "MFA session expired")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMFAHelpersErrorBranches(t *testing.T) {
	err := verifyCurrentUserCode(context.Background(), nil, "123456")
	require.Error(t, err)

	_, _, err = resolveUserQueries(context.Background(), &adapterauth.AuthenticatedUser{ID: math.MaxInt32 + 1})
	require.Error(t, err)

	servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	})
	_, _, err = resolveUserQueries(context.Background(), authenticatedMFAUser())
	servicehandler.SetQueriesOverride(nil)
	require.Error(t, err)

	require.Error(t, mapUserSettingsErr(pgx.ErrNoRows))
	require.Error(t, mapUserSettingsErr(errors.New("db down")))
	auditMFA(context.Background(), nil, nil, "SETUP")
}

func TestMFAExtractedHelperBranches(t *testing.T) {
	t.Run("setup missing user", func(t *testing.T) {
		_, err := setupAuthenticatorMFA(context.Background(), nil)
		assert.Error(t, err)
	})

	t.Run("setup maps settings error", func(t *testing.T) {
		mock := withMFAQueries(t)
		mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
			WithArgs(int32(123)).
			WillReturnError(errors.New("db down"))

		_, err := setupAuthenticatorMFA(context.Background(), authenticatedMFAUser())

		require.Error(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("verify second query resolve error", func(t *testing.T) {
		withMFAEnv(t)
		resetMFAHooks(t)
		decryptSecret = func(string) (string, error) { return testTOTPSecret, nil }
		verifyTOTPCode = func(string, string, time.Time) bool { return true }
		mock := dbtest.NewMockPoolRegexp(t)
		encryptedSecret := "encrypted"
		mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
			WithArgs(int32(123)).
			WillReturnRows(mfaSettingsRows(mfaSettingsFixture{secret: &encryptedSecret}))
		calls := 0
		servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
			calls++
			if calls == 1 {
				return db.New(mock), nil
			}
			return nil, errors.New("db down")
		})
		t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })

		_, err := verifyAuthenticatorMFA(context.Background(), authenticatedMFAUser(), "123456")

		require.Error(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("disable second query resolve error", func(t *testing.T) {
		withMFAEnv(t)
		resetMFAHooks(t)
		decryptSecret = func(string) (string, error) { return testTOTPSecret, nil }
		verifyTOTPCode = func(string, string, time.Time) bool { return true }
		mock := dbtest.NewMockPoolRegexp(t)
		encryptedSecret := "encrypted"
		mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
			WithArgs(int32(123)).
			WillReturnRows(mfaSettingsRows(mfaSettingsFixture{secret: &encryptedSecret}))
		calls := 0
		servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
			calls++
			if calls == 1 {
				return db.New(mock), nil
			}
			return nil, errors.New("db down")
		})
		t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })

		_, err := disableAuthenticatorMFA(context.Background(), authenticatedMFAUser(), "123456")

		require.Error(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})
}

func TestVerifyCurrentUserCodeSecretBranches(t *testing.T) {
	t.Run("decrypt error", func(t *testing.T) {
		withMFAEnv(t)
		resetMFAHooks(t)
		decryptSecret = func(string) (string, error) { return "", errors.New("decrypt failed") }
		mock := withMFAQueries(t)
		encryptedSecret := "encrypted"
		mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
			WithArgs(int32(123)).
			WillReturnRows(mfaSettingsRows(mfaSettingsFixture{secret: &encryptedSecret}))

		err := verifyCurrentUserCode(context.Background(), authenticatedMFAUser(), "123456")

		require.Error(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("invalid code", func(t *testing.T) {
		withMFAEnv(t)
		resetMFAHooks(t)
		decryptSecret = func(string) (string, error) { return testTOTPSecret, nil }
		verifyTOTPCode = func(string, string, time.Time) bool { return false }
		mock := withMFAQueries(t)
		encryptedSecret := "encrypted"
		mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
			WithArgs(int32(123)).
			WillReturnRows(mfaSettingsRows(mfaSettingsFixture{secret: &encryptedSecret}))

		err := verifyCurrentUserCode(context.Background(), authenticatedMFAUser(), "123456")

		require.Error(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})
}

func TestMFARequestInfoResolve(t *testing.T) {
	t.Run("forwarded headers", func(t *testing.T) {
		var info requestInfo
		errs := info.Resolve(mfaResolveContext{
			remoteAddr: "10.0.0.1:1234",
			headers: map[string]string{
				"X-Forwarded-For": " 203.0.113.9 ",
				"X-Real-IP":       "198.51.100.8",
			},
		})

		require.Nil(t, errs)
		require.NotNil(t, info.ClientIP)
		assert.Equal(t, "203.0.113.9", *info.ClientIP)
	})

	t.Run("remote address fallback", func(t *testing.T) {
		var info requestInfo
		errs := info.Resolve(mfaResolveContext{remoteAddr: "198.51.100.7:4040"})

		require.Nil(t, errs)
		require.NotNil(t, info.ClientIP)
		assert.Equal(t, "198.51.100.7", *info.ClientIP)
	})
}

func TestMFAClientIPFromRemoteAddr(t *testing.T) {
	ip := clientIPFromRemoteAddr(" 192.0.2.44:321 ")
	require.NotNil(t, ip)
	assert.Equal(t, "192.0.2.44", *ip)

	ip = clientIPFromRemoteAddr("bare-host")
	require.NotNil(t, ip)
	assert.Equal(t, "bare-host", *ip)

	assert.Nil(t, clientIPFromRemoteAddr("   "))
}

func TestCheckMFARateLimitBranches(t *testing.T) {
	t.Run("missing user", func(t *testing.T) {
		err := checkMFARateLimit(context.Background(), nil, nil, "setup", mfaSetupMaxRequests)
		require.Error(t, err)
	})

	t.Run("allowed user and ip keys", func(t *testing.T) {
		withMFAEnv(t)
		redis := &allowMFARateLimitRedis{MockClient: infraredis.NewMockClient()}
		servicehandler.SetRedisClient(redis)
		t.Cleanup(func() { servicehandler.SetRedisClient(nil) })
		ip := "203.0.113.10"

		err := checkMFARateLimit(context.Background(), authenticatedMFAUser(), &ip, "setup", mfaSetupMaxRequests)

		require.NoError(t, err)
		assert.Equal(t, []string{"auth:mfa:u:setup:user:123", "auth:mfa:u:setup:ip:203.0.113.10"}, redis.keys)
	})

	t.Run("check error fails open locally", func(t *testing.T) {
		withMFAEnv(t)
		redis := &errorMFARateLimitRedis{MockClient: infraredis.NewMockClient()}
		servicehandler.SetRedisClient(redis)
		t.Cleanup(func() { servicehandler.SetRedisClient(nil) })
		ip := "203.0.113.10"

		err := checkMFARateLimit(context.Background(), authenticatedMFAUser(), &ip, "verify", mfaVerifyMaxRequests)

		require.NoError(t, err)
		assert.Equal(t, []string{"auth:mfa:u:verify:user:123", "auth:mfa:u:verify:ip:203.0.113.10"}, redis.keys)
	})

	t.Run("check error fails closed in production", func(t *testing.T) {
		withMFAEnv(t)
		t.Setenv("NODE_ENV", "production")
		redis := &errorMFARateLimitRedis{MockClient: infraredis.NewMockClient()}
		servicehandler.SetRedisClient(redis)
		t.Cleanup(func() { servicehandler.SetRedisClient(nil) })

		err := checkMFARateLimit(context.Background(), authenticatedMFAUser(), nil, "disable", mfaDisableMaxRequests)

		require.Error(t, err)
		assert.Equal(t, []string{"auth:mfa:u:disable:user:123"}, redis.keys)
	})
}

func TestMFASetupAndDisableRoutesApplyRateLimit(t *testing.T) {
	for _, tc := range []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{
			name:   "setup",
			method: http.MethodPost,
			path:   "/api/v1/auth/mfa/authenticator/setup",
			body:   `{}`,
		},
		{
			name:   "disable",
			method: http.MethodDelete,
			path:   "/api/v1/auth/mfa/authenticator",
			body:   `{"code":"123456"}`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withMFAEnv(t)
			servicehandler.SetRedisClient(deniedMFARateLimitRedis{MockClient: infraredis.NewMockClient()})
			t.Cleanup(func() { servicehandler.SetRedisClient(nil) })

			rr := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

			assert.Equal(t, http.StatusTooManyRequests, rr.Code)
		})
	}
}

func TestWriteMFAHTTPErrorGeneric(t *testing.T) {
	rr := httptest.NewRecorder()

	writeMFAHTTPError(rr, errors.New("boom"))

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.Contains(t, rr.Body.String(), "Internal error")
}

type mfaSettingsFixture struct {
	enabled bool
	secret  *string
}

type deniedMFARateLimitRedis struct {
	*infraredis.MockClient
}

func (m deniedMFARateLimitRedis) CheckRateLimit(context.Context, string, int, time.Duration) (bool, int, time.Time, error) {
	return false, 0, time.Now().Add(time.Minute), nil
}

type allowMFARateLimitRedis struct {
	*infraredis.MockClient
	keys []string
}

func (m *allowMFARateLimitRedis) CheckRateLimit(_ context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
	m.keys = append(m.keys, key)
	return true, limit - 1, time.Now().Add(window), nil
}

type errorMFARateLimitRedis struct {
	*infraredis.MockClient
	keys []string
}

func (m *errorMFARateLimitRedis) CheckRateLimit(_ context.Context, key string, _ int, window time.Duration) (bool, int, time.Time, error) {
	m.keys = append(m.keys, key)
	return false, 0, time.Now().Add(window), errors.New("rate limit unavailable")
}

type denySpecificMFARateLimitRedis struct {
	*infraredis.MockClient
	denyKey string
	keys    []string
}

func (m *denySpecificMFARateLimitRedis) CheckRateLimit(_ context.Context, key string, limit int, window time.Duration) (bool, int, time.Time, error) {
	m.keys = append(m.keys, key)
	if key == m.denyKey {
		return false, 0, time.Now().Add(window), nil
	}
	return true, limit - 1, time.Now().Add(window), nil
}

func authenticatedMFAUser() *adapterauth.AuthenticatedUser {
	return &adapterauth.AuthenticatedUser{ID: 123, Email: "user@example.com"}
}

type embeddedMFAHumaContext interface {
	huma.Context
}

type mfaResolveContext struct {
	embeddedMFAHumaContext
	remoteAddr string
	headers    map[string]string
}

func (c mfaResolveContext) Context() context.Context {
	return context.Background()
}

func (c mfaResolveContext) RemoteAddr() string {
	return c.remoteAddr
}

func (c mfaResolveContext) Header(name string) string {
	return c.headers[name]
}

func mfaRouter(user *adapterauth.AuthenticatedUser) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				r = r.WithContext(context.WithValue(r.Context(), adapterhandler.UserContextKey, user))
			}
			next.ServeHTTP(w, r)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api)
	return r
}

func withMFAQueries(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock := dbtest.NewMockPoolRegexp(t)
	servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
	t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })
	return mock
}

func mfaSettingsRows(fixture mfaSettingsFixture) *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "email", "full_name", "mfa_enabled", "mfa_totp_secret", "mfa_verified_at",
	}).AddRow(
		int32(123),
		"user@example.com",
		nil,
		fixture.enabled,
		fixture.secret,
		pgtype.Timestamp{},
	)
}

func expectMFAAudit(mock pgxmock.PgxPoolIface) {
	userID := "123"
	mock.ExpectQuery(`INSERT INTO audit_logs`).
		WithArgs(
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			"LOGIN",
			"user",
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			true,
			pgxmock.AnyArg(),
		).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "timestamp", "user_id", "organization_id", "action", "resource", "resource_id", "ip_address", "user_agent", "details", "success", "error_message",
		}).AddRow(int32(1), pgtype.Timestamp{Time: time.Now(), Valid: true}, &userID, nil, "LOGIN", "user", nil, nil, nil, []byte(`{}`), true, nil))
}

func expectMFAEventAudit(mock pgxmock.PgxPoolIface, action string) {
	userID := "123"
	mock.ExpectQuery(`INSERT INTO audit_logs`).
		WithArgs(
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			action,
			"mfa_authenticator",
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			true,
			pgxmock.AnyArg(),
		).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "timestamp", "user_id", "organization_id", "action", "resource", "resource_id", "ip_address", "user_agent", "details", "success", "error_message",
		}).AddRow(int32(1), pgtype.Timestamp{Time: time.Now(), Valid: true}, &userID, nil, action, "mfa_authenticator", nil, nil, nil, []byte(`{}`), true, nil))
}

func currentTOTPCode(t *testing.T) string {
	t.Helper()
	decoded, err := decodeTestTOTPSecret(testTOTPSecret)
	require.NoError(t, err)
	return testHOTP(decoded, uint64(time.Now().Unix()/authpkg.TOTPPeriodSeconds)) // #nosec G115 -- positive current timestamp.
}

func decodeTestTOTPSecret(secret string) ([]byte, error) {
	normalized := strings.ToUpper(strings.TrimSpace(secret))
	if rem := len(normalized) % 8; rem != 0 {
		normalized += strings.Repeat("=", 8-rem)
	}
	return base32.StdEncoding.DecodeString(normalized)
}

func testHOTP(secret []byte, counter uint64) string {
	var counterBytes [8]byte
	binary.BigEndian.PutUint64(counterBytes[:], counter)
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write(counterBytes[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	code := (uint32(sum[offset])&0x7f)<<24 |
		(uint32(sum[offset+1])&0xff)<<16 |
		(uint32(sum[offset+2])&0xff)<<8 |
		(uint32(sum[offset+3]) & 0xff)
	return fmt.Sprintf("%06d", code%uint32(math.Pow10(authpkg.TOTPDigits)))
}
