package refresh

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	redis_mocks "github.com/TaskForceAI/infrastructure/redis/mocks/pkg"
	"github.com/golang-jwt/jwt/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func setupMockQueries(t testing.TB) pgxmock.PgxPoolIface {
	mockPool, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	queries := db.New(mockPool)
	handler.SetQueriesOverride(func(ctx context.Context) (*db.Queries, error) {
		return queries, nil
	})
	t.Cleanup(func() { handler.SetQueriesOverride(nil) })
	return mockPool
}

func refreshUserStatusRows(id int32, disabled bool) *pgxmock.Rows {
	return pgxmock.NewRows([]string{"id", "disabled"}).AddRow(id, disabled)
}

func testAuthSecret() string {
	return strings.Join([]string{"test", "secret", "32", "characters", "long!!"}, "-")
}

func setupRefreshHandlerAuth(t testing.TB) string {
	t.Helper()
	authpkg.ResetJWTKeysForTest()
	handler.SetRedisClient(nil)
	t.Cleanup(func() {
		authpkg.ResetJWTKeysForTest()
		handler.SetRedisClient(nil)
		handler.SetQueriesOverride(nil)
	})

	testSecret := testAuthSecret()
	t.Setenv("AUTH_SECRET", testSecret)
	return testSecret
}

func TestClaimToUnixSeconds(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  any
		want int64
		ok   bool
	}{
		{name: "float", raw: float64(123), want: 123, ok: true},
		{name: "int64", raw: int64(456), want: 456, ok: true},
		{name: "int", raw: 789, want: 789, ok: true},
		{name: "zero", raw: 0, ok: false},
		{name: "negative", raw: int64(-1), ok: false},
		{name: "string", raw: "123", ok: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := claimToUnixSeconds(tc.raw)
			assert.Equal(t, tc.ok, ok)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestGetRemainingTokenLifetimeSeconds(t *testing.T) {
	now := int64(1_000)

	remaining, err := getRemainingTokenLifetimeSeconds(jwt.MapClaims{"exp": now + 60}, now)
	require.NoError(t, err)
	assert.Equal(t, 60, remaining)

	remaining, err = getRemainingTokenLifetimeSeconds(jwt.MapClaims{"exp": now + 10_000}, now)
	require.NoError(t, err)
	assert.Equal(t, impersonationRefreshMaxAgeSeconds, remaining)

	for _, claims := range []jwt.MapClaims{
		{},
		{"exp": "bad"},
		{"exp": now},
	} {
		remaining, err = getRemainingTokenLifetimeSeconds(claims, now)
		require.Error(t, err)
		assert.Zero(t, remaining)
	}
}

func TestGetStringClaim(t *testing.T) {
	claims := jwt.MapClaims{
		"sub":     "123",
		"id":      float64(456),
		"user_id": "789",
	}

	assert.Equal(t, "123", getStringClaim(claims, "sub"))
	assert.Equal(t, "456", getStringClaim(claims, "id"))
	assert.Equal(t, "789", getStringClaim(claims, "user_id"))
	assert.Empty(t, getStringClaim(claims, "nonexistent"))
	assert.Equal(t, "123", getStringClaim(claims, "missing", "sub"))
}

func TestGetStringClaim_UnsupportedType(t *testing.T) {
	claims := jwt.MapClaims{
		"id": 123, // int is not float64 or string
	}
	assert.Empty(t, getStringClaim(claims, "id"))
}

func TestHandler_CORSPreflight(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodOptions, "/", nil)
	r.Header.Set("Origin", "https://www.taskforceai.chat")
	Handler(w, r)

	assert.Equal(t, http.StatusNoContent, w.Result().StatusCode)
}

func TestHandler_ClaimsError(t *testing.T) {
	// jwt.MapClaims is the standard, but what if it is something else?
	// We can't easily force this without a mock jwt parser,
	// but we can at least hit the getStringClaim missing logic.
}

func TestHandler_DisabledUserRejected(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	mock := setupMockQueries(t)
	defer func() {
		handler.SetQueriesOverride(nil)
		mock.Close()
	}()

	mock.ExpectQuery("(?s)SELECT (.+)disabled(.+)FROM users").
		WithArgs(int32(5)).
		WillReturnRows(refreshUserStatusRows(5, true))

	now := time.Now().Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "5", "email": "disabled@example.com", "iat": now - 60, "exp": now + 40,
	})
	tokenString, _ := token.SignedString([]byte(testSecret))

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})
	Handler(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestHandler_MFAPendingTokenRejected(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	now := time.Now().Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":         "123",
		"email":       "pending@example.com",
		"mfa_pending": true,
		"iat":         now - 200,
		"exp":         now + 100,
	})
	tokenString, err := token.SignedString([]byte(testSecret))
	require.NoError(t, err)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.Header.Set("Authorization", "Bearer "+tokenString)

	Handler(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
	assert.Empty(t, w.Header().Values("Set-Cookie"))
}

func TestHandler_FullClaims(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)
	t.Setenv("NODE_ENV", "production")

	mock := setupMockQueries(t)
	defer mock.Close()

	mock.ExpectQuery("(?s)SELECT (.+)disabled(.+)FROM users").
		WithArgs(int32(123)).
		WillReturnRows(refreshUserStatusRows(123, false))

	now := time.Now().Unix()
	claims := jwt.MapClaims{
		"sub":           "123",
		"email":         "test@example.com",
		"name":          "John",
		"workos_org_id": "org_1",
		"org_id":        float64(456),
		"picture":       "pic",
		"act_as":        "admin",
		"iat":           now - 60,
		"exp":           now + 40,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString([]byte(testSecret))

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})

	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)

	foundSecure := false
	for _, cookie := range w.Header().Values("Set-Cookie") {
		if strings.Contains(cookie, "__Secure-session_token") {
			foundSecure = true
			break
		}
	}
	assert.True(t, foundSecure, "Should have found __Secure-session_token cookie")
}

func TestHandler_ImpersonationExpiredTokenRejected(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	mock := setupMockQueries(t)
	defer func() {
		handler.SetQueriesOverride(nil)
		mock.Close()
	}()

	mock.ExpectQuery("(?s)SELECT (.+)disabled(.+)FROM users").
		WithArgs(int32(6)).
		WillReturnRows(refreshUserStatusRows(6, false))

	now := time.Now().Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "6", "email": "user@example.com", "iat": now - 120, "exp": now - 10, "act_as": "admin@example.com",
	})
	tokenString, _ := token.SignedString([]byte(testSecret))

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})
	Handler(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestHandler_ImpersonationRefreshPreservesShortLifetime(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	mock := setupMockQueries(t)
	defer mock.Close()

	mock.ExpectQuery("(?s)SELECT (.+)disabled(.+)FROM users").
		WithArgs(int32(123)).
		WillReturnRows(refreshUserStatusRows(123, false))

	now := time.Now().Unix()
	claims := jwt.MapClaims{
		"sub":    "123",
		"email":  "target@example.com",
		"act_as": "1",
		"iat":    now - 20*60,
		"exp":    now + 10*60,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(testSecret))
	require.NoError(t, err)

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})

	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	sessionCookie := findSessionCookieHeader(w.Header().Values("Set-Cookie"))
	assert.NotEmpty(t, sessionCookie)

	maxAge, ok := extractCookieMaxAge(sessionCookie)
	assert.True(t, ok)
	assert.Positive(t, maxAge)
	assert.LessOrEqual(t, maxAge, 1800)
	assert.NotEqual(t, 3600, maxAge)
}

func findSessionCookieHeader(cookies []string) string {
	for _, cookie := range cookies {
		if strings.HasPrefix(cookie, "session_token=") {
			return cookie
		}
	}
	return ""
}

func extractCookieMaxAge(cookieHeader string) (int, bool) {
	re := regexp.MustCompile(`Max-Age=(\d+)`)
	match := re.FindStringSubmatch(cookieHeader)
	if len(match) != 2 {
		return 0, false
	}
	maxAge, err := strconv.Atoi(match[1])
	if err != nil {
		return 0, false
	}
	return maxAge, true
}

func TestHandler_InvalidToken(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: "invalid-token"})

	Handler(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestHandler_MethodNotAllowed(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	Handler(w, r)

	assert.Equal(t, http.StatusMethodNotAllowed, w.Result().StatusCode)
}

func TestHandler_MissingUserIDClaimReturnsUnauthorized(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	now := time.Now().Unix()
	claims := jwt.MapClaims{
		"email": "test@example.com",
		"iat":   now - 60,
		"exp":   now + 40,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString([]byte(testSecret))

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})

	Handler(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestHandler_NoToken(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	Handler(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestHandler_NotEligible(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	// Create a token that is NOT near expiry (e.g. 10% elapsed)
	now := time.Now().Unix()
	claims := jwt.MapClaims{
		"sub":   "123",
		"email": "test@example.com",
		"iat":   now - 10,
		"exp":   now + 90,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString([]byte(testSecret))

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})

	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)

	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	refreshed, ok := resp["refreshed"].(bool)
	assert.True(t, ok)
	assert.False(t, refreshed)
	assert.Equal(t, "Token not yet eligible for refresh", resp["message"])
}

func TestHandler_RevocationCheckFailureReturnsServiceUnavailable(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	mockRedis := new(redis_mocks.Cmdable)
	mockRedis.On("Get", mock.Anything, mock.Anything).Return("", errors.New("redis unavailable"))
	handler.SetRedisClient(mockRedis)
	defer handler.SetRedisClient(nil)

	now := time.Now().Unix()
	claims := jwt.MapClaims{
		"sub":       "123",
		"email":     "test@example.com",
		"auth_time": now - 300,
		"iat":       now - 60,
		"exp":       now + 40,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString([]byte(testSecret))

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})

	Handler(w, r)

	assert.Equal(t, http.StatusServiceUnavailable, w.Result().StatusCode)
}

func TestHandler_MissingRevocationKeyCanRefresh(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	mockRedis := new(redis_mocks.Cmdable)
	mockRedis.On("Get", mock.Anything, mock.Anything).Return("", errors.New("key not found"))
	handler.SetRedisClient(mockRedis)
	defer handler.SetRedisClient(nil)

	mockPool := setupMockQueries(t)
	defer mockPool.Close()
	mockPool.ExpectQuery("(?s)SELECT (.+)disabled(.+)FROM users").
		WithArgs(int32(123)).
		WillReturnRows(refreshUserStatusRows(123, false))

	now := time.Now().Unix()
	claims := jwt.MapClaims{
		"sub":       "123",
		"email":     "test@example.com",
		"auth_time": now - 300,
		"iat":       now - 60,
		"exp":       now + 40,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString([]byte(testSecret))

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})

	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestHandler_RevokedTokenRejected(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	mockRedis := new(redis_mocks.Cmdable)
	mockRedis.On("Get", mock.Anything, mock.Anything).Return("1", nil)

	handler.SetRedisClient(mockRedis)
	t.Cleanup(func() { handler.SetRedisClient(nil) })

	now := time.Now().Unix()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "123", "email": "test@example.com", "iat": now - 60, "exp": now + 40,
	})
	tokenString, _ := token.SignedString([]byte(testSecret))

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})
	Handler(w, r)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestHandler_Success(t *testing.T) {
	testSecret := setupRefreshHandlerAuth(t)

	mock := setupMockQueries(t)
	defer mock.Close()

	mock.ExpectQuery("(?s)SELECT (.+)disabled(.+)FROM users").
		WithArgs(int32(123)).
		WillReturnRows(refreshUserStatusRows(123, false))

	// Create a token that is near expiry (e.g. 60% elapsed)
	now := time.Now().Unix()
	claims := jwt.MapClaims{
		"sub":       "123",
		"email":     "test@example.com",
		"auth_time": now - 300,
		"iat":       now - 60,
		"exp":       now + 40,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString([]byte(testSecret))

	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})

	Handler(w, r)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)

	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	refreshed, ok := resp["refreshed"].(bool)
	assert.True(t, ok)
	assert.True(t, refreshed)

	var refreshedToken string
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == "session_token" || cookie.Name == "__Secure-session_token" {
			refreshedToken = cookie.Value
			break
		}
	}
	require.NotEmpty(t, refreshedToken)
	parsed, err := authpkg.VerifyToken(refreshedToken)
	require.NoError(t, err)
	refreshedClaims, ok := parsed.Claims.(jwt.MapClaims)
	require.True(t, ok)
	assert.Equal(t, float64(now-300), refreshedClaims["auth_time"])
}

func TestValidateUserDatabaseUnavailable(t *testing.T) {
	handler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	})
	t.Cleanup(func() { handler.SetQueriesOverride(nil) })
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/", nil)

	err := validateUser(r, w, "123")

	require.Error(t, err)
	assert.Equal(t, http.StatusServiceUnavailable, w.Result().StatusCode)
}

func TestValidateUserRejectsInvalidIDs(t *testing.T) {
	for _, userID := range []string{"abc", "2147483648"} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, "/", nil)

		err := validateUser(r, w, userID)

		require.Error(t, err)
		assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
	}
}
