package token

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
)

func setupTokenAPI(user *adapterauth.AuthenticatedUser, queries ...*db.Queries) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	var q *db.Queries
	if len(queries) > 0 {
		q = queries[0]
	}
	RegisterHandlersWithResolver(api, func(context.Context) (*db.Queries, error) {
		if q == nil {
			return nil, errors.New("membership store unavailable")
		}
		return q, nil
	})
	return r
}

func setupTokenAPIWithResolver(user *adapterauth.AuthenticatedUser, resolve QueryResolver) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test", "1.0"))
	RegisterHandlersWithResolver(api, resolve)
	return r
}

func TestTokenHandler_Unauthorized(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	r := setupTokenAPI(nil) // no user set in context
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/realtime/token", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestTokenHandler_EmptyEmailUnauthorized(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	r := setupTokenAPI(&adapterauth.AuthenticatedUser{})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/realtime/token", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Result().StatusCode)
}

func TestTokenHandler_MissingSecret(t *testing.T) {
	_ = os.Unsetenv("AUTH_SECRET")
	r := setupTokenAPI(&adapterauth.AuthenticatedUser{Email: "user@example.com"})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/realtime/token", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusInternalServerError, w.Result().StatusCode)
}

func TestTokenHandler_Success(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	r := setupTokenAPI(&adapterauth.AuthenticatedUser{Email: "user@example.com"})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/realtime/token", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
}

func TestTokenHandler_SigningError(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	originalSign := signSyncJWT
	signSyncJWT = func(token *jwt.Token, secret []byte) (string, error) {
		return "", errors.New("sign failed")
	}
	t.Cleanup(func() { signSyncJWT = originalSign })

	r := setupTokenAPI(&adapterauth.AuthenticatedUser{Email: "user@example.com"})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/realtime/token", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Result().StatusCode)
}

func TestTokenHandler_OrgScopedRequest_RequiresMembershipStore(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	r := setupTokenAPI(&adapterauth.AuthenticatedUser{ID: 123, Email: "user@example.com"})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/sync/realtime/token",
		bytes.NewBufferString(`{"organizationId":7}`),
	)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusServiceUnavailable, w.Result().StatusCode)
}

func TestTokenHandler_OrgScopedRequest_RejectsInvalidUserID(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")

	for _, user := range []*adapterauth.AuthenticatedUser{
		{ID: 0, Email: "user@example.com"},
		{ID: int(^uint32(0)) + 1, Email: "user@example.com"},
	} {
		r := setupTokenAPI(user, db.New(nil))
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/realtime/token", bytes.NewBufferString(`{"organizationId":7}`))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(w, req)
		assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
	}
}

func TestTokenHandler_OrgScopedRequest_MembershipRejected(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	mockPool := dbtest.NewMockPoolRegexp(t)
	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(7), int32(123)).
		WillReturnError(assert.AnError)

	r := setupTokenAPI(&adapterauth.AuthenticatedUser{ID: 123, Email: "user@example.com"}, db.New(mockPool))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/realtime/token", bytes.NewBufferString(`{"organizationId":7}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Result().StatusCode)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestTokenHandler_OrgScopedRequest_SuccessIncludesToken(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	mockPool := dbtest.NewMockPoolRegexp(t)
	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(7), int32(123)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(1), int32(7), int32(123), "member", nil, nil))

	r := setupTokenAPI(&adapterauth.AuthenticatedUser{ID: 123, Email: "user@example.com"}, db.New(mockPool))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/realtime/token", bytes.NewBufferString(`{"organizationId":7}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	assert.Contains(t, w.Body.String(), "token")
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestTokenHandler_OrgScopedRequest_UsesLazyQueryResolver(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-32-characters-long!!")
	mockPool := dbtest.NewMockPoolRegexp(t)
	mockPool.ExpectQuery("SELECT (.+) FROM memberships").
		WithArgs(int32(7), int32(123)).
		WillReturnRows(pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(1), int32(7), int32(123), "member", nil, nil))

	calls := 0
	r := setupTokenAPIWithResolver(&adapterauth.AuthenticatedUser{ID: 123, Email: "user@example.com"}, func(context.Context) (*db.Queries, error) {
		calls++
		return db.New(mockPool), nil
	})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sync/realtime/token", bytes.NewBufferString(`{"organizationId":7}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	assert.Equal(t, 1, calls)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}
