package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	authpkg "github.com/TaskForceAI/auth-service/pkg/auth"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
)

type tokenRevokerStub struct {
	called bool
}

func (s *tokenRevokerStub) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	s.called = true
	return nil
}

func (s *tokenRevokerStub) Get(ctx context.Context, key string) (string, error) {
	return "", nil
}

func TestLogoutHandler(t *testing.T) {
	// 1. Success
	req := httptest.NewRequest(http.MethodPost, "/logout", nil)
	w := httptest.NewRecorder()
	LogoutHandler(w, req)
	if w.Result().StatusCode != http.StatusOK {
		t.Error("expected 200")
	}

	// 2. Custom Callback
	req = httptest.NewRequest(http.MethodPost, "/logout", strings.NewReader("callbackUrl=/custom"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w = httptest.NewRecorder()
	LogoutHandler(w, req)
	if !strings.Contains(w.Body.String(), "/custom") {
		t.Error("expected custom callback in response")
	}
}

func TestLogoutHandler_MethodNotAllowed(t *testing.T) {
	testCases := []string{http.MethodPut, http.MethodGet}
	for _, method := range testCases {
		req := httptest.NewRequest(method, "/logout", nil)
		w := httptest.NewRecorder()
		LogoutHandler(w, req)
		assert.Equal(t, http.StatusMethodNotAllowed, w.Code)
	}
}

func TestLogoutHandler_AuditLog(t *testing.T) {
	mock := dbtest.NewMockPoolRegexp(t)

	original := getQueries
	getQueries = func(ctx context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	}
	defer func() { getQueries = original }()

	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	mock.ExpectQuery("(?s).*INSERT INTO audit_logs.*RETURNING.*").
		WithArgs(
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
		).
		WillReturnRows(pgxmock.NewRows([]string{
			"id",
			"timestamp",
			"user_id",
			"organization_id",
			"action",
			"resource",
			"resource_id",
			"ip_address",
			"user_agent",
			"details",
			"success",
			"error_message",
		}).AddRow(int32(1), ts, nil, nil, "LOGOUT", "user", nil, nil, nil, []byte("{}"), true, nil))

	req := httptest.NewRequest(http.MethodPost, "/logout", nil)
	ctx := context.WithValue(req.Context(), adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{ID: 1, Email: "user@example.com"})
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()

	LogoutHandler(w, req)

	assert.Equal(t, http.StatusOK, w.Result().StatusCode)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRevokeTokenOnLogout(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")

	// Create a valid token
	user := authpkg.SessionUser{ID: "1", Email: "test@example.com"}
	token, _ := authpkg.EncodeSessionToken(user, os.Getenv("AUTH_SECRET"), 3600)

	// Stub revoker
	stub := &tokenRevokerStub{}

	original := getTokenRevoker
	getTokenRevoker = func() adapterauth.TokenRevoker { return stub }
	defer func() { getTokenRevoker = original }()

	revokeTokenOnLogout(context.Background(), token)

	assert.True(t, stub.called)
}
