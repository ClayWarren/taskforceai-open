package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testAuthSecret() string {
	return strings.Join([]string{"test", "secret", "32", "characters", "long!!"}, "-")
}

func TestExtractToken(t *testing.T) {
	tests := []struct {
		name       string
		header     string
		cookieName string
		cookieVal  string
		want       string
	}{
		{
			name:   "standard bearer header",
			header: "Bearer header-token",
			want:   "header-token",
		},
		{
			name:   "bearer header is case insensitive",
			header: "bEaReR mixed-case-token",
			want:   "mixed-case-token",
		},
		{
			name:   "bearer header tolerates extra spaces",
			header: "   Bearer    spaced-token   ",
			want:   "spaced-token",
		},
		{
			name:       "invalid header format falls back to cookie",
			header:     "Bearer too many parts here",
			cookieName: "session_token",
			cookieVal:  "cookie-token",
			want:       "cookie-token",
		},
		{
			name:       "cookie fallback without authorization header",
			cookieName: "session_token",
			cookieVal:  "cookie-token-only",
			want:       "cookie-token-only",
		},
		{
			name:       "legacy auth token cookie is ignored",
			cookieName: "auth_token",
			cookieVal:  "legacy-token",
			want:       "",
		},
		{
			name:       "legacy nextauth cookie is ignored",
			cookieName: "__Secure-next-auth.session-token",
			cookieVal:  "legacy-nextauth-token",
			want:       "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.header != "" {
				req.Header.Set("Authorization", tc.header)
			}
			if tc.cookieName != "" {
				req.AddCookie(&http.Cookie{Name: tc.cookieName, Value: tc.cookieVal})
			}

			assert.Equal(t, tc.want, ExtractToken(req))
		})
	}
}

func TestGetUserID(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	assert.Equal(t, 0, GetUserID(req))

	ctx := context.WithValue(req.Context(), UserIDContextKey, 123)
	req = req.WithContext(ctx)
	assert.Equal(t, 123, GetUserID(req))
}

func TestGetOrgID(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	assert.Equal(t, 0, GetOrgID(req))

	ctx := context.WithValue(req.Context(), OrgIDContextKey, 456)
	req = req.WithContext(ctx)
	assert.Equal(t, 456, GetOrgID(req))
}

func TestGetUserIdentifier(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	assert.Empty(t, GetUserIdentifier(req))

	ctx := context.WithValue(req.Context(), EmailContextKey, "test@example.com")
	req = req.WithContext(ctx)
	assert.Equal(t, "test@example.com", GetUserIdentifier(req))

	ctx = context.WithValue(ctx, UserContextKey, &auth.AuthenticatedUser{Email: "preferred@example.com"})
	assert.Equal(t, "preferred@example.com", GetUserIdentifier(req.WithContext(ctx)))
}

func TestBuildAuthenticatedUser(t *testing.T) {
	exp := time.Now().Add(time.Hour).Unix()
	workosOrgID := "org_workos"
	claims := map[string]any{
		"email":         "test@example.com",
		"id":            float64(1),
		"org_id":        float64(10),
		"workos_org_id": workosOrgID,
		"exp":           float64(exp),
	}
	user, err := BuildAuthenticatedUser(claims)
	require.NoError(t, err)
	assert.Equal(t, 1, user.ID)
	assert.Equal(t, 10, *user.OrgID)
	require.NotNil(t, user.WorkosOrgID)
	assert.Equal(t, workosOrgID, *user.WorkosOrgID)
	require.NotNil(t, user.ExpiresAt)
	assert.Equal(t, exp, user.ExpiresAt.Unix())
}

func TestIsMFAPendingClaims(t *testing.T) {
	tests := []struct {
		name   string
		claims map[string]any
		want   bool
	}{
		{
			name:   "missing claim",
			claims: map[string]any{},
			want:   false,
		},
		{
			name:   "boolean false",
			claims: map[string]any{"mfa_pending": false},
			want:   false,
		},
		{
			name:   "boolean true",
			claims: map[string]any{"mfa_pending": true},
			want:   true,
		},
		{
			name:   "string true is not accepted",
			claims: map[string]any{"mfa_pending": "true"},
			want:   false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, IsMFAPendingClaims(tc.claims))
		})
	}
}

func TestTokenIssuedAtUnixFromClaims(t *testing.T) {
	iat, ok := TokenIssuedAtUnixFromClaims(map[string]any{"iat": float64(1700000000)})
	assert.True(t, ok)
	assert.Equal(t, int64(1700000000), iat)

	authTime, ok := TokenIssuedAtUnixFromClaims(map[string]any{"auth_time": "1700000001", "iat": float64(1)})
	assert.True(t, ok)
	assert.Equal(t, int64(1700000001), authTime)

	_, ok = TokenIssuedAtUnixFromClaims(map[string]any{"iat": "bad"})
	assert.False(t, ok)

	exp, ok := TokenExpiresAtUnixFromClaims(map[string]any{"exp": float64(1700000002)})
	assert.True(t, ok)
	assert.Equal(t, int64(1700000002), exp)
}

func TestWithAuth_ValidatesBearerToken(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)

	claims := jwt.MapClaims{
		"email": "user@example.com",
		"sub":   "42",
		"exp":   time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString([]byte(secret))

	next := WithAuth(func(w http.ResponseWriter, r *http.Request) {
		user := GetAuthenticatedUser(r)
		assert.NotNil(t, user)
		assert.Equal(t, 42, user.ID)
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+signed)
	rec := httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithAuth_RejectsMFAPendingToken(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)

	claims := jwt.MapClaims{
		"email":       "mfa@example.com",
		"sub":         "42",
		"mfa_pending": true,
		"exp":         time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	next := WithAuth(func(http.ResponseWriter, *http.Request) {
		t.Fatal("next should not run for MFA pending tokens")
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks", nil)
	req.Header.Set("Authorization", "Bearer "+signed)
	rec := httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestBuildAuthenticatedUserEdgeCases(t *testing.T) {
	user, err := BuildAuthenticatedUser(map[string]any{
		"email":   "string-id@example.com",
		"user_id": "42",
	})
	require.NoError(t, err)
	assert.Equal(t, 42, user.ID)

	_, err = BuildAuthenticatedUser(map[string]any{
		"email":  "bad-org@example.com",
		"sub":    float64(1),
		"org_id": float64(-1),
	})
	require.ErrorContains(t, err, "org ID out of range")

	_, err = BuildAuthenticatedUser(map[string]any{
		"email": "missing-id@example.com",
	})
	require.ErrorContains(t, err, "user ID not found")

	_, err = BuildAuthenticatedUser(map[string]any{
		"email": "overflow-id@example.com",
		"sub":   "4294967297",
	})
	assert.ErrorContains(t, err, "user ID not found")
}

func TestClaimUnixSecondsSupportsIntegerTypes(t *testing.T) {
	unix, ok := claimUnixSeconds(int64(1700000003))
	assert.True(t, ok)
	assert.Equal(t, int64(1700000003), unix)

	unix, ok = claimUnixSeconds(int(1700000004))
	assert.True(t, ok)
	assert.Equal(t, int64(1700000004), unix)
}

func TestWithAuth_ExistingUserPassthrough(t *testing.T) {
	existing := &auth.AuthenticatedUser{ID: 99, Email: "existing@example.com"}
	next := WithAuth(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, existing, GetAuthenticatedUser(r))
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), UserContextKey, existing))
	rec := httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithAuth_UnauthorizedPaths(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)

	t.Run("missing token", func(t *testing.T) {
		next := WithAuth(func(http.ResponseWriter, *http.Request) {
			t.Fatal("next should not run")
		})
		rec := httptest.NewRecorder()
		next(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("invalid token", func(t *testing.T) {
		next := WithAuth(func(http.ResponseWriter, *http.Request) {
			t.Fatal("next should not run")
		})
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer invalid")
		rec := httptest.NewRecorder()
		next(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("revoked token", func(t *testing.T) {
		claims := jwt.MapClaims{"sub": "1", "email": "a@b.com", "exp": time.Now().Add(time.Hour).Unix()}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		signed, err := token.SignedString([]byte(secret))
		require.NoError(t, err)

		original := IsTokenRevoked
		IsTokenRevoked = func(_ context.Context, rawToken string) bool {
			return rawToken == signed
		}
		t.Cleanup(func() { IsTokenRevoked = original })

		next := WithAuth(func(http.ResponseWriter, *http.Request) {
			t.Fatal("next should not run")
		})
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer "+signed)
		rec := httptest.NewRecorder()
		next(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})

	t.Run("build user failure", func(t *testing.T) {
		claims := jwt.MapClaims{"email": "a@b.com", "exp": time.Now().Add(time.Hour).Unix()}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		signed, err := token.SignedString([]byte(secret))
		require.NoError(t, err)

		next := WithAuth(func(http.ResponseWriter, *http.Request) {
			t.Fatal("next should not run")
		})
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer "+signed)
		rec := httptest.NewRecorder()
		next(rec, req)
		assert.Equal(t, http.StatusUnauthorized, rec.Code)
	})
}

func TestWithAuth_SetsOrgAndIssuedAtContext(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)

	claims := jwt.MapClaims{
		"sub":    "42",
		"email":  "user@example.com",
		"org_id": float64(7),
		"act_as": "admin-user-1",
		"iat":    float64(1700000005),
		"exp":    time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	next := WithAuth(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, 7, r.Context().Value(OrgIDContextKey))
		assert.Equal(t, int64(1700000005), r.Context().Value(TokenIssuedAtContextKey))
		user := GetAuthenticatedUser(r)
		if !assert.NotNil(t, user) {
			return
		}
		if !assert.NotNil(t, user.ExpiresAt) {
			return
		}
		assert.Equal(t, claims["exp"].(int64), user.ExpiresAt.Unix())
		if assert.NotNil(t, user.ImpersonatorID) {
			assert.Equal(t, "admin-user-1", *user.ImpersonatorID)
		}
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+signed)
	rec := httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithOptionalAuth_ExistingUserPassthrough(t *testing.T) {
	existing := &auth.AuthenticatedUser{ID: 12, Email: "existing@example.com"}
	next := WithOptionalAuth(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, existing, GetAuthenticatedUser(r))
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = req.WithContext(context.WithValue(req.Context(), UserContextKey, existing))
	rec := httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithOptionalAuth_NoTokenProceedsUnauthenticated(t *testing.T) {
	called := false
	next := WithOptionalAuth(func(_ http.ResponseWriter, r *http.Request) {
		called = true
		assert.Nil(t, GetAuthenticatedUser(r))
	})

	next(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	assert.True(t, called)
}

func TestWithOptionalAuth_RevokedTokenProceedsUnauthenticated(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)

	claims := jwt.MapClaims{"sub": "1", "email": "a@b.com", "exp": time.Now().Add(time.Hour).Unix()}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	original := IsTokenRevoked
	IsTokenRevoked = func(_ context.Context, rawToken string) bool {
		return rawToken == signed
	}
	t.Cleanup(func() { IsTokenRevoked = original })

	var seenUser *auth.AuthenticatedUser
	next := WithOptionalAuth(func(w http.ResponseWriter, r *http.Request) {
		seenUser = GetAuthenticatedUser(r)
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+signed)
	rec := httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Nil(t, seenUser)
}

func TestWithOptionalAuth_IgnoresMFAPendingToken(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)

	claims := jwt.MapClaims{
		"sub":         "1",
		"email":       "mfa@example.com",
		"mfa_pending": true,
		"exp":         time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	var seenUser *auth.AuthenticatedUser
	next := WithOptionalAuth(func(w http.ResponseWriter, r *http.Request) {
		seenUser = GetAuthenticatedUser(r)
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+signed)
	rec := httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Nil(t, seenUser)
}

func TestWithOptionalAuth_SetsOrgAndIssuedAtContext(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)

	claims := jwt.MapClaims{
		"sub":    "1",
		"email":  "a@b.com",
		"org_id": float64(9),
		"iat":    float64(1700000006),
		"exp":    time.Now().Add(time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	require.NoError(t, err)

	next := WithOptionalAuth(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, 9, r.Context().Value(OrgIDContextKey))
		assert.Equal(t, int64(1700000006), r.Context().Value(TokenIssuedAtContextKey))
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+signed)
	rec := httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWithOptionalAuth(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)

	var seenUser *auth.AuthenticatedUser
	next := WithOptionalAuth(func(w http.ResponseWriter, r *http.Request) {
		seenUser = GetAuthenticatedUser(r)
		w.WriteHeader(http.StatusNoContent)
	})

	// 1. Success
	claims := jwt.MapClaims{"sub": "1", "email": "a@b.com", "exp": time.Now().Add(time.Hour).Unix()}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString([]byte(secret))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+signed)
	rec := httptest.NewRecorder()
	next(rec, req)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.NotNil(t, seenUser)
	assert.Equal(t, 1, seenUser.ID)
	assert.Empty(t, rec.Header().Get("X-TaskForce-Auth-Status"))
	assert.Empty(t, rec.Header().Get("X-TaskForce-User-ID"))

	// 2. Validation Failed
	seenUser = nil
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set("Authorization", "Bearer invalid")
	rec2 := httptest.NewRecorder()
	next(rec2, req2)
	assert.Equal(t, http.StatusNoContent, rec2.Code)
	assert.Nil(t, seenUser)
	assert.Empty(t, rec2.Header().Get("X-TaskForce-Auth-Status"))

	// 3. Build User Failed (valid token without user ID claim)
	seenUser = nil
	claimsMissingID := jwt.MapClaims{"email": "a@b.com", "exp": time.Now().Add(time.Hour).Unix()}
	tokenMissingID := jwt.NewWithClaims(jwt.SigningMethodHS256, claimsMissingID)
	signedMissingID, _ := tokenMissingID.SignedString([]byte(secret))
	req3 := httptest.NewRequest(http.MethodGet, "/", nil)
	req3.Header.Set("Authorization", "Bearer "+signedMissingID)
	rec3 := httptest.NewRecorder()
	next(rec3, req3)
	assert.Equal(t, http.StatusNoContent, rec3.Code)
	assert.Nil(t, seenUser)
	assert.Empty(t, rec3.Header().Get("X-TaskForce-Auth-Status"))
}
