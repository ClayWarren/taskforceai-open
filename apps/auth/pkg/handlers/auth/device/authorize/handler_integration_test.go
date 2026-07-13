package authorize

import (
	"context"
	"errors"
	"github.com/TaskForceAI/adapters/pkg/dbauth"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func authUserRow(id int32, email string) *pgxmock.Rows {
	return dbtest.UserRow(dbtest.User{ID: id, Email: email})
}

func testAuthSecret() string {
	return strings.Join([]string{"test", "secret", "32", "characters", "long!!"}, "-")
}

func pendingDeviceLoginRow(now time.Time) *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "device_code", "user_code", "status", "user_id", "poll_interval", "created_at",
		"expires_at", "authorized_at", "completed_at", "last_polled_at",
	}).AddRow(
		int32(1), "device-code", "ABCD-1234", "PENDING", nil, int32(5),
		pgtype.Timestamp{Time: now, Valid: true},
		pgtype.Timestamp{Time: now.Add(time.Hour), Valid: true},
		pgtype.Timestamp{}, pgtype.Timestamp{}, pgtype.Timestamp{},
	)
}

func TestAuthorizeRoute_AuthorizeSuccess(t *testing.T) {
	secret := testAuthSecret()
	t.Setenv("AUTH_SECRET", secret)

	mock := dbtest.NewMockPoolRegexp(t)

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	email := "user@example.com"
	now := time.Now()
	mock.ExpectQuery("SELECT (.+) FROM users WHERE email").
		WithArgs(email).
		WillReturnRows(authUserRow(1, email))
	mock.ExpectQuery("SELECT (.+) FROM device_logins").
		WithArgs("ABCD-1234").
		WillReturnRows(pendingDeviceLoginRow(now))
	mock.ExpectExec("UPDATE device_logins").
		WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "1", "email": email, "exp": now.Add(time.Hour).Unix(),
	})
	tokenString, signErr := token.SignedString([]byte(secret))
	require.NoError(t, signErr)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/authorize", strings.NewReader(`{"user_code":"ABCD-1234"}`))
	req.AddCookie(&http.Cookie{Name: "session_token", Value: tokenString})
	req = addValidCSRF(req)
	rr := httptest.NewRecorder()

	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return dbauth.WithAuthDB(db.New(mock), next.ServeHTTP)
	})
	api := humachi.New(router, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandler(api)
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestAuthorizeRoute_RegisterHandler_DBUnavailable(t *testing.T) {
	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db down")
	})
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })

	router := chi.NewRouter()
	router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{ID: 1})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	})
	api := humachi.New(router, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandler(api)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/device/authorize", strings.NewReader(`{"user_code":"ABCD-1234"}`))
	req.Header.Set("Content-Type", "application/json")
	req = addValidCSRF(req)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}
