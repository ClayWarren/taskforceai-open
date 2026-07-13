//go:build !production

package auth

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
)

func withQueriesOverride(t *testing.T, fn func(ctx context.Context) (*db.Queries, error)) {
	t.Helper()
	authhandler.SetQueriesOverride(fn)
	t.Cleanup(func() { authhandler.SetQueriesOverride(nil) })
}

// installTestLoginMock points the handler's query getter at a fresh regexp mock pool.
func installTestLoginMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock := dbtest.NewMockPoolRegexp(t)
	withQueriesOverride(t, func(context.Context) (*db.Queries, error) { return db.New(mock), nil })
	return mock
}

// testLoginUserRow returns a users row for the GetUserByEmail mock.
func testLoginUserRow(email string, fullName *string) *pgxmock.Rows {
	return dbtest.UserRow(dbtest.User{ID: 1, Email: email, FullName: fullName, Theme: "system"})
}

func testLoginPOST(body string) *http.Request {
	return httptest.NewRequest(http.MethodPost, "/api/v1/auth/test-login", bytes.NewBufferString(body))
}

func TestTestLoginHandler_DebugEnabled(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")

	// Missing secret should still fail, but must NOT be forbidden (hits the ENABLED branch).
	rr := httptest.NewRecorder()
	TestLoginHandler(rr, testLoginPOST(`{"email":"test@example.com"}`))
	assert.NotEqual(t, http.StatusForbidden, rr.Code)
}

func TestTestLoginHandler_ErrorsExtra(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	t.Setenv("AUTH_SECRET", "s")

	tests := []struct {
		name       string
		req        *http.Request
		wantStatus int
	}{
		{"MethodNotAllowed", httptest.NewRequest(http.MethodGet, "/", nil), http.StatusMethodNotAllowed},
		{"InvalidJSON", testLoginPOST("{invalid"), http.StatusBadRequest},
		{"NoDB", testLoginPOST(`{"email":"t@e.com"}`), http.StatusServiceUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			withQueriesOverride(t, func(context.Context) (*db.Queries, error) { return nil, assert.AnError })
			rr := httptest.NewRecorder()
			TestLoginHandler(rr, tt.req)
			assert.Equal(t, tt.wantStatus, rr.Code)
		})
	}
}

func TestTestLoginHandler_Forbidden(t *testing.T) {
	t.Setenv("GO_ENV", "")
	t.Setenv("DEBUG", "")

	rr := httptest.NewRecorder()
	TestLoginHandler(rr, httptest.NewRequest(http.MethodPost, "/api/v1/auth/test-login", nil))
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestTestLoginHandler_MissingSecretAfterUserLookup(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	t.Setenv("AUTH_SECRET", "")

	mock := installTestLoginMock(t)
	mock.ExpectQuery("(?s).*FROM users WHERE email").
		WithArgs("user@example.com").
		WillReturnRows(testLoginUserRow("user@example.com", nil))

	rr := httptest.NewRecorder()
	TestLoginHandler(rr, testLoginPOST(`{"email":"user@example.com"}`))
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestTestLoginHandler_NoSecret(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	t.Setenv("AUTH_SECRET", "")

	fullName := "Test User"
	mock := installTestLoginMock(t)
	mock.ExpectQuery("(?s).*FROM users WHERE email = \\$1.*").
		WithArgs("test@example.com").
		WillReturnRows(testLoginUserRow("test@example.com", &fullName))

	rr := httptest.NewRecorder()
	TestLoginHandler(rr, testLoginPOST(`{"email":"test@example.com"}`))
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestTestLoginHandler_ForbiddenInProductionEvenWhenEnabled(t *testing.T) {
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	t.Setenv("GO_ENV", "production")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")

	rr := httptest.NewRecorder()
	TestLoginHandler(rr, testLoginPOST(`{"email":"prod@example.com"}`))
	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestTestLoginHandler_Success(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")

	fullName := "Test User"
	mock := installTestLoginMock(t)
	mock.ExpectQuery("(?s).*FROM users WHERE email = \\$1.*").
		WithArgs("test@example.com").
		WillReturnRows(testLoginUserRow("test@example.com", &fullName))

	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	auditColumns := []string{
		"id", "timestamp", "user_id", "organization_id", "action", "resource",
		"resource_id", "ip_address", "user_agent", "details", "success", "error_message",
	}
	mock.ExpectQuery("(?s).*INSERT INTO audit_logs.*RETURNING.*").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(auditColumns).AddRow(
			int32(1), ts, "1", nil, "LOGIN", "user", nil, nil, nil, nil, true, nil))

	rr := httptest.NewRecorder()
	TestLoginHandler(rr, testLoginPOST(`{"email":"test@example.com"}`))
	assert.Equal(t, http.StatusOK, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestTestLoginHandler_CreatesMissingLocalUser(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")

	mock := installTestLoginMock(t)
	mock.ExpectQuery("(?s).*FROM users WHERE email = \\$1.*").
		WithArgs("missing@example.com").
		WillReturnError(pgx.ErrNoRows)
	mock.ExpectQuery("(?s).*INSERT INTO users.*").
		WithArgs("missing@example.com", pgxmock.AnyArg(), "super").
		WillReturnRows(testLoginUserRow("missing@example.com", nil))
	mock.ExpectQuery("(?s).*FROM users WHERE email = \\$1.*").
		WithArgs("missing@example.com").
		WillReturnRows(testLoginUserRow("missing@example.com", nil))

	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	auditColumns := []string{
		"id", "timestamp", "user_id", "organization_id", "action", "resource",
		"resource_id", "ip_address", "user_agent", "details", "success", "error_message",
	}
	mock.ExpectQuery("(?s).*INSERT INTO audit_logs.*RETURNING.*").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(auditColumns).AddRow(
			int32(1), ts, "1", nil, "LOGIN", "user", nil, nil, nil, nil, true, nil))

	rr := httptest.NewRecorder()
	TestLoginHandler(rr, testLoginPOST(`{"email":"missing@example.com"}`))
	assert.Equal(t, http.StatusOK, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestTestLoginHandler_CreateLocalUserFailure(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")

	mock := installTestLoginMock(t)
	mock.ExpectQuery("(?s).*FROM users WHERE email").
		WithArgs("missing@example.com").
		WillReturnRows(pgxmock.NewRows([]string{"id"}))
	mock.ExpectQuery("(?s).*INSERT INTO users.*").
		WithArgs("missing@example.com", pgxmock.AnyArg(), "super").
		WillReturnError(errors.New("create failed"))

	rr := httptest.NewRecorder()
	TestLoginHandler(rr, testLoginPOST(`{"email":"missing@example.com"}`))
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestTestLoginHandler_UserResolveInternalError(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")

	mock := installTestLoginMock(t)
	mock.ExpectQuery("(?s).*FROM users WHERE email").
		WithArgs("broken@example.com").
		WillReturnError(errors.New("db read failed"))

	rr := httptest.NewRecorder()
	TestLoginHandler(rr, testLoginPOST(`{"email":"broken@example.com"}`))
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestTestLoginHandler_UsesQueriesOverride(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")
	withQueriesOverride(t, func(context.Context) (*db.Queries, error) { return nil, assert.AnError })

	rr := httptest.NewRecorder()
	TestLoginHandler(rr, testLoginPOST(`{"email":"user@example.com"}`))
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestTestLoginBranches(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/auth/test-login", nil)
	TestLoginHandler(rr, req)
	assert.Equal(t, http.StatusNoContent, rr.Code)

	mock := dbtest.NewMockPoolRegexp(t)
	q := db.New(mock)
	repo := &testLoginRepo{}
	user, ok := resolveTestLoginUser(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", nil), q, repo, "new@example.com")
	assert.False(t, ok)
	assert.Nil(t, user)

	rr = httptest.NewRecorder()
	repo = &testLoginRepo{err: pgx.ErrNoRows}
	user, ok = resolveTestLoginUser(rr, httptest.NewRequest(http.MethodPost, "/", nil), q, repo, "missing@example.com")
	assert.False(t, ok)
	assert.Nil(t, user)
	assert.Equal(t, http.StatusNotFound, rr.Code)

	mock.ExpectQuery("(?s).*INSERT INTO users.*").
		WithArgs("created@example.com", pgxmock.AnyArg(), "super").
		WillReturnRows(testLoginUserRow("created@example.com", nil))
	repo = &testLoginRepo{}
	user, ok = createTestLoginUser(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", nil), q, repo, "created@example.com")
	assert.False(t, ok)
	assert.Nil(t, user)
	assert.NoError(t, mock.ExpectationsWereMet())
}

type testLoginRepo struct {
	user *authpkg.AuthUser
	err  error
}

func (r *testLoginRepo) FindByEmail(context.Context, string) (*authpkg.AuthUser, error) {
	return r.user, r.err
}

func (r *testLoginRepo) FindByID(context.Context, int) (*authpkg.AuthUser, error) {
	return nil, nil
}
