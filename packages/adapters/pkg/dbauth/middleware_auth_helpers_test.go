package dbauth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type authMiddlewareKind string

const (
	authMiddlewareFlexible authMiddlewareKind = "flexible"
	authMiddlewareOptional authMiddlewareKind = "optional"
	authMiddlewareRequired authMiddlewareKind = "required"
)

func wrapAuthMiddleware(kind authMiddlewareKind, q *Queries, next http.HandlerFunc) http.HandlerFunc {
	switch kind {
	case authMiddlewareFlexible:
		return WithFlexibleAuth(q, next)
	case authMiddlewareOptional:
		return WithOptionalDBAuth(q, next)
	case authMiddlewareRequired:
		return WithAuthDB(q, next)
	default:
		panic("unknown auth middleware kind: " + kind)
	}
}

func newBearerRequest(token string) (*http.Request, *httptest.ResponseRecorder) {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	return req, httptest.NewRecorder()
}

func runProceedsUnauthenticated(t *testing.T, kind authMiddlewareKind, q *Queries, configureReq func(*http.Request)) {
	t.Helper()

	called := false
	middleware := wrapAuthMiddleware(kind, q, func(w http.ResponseWriter, r *http.Request) {
		called = true
		assert.Nil(t, handler.GetAuthenticatedUser(r))
		assert.Nil(t, r.Context().Value(handler.UserIDContextKey))
		assert.Nil(t, r.Context().Value(handler.EmailContextKey))
		assert.Nil(t, r.Context().Value(handler.AuthMethodContextKey))
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	if configureReq != nil {
		configureReq(req)
	}
	rec := httptest.NewRecorder()

	middleware(rec, req)

	require.True(t, called)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func runRejectsRequest(t *testing.T, kind authMiddlewareKind, q *Queries, wantCode int, configureReq func(*http.Request)) {
	t.Helper()

	called := false
	middleware := wrapAuthMiddleware(kind, q, func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	if configureReq != nil {
		configureReq(req)
	}
	rec := httptest.NewRecorder()

	middleware(rec, req)

	assert.False(t, called, "next handler must not run")
	assert.Equal(t, wantCode, rec.Code)
}

func TestAuthMiddlewareSharedUnauthenticatedPaths(t *testing.T) {
	kinds := []authMiddlewareKind{authMiddlewareFlexible, authMiddlewareOptional}

	for _, kind := range kinds {
		t.Run(string(kind)+"/invalid token", func(t *testing.T) {
			runProceedsUnauthenticated(t, kind, New(newMiddlewareFakeDB()), func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer invalid-token")
			})
		})

		t.Run(string(kind)+"/user not found", func(t *testing.T) {
			email := string(kind) + "-missing@example.com"
			token := mustSignToken(t, jwt.MapClaims{"email": email, "sub": "77"})
			runProceedsUnauthenticated(t, kind, New(newMiddlewareFakeDB()), func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer "+token)
			})
		})

		t.Run(string(kind)+"/revoked token", func(t *testing.T) {
			email := string(kind) + "-revoked@example.com"
			token := mustSignToken(t, jwt.MapClaims{"email": email, "sub": "44"})

			originalRevocationCheck := handler.IsTokenRevoked
			handler.IsTokenRevoked = func(_ context.Context, rawToken string) bool {
				return rawToken == token
			}
			t.Cleanup(func() {
				handler.IsTokenRevoked = originalRevocationCheck
			})

			runProceedsUnauthenticated(t, kind, New(newMiddlewareFakeDB()), func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer "+token)
			})
		})

		t.Run(string(kind)+"/MFA pending", func(t *testing.T) {
			token := mustSignToken(t, jwt.MapClaims{
				"email": "mfa-pending@example.com", "sub": "55", "mfa_pending": true,
			})
			runProceedsUnauthenticated(t, kind, New(newMiddlewareFakeDB()), func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer "+token)
			})
		})
	}

	t.Run("flexible/build user failure", func(t *testing.T) {
		token := mustSignToken(t, jwt.MapClaims{"email": "flex-build-fail@example.com"})
		runProceedsUnauthenticated(t, authMiddlewareFlexible, New(newMiddlewareFakeDB()), func(req *http.Request) {
			req.Header.Set("Authorization", "Bearer "+token)
		})
	})

	t.Run("optional/build user failure", func(t *testing.T) {
		token := mustSignToken(t, jwt.MapClaims{"sub": "55"})
		runProceedsUnauthenticated(t, authMiddlewareOptional, New(newMiddlewareFakeDB()), func(req *http.Request) {
			req.Header.Set("Authorization", "Bearer "+token)
		})
	})

	for _, kind := range kinds {
		t.Run(string(kind)+"/invalid org header", func(t *testing.T) {
			email := string(kind) + "-org-scope@example.com"
			token := mustSignToken(t, jwt.MapClaims{
				"email":  email,
				"sub":    "55",
				"org_id": float64(5),
			})

			fakeDB := newMiddlewareFakeDB()
			fakeDB.usersByEmail[email] = User{ID: 55, Email: email, Plan: "pro"}

			runRejectsRequest(t, kind, New(fakeDB), http.StatusForbidden, func(req *http.Request) {
				req.Header.Set("Authorization", "Bearer "+token)
				req.Header.Set("X-Org-ID", "999")
			})
		})
	}

	t.Run("optional/no token", func(t *testing.T) {
		runProceedsUnauthenticated(t, authMiddlewareOptional, New(newMiddlewareFakeDB()), nil)
	})

	t.Run("optional/empty email", func(t *testing.T) {
		token := mustSignToken(t, jwt.MapClaims{"sub": "56", "email": "   "})
		runProceedsUnauthenticated(t, authMiddlewareOptional, New(newMiddlewareFakeDB()), func(req *http.Request) {
			req.Header.Set("Authorization", "Bearer "+token)
		})
	})

	t.Run("optional/disabled user", func(t *testing.T) {
		email := "optional-db-disabled@example.com"
		token := mustSignToken(t, jwt.MapClaims{"email": email, "sub": "188"})

		fakeDB := newMiddlewareFakeDB()
		fakeDB.usersByEmail[email] = User{ID: 188, Email: email, Disabled: true}

		runProceedsUnauthenticated(t, authMiddlewareOptional, New(fakeDB), func(req *http.Request) {
			req.Header.Set("Authorization", "Bearer "+token)
		})
	})
}
