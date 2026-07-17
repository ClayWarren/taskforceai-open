package auth

import (
	"context"
	"errors"
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
	coreidentity "github.com/TaskForceAI/core/pkg/identity"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type failingLogoutRevoker struct{}

func (failingLogoutRevoker) Set(context.Context, string, []byte, time.Duration) error {
	return errors.New("revocation failed")
}

func (failingLogoutRevoker) Get(context.Context, string) (string, error) {
	return "", nil
}

type delErrorRedis struct {
	*infraredis.MockClient
}

func (d delErrorRedis) Del(context.Context, string) (bool, error) {
	return false, errors.New("delete failed")
}

func TestImpersonationHelpers(t *testing.T) {
	ctx := context.WithValue(context.Background(), adapterhandler.TokenIssuedAtContextKey, int(time.Now().Unix()))
	assert.WithinDuration(t, time.Now(), tokenIssuedAt(ctx), 5*time.Second)
	assert.True(t, tokenIssuedAt(context.Background()).IsZero())

	t.Setenv("ADMIN_REAUTH_MAX_AGE_MINUTES", "bad")
	assert.Equal(t, coreidentity.DefaultAdminReauthMaxAge, impersonationReauthMaxAge())

	t.Setenv("ADMIN_REAUTH_MAX_AGE_MINUTES", "7")
	assert.Equal(t, 7*time.Minute, impersonationReauthMaxAge())
}

func TestLogoutBranches(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")
	user := authpkg.SessionUser{ID: "1", Email: "user@example.com"}
	token, err := authpkg.EncodeSessionToken(user, "test-secret-value-that-is-long-enough", authpkg.DefaultSessionMaxAge)
	require.NoError(t, err)

	originalRevoker := getTokenRevoker
	getTokenRevoker = func() adapterauth.TokenRevoker { return failingLogoutRevoker{} }
	t.Cleanup(func() { getTokenRevoker = originalRevoker })
	revokeTokenOnLogout(context.Background(), token)

	getTokenRevoker = originalRevoker
	servicehandler.SetRedisClient(infraredis.NewMockClient())
	t.Cleanup(func() { servicehandler.SetRedisClient(nil) })
	assert.NotNil(t, getTokenRevoker())

	rr := httptest.NewRecorder()
	LogoutHandler(rr, httptest.NewRequest(http.MethodOptions, "/logout", nil))
	assert.Equal(t, http.StatusNoContent, rr.Code)
}

func TestLogoutHandler_FailsClosedAfterClearingAllLocalSessionCookies(t *testing.T) {
	authpkg.ResetJWTKeysForTest()
	t.Cleanup(authpkg.ResetJWTKeysForTest)
	secret := "test-secret-value-that-is-long-enough"
	t.Setenv("AUTH_SECRET", secret)
	t.Setenv("NODE_ENV", "production")
	token, err := authpkg.EncodeSessionToken(authpkg.SessionUser{ID: "1", Email: "user@example.com"}, secret, authpkg.DefaultSessionMaxAge)
	require.NoError(t, err)

	originalRevoker := getTokenRevoker
	getTokenRevoker = func() adapterauth.TokenRevoker { return failingLogoutRevoker{} }
	t.Cleanup(func() { getTokenRevoker = originalRevoker })

	req := httptest.NewRequest(http.MethodPost, "/logout", nil)
	req.AddCookie(&http.Cookie{Name: authpkg.SessionCookieName, Value: token})
	rr := httptest.NewRecorder()
	LogoutHandler(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	setCookies := strings.Join(rr.Header().Values("Set-Cookie"), "\n")
	assert.Contains(t, setCookies, authpkg.SessionCookieName+"=")
	assert.Contains(t, setCookies, authpkg.SecureSessionCookieName+"=")
	assert.Contains(t, setCookies, authpkg.MFAPendingCookieName+"=")
}

func TestSettingsHelpers(t *testing.T) {
	err := updateSettings(context.Background(), nil, UpdateSettingsRequest{})
	require.Error(t, err)

	t.Setenv("DATABASE_URL", "")
	_, err = defaultGetPool(context.Background())
	require.Error(t, err)

	servicehandler.SetRedisClient(delErrorRedis{MockClient: infraredis.NewMockClient()})
	t.Cleanup(func() { servicehandler.SetRedisClient(nil) })
	assert.Error(t, invalidateUserSettingsCache(context.Background(), 1))
}

func TestApplySettingsUpdateErrors(t *testing.T) {
	t.Run("full name update failure", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		q := db.New(mock)
		fullName := "User"
		mock.ExpectQuery(`UPDATE users SET full_name`).WithArgs(int32(1), &fullName).WillReturnError(errors.New("update failed"))

		updates, err := applySettingsUpdates(context.Background(), q, 1, UpdateSettingsRequest{FullName: &fullName})

		assert.Nil(t, updates)
		require.Error(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("bool update failure", func(t *testing.T) {
		mock := dbtest.NewMockPool(t)
		q := db.New(mock)
		enabled := true
		mock.ExpectQuery(`UPDATE users SET memory_enabled`).WithArgs(int32(1), enabled).WillReturnError(errors.New("update failed"))

		updates, err := applySettingsUpdates(context.Background(), q, 1, UpdateSettingsRequest{MemoryEnabled: &enabled})

		assert.Nil(t, updates)
		require.Error(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("audit skips empty updates", func(t *testing.T) {
		auditSettingsUpdate(context.Background(), db.New(dbtest.NewMockPool(t)), &adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"}, nil)
	})
}
