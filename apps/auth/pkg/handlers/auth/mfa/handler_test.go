package mfa

import (
	"bytes"
	"context" // #nosec G505 -- test helper mirrors TOTP/HOTP standard.
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	servicehandler "github.com/TaskForceAI/auth-service/pkg/handler"
	sharedcrypto "github.com/TaskForceAI/infrastructure/crypto/pkg"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testAuthSecret     = "mfa-test-secret-32-characters-long"
	testEncryptionKey  = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	testTOTPSecret     = "JBSWY3DPEHPK3PXP"
	testMFACallbackURL = "/settings/security"
)

func withMFAEnv(t *testing.T) {
	t.Helper()
	t.Setenv("AUTH_SECRET", testAuthSecret)
	t.Setenv("ENCRYPTION_KEY", testEncryptionKey)
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "taskforceai.chat")
	t.Setenv("NODE_ENV", "")
	t.Setenv("VERCEL", "")
}

func resetMFAHooks(t *testing.T) {
	t.Helper()
	originalEncodePending := encodeMFAPendingToken
	originalGenerate := generateTOTPSecret
	originalBuildURI := buildTOTPURI
	originalEncrypt := encryptSecret
	originalDecrypt := decryptSecret
	originalVerify := verifyTOTPCode
	originalEncodeSession := encodeSessionToken
	t.Cleanup(func() {
		encodeMFAPendingToken = originalEncodePending
		generateTOTPSecret = originalGenerate
		buildTOTPURI = originalBuildURI
		encryptSecret = originalEncrypt
		decryptSecret = originalDecrypt
		verifyTOTPCode = originalVerify
		encodeSessionToken = originalEncodeSession
	})
}

func TestMFARedirectURL(t *testing.T) {
	withMFAEnv(t)

	tests := []struct {
		name     string
		callback string
		want     string
	}{
		{
			name:     "relative callback",
			callback: "/settings/security",
			want:     "/login/mfa?callbackUrl=%2Fsettings%2Fsecurity",
		},
		{
			name:     "allowed absolute callback",
			callback: "https://app.taskforceai.chat/settings/security",
			want:     "https://app.taskforceai.chat/login/mfa?callbackUrl=https%3A%2F%2Fapp.taskforceai.chat%2Fsettings%2Fsecurity",
		},
		{
			name:     "external callback falls back home",
			callback: "https://evil.example/phish",
			want:     "/login/mfa?callbackUrl=%2F",
		},
		{
			name:     "path traversal falls back home",
			callback: "/../../admin",
			want:     "/login/mfa?callbackUrl=%2F",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, mfaRedirectURL(tt.callback))
		})
	}
}

func TestPendingLoginTokenSanitizesRedirect(t *testing.T) {
	withMFAEnv(t)

	token, err := PendingLoginToken(authpkg.SessionUser{
		ID:       "123",
		Email:    "user@example.com",
		FullName: "User",
	}, "https://evil.example/phish")
	require.NoError(t, err)

	pending, err := authpkg.VerifyMFAPendingToken(token)
	require.NoError(t, err)
	assert.Equal(t, "123", pending.User.ID)
	assert.Equal(t, "/", pending.RedirectURL)
}

func TestStartPendingWebLogin(t *testing.T) {
	withMFAEnv(t)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback?callbackUrl=/settings/security", nil)
	rr := httptest.NewRecorder()
	user := &authpkg.AuthUser{ID: 123, Email: "user@example.com", MFAEnabled: true}
	sessionUser := authpkg.SessionUser{ID: "123", Email: "user@example.com", FullName: "User"}

	handled := StartPendingWebLogin(rr, req, user, sessionUser, testMFACallbackURL)

	assert.True(t, handled)
	assert.Equal(t, http.StatusTemporaryRedirect, rr.Code)
	assert.Equal(t, "/login/mfa?callbackUrl=%2Fsettings%2Fsecurity", rr.Header().Get("Location"))
	assert.Contains(t, rr.Header().Values("Set-Cookie")[0], authpkg.MFAPendingCookieName+"=")
}

func TestStartPendingWebLoginSkipsUsersWithoutMFA(t *testing.T) {
	withMFAEnv(t)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback", nil)

	handled := StartPendingWebLogin(rr, req, &authpkg.AuthUser{ID: 123, MFAEnabled: false}, authpkg.SessionUser{}, "/")

	assert.False(t, handled)
	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Empty(t, rr.Header().Values("Set-Cookie"))
}

func TestStartPendingWebLoginHandlesPendingTokenError(t *testing.T) {
	withMFAEnv(t)
	resetMFAHooks(t)
	encodeMFAPendingToken = func(authpkg.SessionUser, string, string) (string, error) {
		return "", errors.New("sign failed")
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback", nil)

	handled := StartPendingWebLogin(rr, req, &authpkg.AuthUser{ID: 123, MFAEnabled: true}, authpkg.SessionUser{ID: "123"}, "/")

	assert.True(t, handled)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.Contains(t, rr.Body.String(), "Failed to start MFA challenge")
}

func TestLoginVerifyHandlerRejectsInvalidRequests(t *testing.T) {
	withMFAEnv(t)

	tests := []struct {
		name   string
		method string
		body   string
		want   int
		detail string
	}{
		{
			name:   "method not allowed",
			method: http.MethodGet,
			body:   "",
			want:   http.StatusMethodNotAllowed,
			detail: "Method not allowed",
		},
		{
			name:   "bad json",
			method: http.MethodPost,
			body:   "{",
			want:   http.StatusBadRequest,
			detail: "Invalid request body",
		},
		{
			name:   "missing pending token",
			method: http.MethodPost,
			body:   `{"code":"123456"}`,
			want:   http.StatusUnauthorized,
			detail: "MFA session expired",
		},
		{
			name:   "invalid pending token",
			method: http.MethodPost,
			body:   `{"code":"123456","mfa_token":"not-a-token"}`,
			want:   http.StatusUnauthorized,
			detail: "MFA session expired",
		},
		{
			name:   "missing code",
			method: http.MethodPost,
			body:   `{"mfa_token":"token"}`,
			want:   http.StatusBadRequest,
			detail: "Code",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/api/v1/auth/mfa/login/verify", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()

			LoginVerifyHandler(rr, req)

			assert.Equal(t, tt.want, rr.Code)
			assert.Contains(t, rr.Body.String(), tt.detail)
		})
	}
}

func TestLoginVerifyHandlerCORS(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/auth/mfa/login/verify", nil)
	rr := httptest.NewRecorder()

	LoginVerifyHandler(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
}

func TestLoginVerifyHandlerUsesCookieAndHandlesQueryError(t *testing.T) {
	withMFAEnv(t)
	servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	})
	t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })
	pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{ID: "123", Email: "user@example.com"}, "/", testAuthSecret)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/login/verify", strings.NewReader(`{"code":"123456"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: authpkg.MFAPendingCookieName, Value: pendingToken})
	rr := httptest.NewRecorder()

	LoginVerifyHandler(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestLoginVerifyHandlerUserLoadFailures(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want int
	}{
		{name: "missing user", err: pgx.ErrNoRows, want: http.StatusUnauthorized},
		{name: "database error", err: errors.New("db down"), want: http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withMFAEnv(t)
			mock := dbtest.NewMockPoolRegexp(t)
			servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
				return db.New(mock), nil
			})
			t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })
			mock.ExpectQuery(`SELECT id, email, full_name, disabled`).
				WithArgs(int32(123)).
				WillReturnError(tc.err)
			pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{ID: "123", Email: "user@example.com"}, "/", testAuthSecret)
			require.NoError(t, err)
			body, err := json.Marshal(LoginRequest{Code: "123456", MFAToken: pendingToken})
			require.NoError(t, err)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/login/verify", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()

			LoginVerifyHandler(rr, req)

			assert.Equal(t, tc.want, rr.Code)
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestLoginVerifyHandlerInvalidSessionUserAndSecretFailures(t *testing.T) {
	t.Run("invalid pending user id", func(t *testing.T) {
		withMFAEnv(t)
		pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{ID: "not-an-int"}, "/", testAuthSecret)
		require.NoError(t, err)
		servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) { return &db.Queries{}, nil })
		t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })
		body, err := json.Marshal(LoginRequest{Code: "123456", MFAToken: pendingToken})
		require.NoError(t, err)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/login/verify", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()

		LoginVerifyHandler(rr, req)

		assert.Equal(t, http.StatusUnauthorized, rr.Code)
	})

	t.Run("invalid user state", func(t *testing.T) {
		withMFAEnv(t)
		mock := dbtest.NewMockPoolRegexp(t)
		servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) { return db.New(mock), nil })
		t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })
		mock.ExpectQuery(`SELECT id, email, full_name, disabled`).
			WithArgs(int32(123)).
			WillReturnRows(dbtest.UserRow(dbtest.User{ID: 123, Email: "user@example.com", Disabled: true}))
		pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{ID: "123"}, "/", testAuthSecret)
		require.NoError(t, err)
		body, err := json.Marshal(LoginRequest{Code: "123456", MFAToken: pendingToken})
		require.NoError(t, err)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/login/verify", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()

		LoginVerifyHandler(rr, req)

		assert.Equal(t, http.StatusUnauthorized, rr.Code)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("decrypt error", func(t *testing.T) {
		withMFAEnv(t)
		resetMFAHooks(t)
		decryptSecret = func(string) (string, error) { return "", errors.New("decrypt failed") }
		mock := dbtest.NewMockPoolRegexp(t)
		servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) { return db.New(mock), nil })
		t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })
		encryptedSecret := "encrypted"
		mock.ExpectQuery(`SELECT id, email, full_name, disabled`).
			WithArgs(int32(123)).
			WillReturnRows(dbtest.UserRow(dbtest.User{ID: 123, Email: "user@example.com", MFAEnabled: true, MFATOTPSecret: &encryptedSecret}))
		pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{ID: "123"}, "/", testAuthSecret)
		require.NoError(t, err)
		body, err := json.Marshal(LoginRequest{Code: "123456", MFAToken: pendingToken})
		require.NoError(t, err)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/login/verify", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()

		LoginVerifyHandler(rr, req)

		assert.Equal(t, http.StatusInternalServerError, rr.Code)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("encode session error", func(t *testing.T) {
		withMFAEnv(t)
		resetMFAHooks(t)
		decryptSecret = func(string) (string, error) { return testTOTPSecret, nil }
		verifyTOTPCode = func(string, string, time.Time) bool { return true }
		encodeSessionToken = func(authpkg.SessionUser, string, int) (string, error) {
			return "", errors.New("sign failed")
		}
		mock := dbtest.NewMockPoolRegexp(t)
		servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) { return db.New(mock), nil })
		t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })
		encryptedSecret := "encrypted"
		mock.ExpectQuery(`SELECT id, email, full_name, disabled`).
			WithArgs(int32(123)).
			WillReturnRows(dbtest.UserRow(dbtest.User{ID: 123, Email: "user@example.com", MFAEnabled: true, MFATOTPSecret: &encryptedSecret}))
		pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{ID: "123"}, "/", testAuthSecret)
		require.NoError(t, err)
		body, err := json.Marshal(LoginRequest{Code: "123456", MFAToken: pendingToken})
		require.NoError(t, err)
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/login/verify", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()

		LoginVerifyHandler(rr, req)

		assert.Equal(t, http.StatusInternalServerError, rr.Code)
		assert.NoError(t, mock.ExpectationsWereMet())
	})
}

func TestMFAStatusRoute(t *testing.T) {
	withMFAEnv(t)
	mock := withMFAQueries(t)
	secret := "encrypted-secret"
	mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
		WithArgs(int32(123)).
		WillReturnRows(mfaSettingsRows(mfaSettingsFixture{
			enabled: true,
			secret:  &secret,
		}))

	rr := httptest.NewRecorder()
	mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/auth/mfa", nil))

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"authenticator_app_enabled":true`)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMFAStatusRouteRejectsMissingUser(t *testing.T) {
	rr := httptest.NewRecorder()
	mfaRouter(nil).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/auth/mfa", nil))

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestMFAStatusRouteMapsSettingsErrors(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want int
	}{
		{name: "not found", err: pgx.ErrNoRows, want: http.StatusNotFound},
		{name: "db unavailable", err: errors.New("db down"), want: http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mock := withMFAQueries(t)
			mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
				WithArgs(int32(123)).
				WillReturnError(tc.err)

			rr := httptest.NewRecorder()
			mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/v1/auth/mfa", nil))

			assert.Equal(t, tc.want, rr.Code)
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

func TestMFASetupRouteStoresSecretForUsersWithoutMFA(t *testing.T) {
	withMFAEnv(t)
	mock := withMFAQueries(t)
	mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
		WithArgs(int32(123)).
		WillReturnRows(mfaSettingsRows(mfaSettingsFixture{}))
	mock.ExpectQuery(`UPDATE users SET\s+mfa_enabled = false`).
		WithArgs(int32(123), pgxmock.AnyArg()).
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 123, Email: "user@example.com"}))
	expectMFAEventAudit(mock, "SETUP")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/setup", nil)
	mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"authenticator_app_enabled":false`)
	assert.Contains(t, rr.Body.String(), `"otpauth_uri":"otpauth://totp/TaskForceAI:user@example.com?`)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMFASetupRouteRejectsAlreadyEnabledAuthenticator(t *testing.T) {
	withMFAEnv(t)
	mock := withMFAQueries(t)
	secret := "encrypted-secret"
	mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
		WithArgs(int32(123)).
		WillReturnRows(mfaSettingsRows(mfaSettingsFixture{
			enabled: true,
			secret:  &secret,
		}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/setup", nil)
	mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusConflict, rr.Code)
	assert.Contains(t, rr.Body.String(), "Authenticator app MFA is already enabled")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMFASetupRouteRejectsMissingUser(t *testing.T) {
	rr := httptest.NewRecorder()
	mfaRouter(nil).ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/setup", nil))

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestMFASetupRouteHandlesQueryAndCryptoErrors(t *testing.T) {
	t.Run("resolve queries", func(t *testing.T) {
		servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
			return nil, errors.New("db down")
		})
		t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })
		rr := httptest.NewRecorder()
		mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/setup", nil))
		assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	})

	t.Run("generate secret", func(t *testing.T) {
		resetMFAHooks(t)
		generateTOTPSecret = func() (string, error) { return "", errors.New("entropy failed") }
		mock := withMFAQueries(t)
		mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
			WithArgs(int32(123)).
			WillReturnRows(mfaSettingsRows(mfaSettingsFixture{}))

		rr := httptest.NewRecorder()
		mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/setup", nil))

		assert.Equal(t, http.StatusInternalServerError, rr.Code)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("encrypt secret", func(t *testing.T) {
		resetMFAHooks(t)
		generateTOTPSecret = func() (string, error) { return testTOTPSecret, nil }
		encryptSecret = func(string) (string, error) { return "", errors.New("encrypt failed") }
		mock := withMFAQueries(t)
		mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
			WithArgs(int32(123)).
			WillReturnRows(mfaSettingsRows(mfaSettingsFixture{}))

		rr := httptest.NewRecorder()
		mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/setup", nil))

		assert.Equal(t, http.StatusInternalServerError, rr.Code)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("store setup", func(t *testing.T) {
		resetMFAHooks(t)
		generateTOTPSecret = func() (string, error) { return testTOTPSecret, nil }
		encryptSecret = func(string) (string, error) { return "encrypted", nil }
		mock := withMFAQueries(t)
		mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
			WithArgs(int32(123)).
			WillReturnRows(mfaSettingsRows(mfaSettingsFixture{}))
		mock.ExpectQuery(`UPDATE users SET\s+mfa_enabled = false`).
			WithArgs(int32(123), pgxmock.AnyArg()).
			WillReturnError(errors.New("store failed"))

		rr := httptest.NewRecorder()
		mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/setup", nil))

		assert.Equal(t, http.StatusInternalServerError, rr.Code)
		assert.NoError(t, mock.ExpectationsWereMet())
	})
}

func TestMFAVerifyRouteEnablesAuthenticator(t *testing.T) {
	withMFAEnv(t)
	mock := withMFAQueries(t)
	encryptedSecret, err := sharedcrypto.Encrypt(testTOTPSecret)
	require.NoError(t, err)
	mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
		WithArgs(int32(123)).
		WillReturnRows(mfaSettingsRows(mfaSettingsFixture{
			secret: &encryptedSecret,
		}))
	mock.ExpectQuery(`UPDATE users SET\s+mfa_enabled = true`).
		WithArgs(int32(123), &encryptedSecret).
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 123, Email: "user@example.com", MFAEnabled: true, MFATOTPSecret: &encryptedSecret}))
	expectMFAEventAudit(mock, "ENABLE")

	body := fmt.Sprintf(`{"code":%q}`, currentTOTPCode(t))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"authenticator_app_enabled":true`)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMFAVerifyRouteRejectsMissingSetup(t *testing.T) {
	withMFAEnv(t)
	mock := withMFAQueries(t)
	mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
		WithArgs(int32(123)).
		WillReturnRows(mfaSettingsRows(mfaSettingsFixture{}))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/verify", strings.NewReader(`{"code":"123456"}`))
	req.Header.Set("Content-Type", "application/json")
	mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
	assert.Contains(t, rr.Body.String(), "Authenticator app setup has not been started")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMFAVerifyRouteAppliesRateLimitBeforeCodeCheck(t *testing.T) {
	withMFAEnv(t)
	servicehandler.SetRedisClient(deniedMFARateLimitRedis{MockClient: infraredis.NewMockClient()})
	t.Cleanup(func() { servicehandler.SetRedisClient(nil) })

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/verify", strings.NewReader(`{"code":"123456"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-For", "203.0.113.10")
	mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusTooManyRequests, rr.Code)
}

func TestMFAVerifyRouteFailsClosedWhenLimiterUnavailableInProduction(t *testing.T) {
	withMFAEnv(t)
	t.Setenv("NODE_ENV", "production")
	servicehandler.SetRedisClient(nil)

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/verify", strings.NewReader(`{"code":"123456"}`))
	req.Header.Set("Content-Type", "application/json")
	mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestMFAVerifyRouteHandlesEnableError(t *testing.T) {
	withMFAEnv(t)
	mock := withMFAQueries(t)
	encryptedSecret, err := sharedcrypto.Encrypt(testTOTPSecret)
	require.NoError(t, err)
	mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
		WithArgs(int32(123)).
		WillReturnRows(mfaSettingsRows(mfaSettingsFixture{secret: &encryptedSecret}))
	mock.ExpectQuery(`UPDATE users SET\s+mfa_enabled = true`).
		WithArgs(int32(123), &encryptedSecret).
		WillReturnError(errors.New("enable failed"))

	body := fmt.Sprintf(`{"code":%q}`, currentTOTPCode(t))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/verify", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMFADisableRouteDisablesAuthenticator(t *testing.T) {
	withMFAEnv(t)
	mock := withMFAQueries(t)
	encryptedSecret, err := sharedcrypto.Encrypt(testTOTPSecret)
	require.NoError(t, err)
	mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
		WithArgs(int32(123)).
		WillReturnRows(mfaSettingsRows(mfaSettingsFixture{
			enabled: true,
			secret:  &encryptedSecret,
		}))
	mock.ExpectQuery(`UPDATE users SET\s+mfa_enabled = false,\s+mfa_totp_secret = null`).
		WithArgs(int32(123), &encryptedSecret).
		WillReturnRows(dbtest.UserRow(dbtest.User{ID: 123, Email: "user@example.com", MFAEnabled: false}))
	expectMFAEventAudit(mock, "DISABLE")

	body := fmt.Sprintf(`{"code":%q}`, currentTOTPCode(t))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/mfa/authenticator", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"authenticator_app_enabled":false`)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMFADisableRouteHandlesVerifyAndDisableErrors(t *testing.T) {
	t.Run("verify fails", func(t *testing.T) {
		withMFAEnv(t)
		mock := withMFAQueries(t)
		mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
			WithArgs(int32(123)).
			WillReturnRows(mfaSettingsRows(mfaSettingsFixture{}))

		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/mfa/authenticator", strings.NewReader(`{"code":"123456"}`))
		req.Header.Set("Content-Type", "application/json")
		mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusBadRequest, rr.Code)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("disable fails", func(t *testing.T) {
		withMFAEnv(t)
		mock := withMFAQueries(t)
		encryptedSecret, err := sharedcrypto.Encrypt(testTOTPSecret)
		require.NoError(t, err)
		mock.ExpectQuery(`SELECT id, email, full_name, mfa_enabled`).
			WithArgs(int32(123)).
			WillReturnRows(mfaSettingsRows(mfaSettingsFixture{enabled: true, secret: &encryptedSecret}))
		mock.ExpectQuery(`UPDATE users SET\s+mfa_enabled = false,\s+mfa_totp_secret = null`).
			WithArgs(int32(123), &encryptedSecret).
			WillReturnError(errors.New("disable failed"))

		body := fmt.Sprintf(`{"code":%q}`, currentTOTPCode(t))
		rr := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/mfa/authenticator", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		mfaRouter(authenticatedMFAUser()).ServeHTTP(rr, req)

		assert.Equal(t, http.StatusInternalServerError, rr.Code)
		assert.NoError(t, mock.ExpectationsWereMet())
	})
}

func TestLoginVerifyHandlerReturnsBearerTokenWhenMFATokenProvided(t *testing.T) {
	withMFAEnv(t)
	mock := dbtest.NewMockPoolRegexp(t)
	servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
	t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })

	encryptedSecret, err := sharedcrypto.Encrypt(testTOTPSecret)
	require.NoError(t, err)

	fullName := "MFA User"
	mock.ExpectQuery(`SELECT id, email, full_name, disabled`).
		WithArgs(int32(123)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID:            123,
			Email:         "user@example.com",
			FullName:      &fullName,
			MFAEnabled:    true,
			MFATOTPSecret: &encryptedSecret,
		}))
	expectMFAAudit(mock)

	pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{
		ID:       "123",
		Email:    "user@example.com",
		FullName: fullName,
	}, testMFACallbackURL, testAuthSecret)
	require.NoError(t, err)

	body, err := json.Marshal(LoginRequest{
		Code:     currentTOTPCode(t),
		MFAToken: pendingToken,
	})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "mfa-test")
	rr := httptest.NewRecorder()

	LoginVerifyHandler(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	var response LoginResponse
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &response))
	assert.True(t, response.Success)
	assert.Equal(t, testMFACallbackURL, response.RedirectURL)
	require.NotNil(t, response.AccessToken)
	require.NotEmpty(t, *response.AccessToken)
	require.NotNil(t, response.TokenType)
	assert.Equal(t, "bearer", *response.TokenType)
	require.NotNil(t, response.ExpiresIn)
	assert.Positive(t, *response.ExpiresIn)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestLoginVerifyHandlerRejectsInvalidAuthenticatorCode(t *testing.T) {
	withMFAEnv(t)
	mock := dbtest.NewMockPoolRegexp(t)
	servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
	t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })

	encryptedSecret, err := sharedcrypto.Encrypt(testTOTPSecret)
	require.NoError(t, err)
	mock.ExpectQuery(`SELECT id, email, full_name, disabled`).
		WithArgs(int32(123)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID:            123,
			Email:         "user@example.com",
			MFAEnabled:    true,
			MFATOTPSecret: &encryptedSecret,
		}))

	pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{ID: "123", Email: "user@example.com"}, "/", testAuthSecret)
	require.NoError(t, err)
	body, err := json.Marshal(LoginRequest{Code: "000000", MFAToken: pendingToken})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	LoginVerifyHandler(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
	assert.Contains(t, rr.Body.String(), "Invalid authenticator code")
	assert.NoError(t, mock.ExpectationsWereMet())
}

type failingChallengeRedis struct {
	*infraredis.MockClient
}

func (failingChallengeRedis) SetNX(context.Context, string, []byte, time.Duration) (bool, error) {
	return false, errors.New("redis unavailable")
}

func TestConsumeMFAPendingChallengeFailures(t *testing.T) {
	servicehandler.SetRedisClient(nil)
	t.Cleanup(func() { servicehandler.SetRedisClient(nil) })
	t.Setenv("NODE_ENV", "production")
	require.ErrorIs(t, consumeMFAPendingChallenge(context.Background(), "pending"), errMFAChallengeUnavailable)

	servicehandler.SetRedisClient(failingChallengeRedis{MockClient: infraredis.NewMockClient()})
	err := consumeMFAPendingChallenge(context.Background(), "pending")
	require.ErrorIs(t, err, errMFAChallengeUnavailable)
}

func TestLoginVerifyHandlerReportsChallengeStoreFailure(t *testing.T) {
	withMFAEnv(t)
	resetMFAHooks(t)
	verifyTOTPCode = func(string, string, time.Time) bool { return true }
	servicehandler.SetRedisClient(failingChallengeRedis{MockClient: infraredis.NewMockClient()})
	t.Cleanup(func() { servicehandler.SetRedisClient(nil) })

	mock := dbtest.NewMockPoolRegexp(t)
	servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
	t.Cleanup(func() { servicehandler.SetQueriesOverride(nil) })

	encryptedSecret, err := sharedcrypto.Encrypt(testTOTPSecret)
	require.NoError(t, err)
	mock.ExpectQuery(`SELECT id, email, full_name, disabled`).
		WithArgs(int32(123)).
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID:            123,
			Email:         "user@example.com",
			MFAEnabled:    true,
			MFATOTPSecret: &encryptedSecret,
		}))
	pendingToken, err := authpkg.EncodeMFAPendingToken(authpkg.SessionUser{ID: "123", Email: "user@example.com"}, "/", testAuthSecret)
	require.NoError(t, err)
	body, err := json.Marshal(LoginRequest{Code: "123456", MFAToken: pendingToken})
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/mfa/authenticator/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	LoginVerifyHandler(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	assert.Contains(t, rr.Body.String(), "temporarily unavailable")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestLoginVerifyHandlerAppliesAccountRateLimitBeforeCodeCheck(t *testing.T) {
	withMFAEnv(t)
	resetMFAHooks(t)

	redis := &denySpecificMFARateLimitRedis{
		MockClient: infraredis.NewMockClient(),
		denyKey:    "auth:mfa:u:login:user:123",
	}
	servicehandler.SetRedisClient(redis)
	t.Cleanup(func() { servicehandler.SetRedisClient(nil) })

	queriesCalled := false
	servicehandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		queriesCalled = true
		return nil, errors.New("database should not be used after MFA login rate limit")
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
	req.Header.Set("X-Forwarded-For", "203.0.113.10")
	rr := httptest.NewRecorder()

	LoginVerifyHandler(rr, req)

	assert.Equal(t, http.StatusTooManyRequests, rr.Code)
	assert.Contains(t, rr.Body.String(), "Too many requests")
	assert.False(t, queriesCalled)
	assert.False(t, verifyCalled)
	assert.Equal(t, []string{"auth:mfa:u:login:user:123"}, redis.keys)
}
