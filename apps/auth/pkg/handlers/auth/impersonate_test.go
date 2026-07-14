package auth

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
)

const (
	impersonateAdmin     = "admin@example.com"
	impersonateTarget    = "target@example.com"
	impersonateUserQuery = "SELECT (.+) FROM users WHERE email"
)

// impersonateUserRow builds a users row for the GetUserByEmail mock.
// Shared with the sibling impersonate_encode_test.go file.
func impersonateUserRow(id int32, email string, isAdmin bool) *pgxmock.Rows {
	return impersonateUserRowWithName(id, email, isAdmin, nil)
}

func impersonateUserRowWithName(id int32, email string, isAdmin bool, fullName *string) *pgxmock.Rows {
	return dbtest.UserRow(dbtest.User{ID: id, Email: email, IsAdmin: isAdmin, FullName: fullName})
}

func impersonateUserRowWithState(id int32, email string, isAdmin bool, disabled bool) *pgxmock.Rows {
	return dbtest.UserRow(dbtest.User{ID: id, Email: email, IsAdmin: isAdmin, Disabled: disabled})
}

// installImpersonateMock points the handler's query getter at a fresh mock pool.
func installImpersonateMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock := dbtest.NewMockPool(t)
	handler.SetQueriesOverride(func(context.Context) (*db.Queries, error) { return db.New(mock), nil })
	t.Cleanup(func() { handler.SetQueriesOverride(nil) })
	return mock
}

// impersonatePOST builds a POST request, attaching an authenticated actor when
// actorEmail is non-empty.
func impersonatePOST(actorEmail, body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/impersonate", bytes.NewBufferString(body))
	if actorEmail != "" {
		req = impersonatePOSTWithIssuedAt(actorEmail, body, time.Now().Unix())
	}
	return req
}

func impersonatePOSTWithIssuedAt(actorEmail, body string, issuedAt int64) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/impersonate", bytes.NewBufferString(body))
	if actorEmail == "" {
		return req
	}
	ctx := context.WithValue(req.Context(),
		adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{ID: 1, Email: actorEmail})
	ctx = context.WithValue(ctx, adapterhandler.TokenIssuedAtContextKey, issuedAt)
	return req.WithContext(ctx)
}

func impersonatePOSTWithoutIssuedAt(actorEmail, body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/impersonate", bytes.NewBufferString(body))
	if actorEmail == "" {
		return req
	}
	return req.WithContext(context.WithValue(req.Context(),
		adapterhandler.UserContextKey, &adapterauth.AuthenticatedUser{ID: 1, Email: actorEmail}))
}

// expectAdminLookup queues the admin GetUserByEmail call used by request-body
// and target-lookup tests.
func expectAdminLookup(mock pgxmock.PgxPoolIface, isAdmin bool) {
	mock.ExpectQuery(impersonateUserQuery).WithArgs(impersonateAdmin).
		WillReturnRows(impersonateUserRow(1, impersonateAdmin, isAdmin))
}

// TestImpersonateHandler_Rejections covers every non-success exit of the real
// handler. Each case drives the production ImpersonateHandler directly.
func TestImpersonateHandler_Rejections(t *testing.T) {
	tests := []struct {
		name  string
		req   *http.Request
		setup func(mock pgxmock.PgxPoolIface)
		want  int
	}{
		{
			name: "method not allowed",
			req:  httptest.NewRequest(http.MethodGet, "/api/v1/auth/impersonate", nil),
			want: http.StatusMethodNotAllowed,
		},
		{
			name: "unauthenticated actor",
			req:  impersonatePOST("", "{}"),
			want: http.StatusUnauthorized,
		},
		{
			name: "admin lookup fails",
			req:  impersonatePOST(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`),
			setup: func(mock pgxmock.PgxPoolIface) {
				mock.ExpectQuery(impersonateUserQuery).WithArgs(impersonateAdmin).
					WillReturnError(errors.New("db down"))
			},
			want: http.StatusInternalServerError,
		},
		{
			name:  "actor not admin",
			req:   impersonatePOST(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`),
			setup: func(mock pgxmock.PgxPoolIface) { expectAdminLookup(mock, false) },
			want:  http.StatusForbidden,
		},
		{
			name: "actor disabled",
			req:  impersonatePOST(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`),
			setup: func(mock pgxmock.PgxPoolIface) {
				mock.ExpectQuery(impersonateUserQuery).WithArgs(impersonateAdmin).
					WillReturnRows(impersonateUserRowWithState(1, impersonateAdmin, true, true))
			},
			want: http.StatusForbidden,
		},
		{
			name:  "missing recent admin authentication",
			req:   impersonatePOSTWithoutIssuedAt(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`),
			setup: func(mock pgxmock.PgxPoolIface) { expectAdminLookup(mock, true) },
			want:  http.StatusForbidden,
		},
		{
			name:  "stale admin authentication",
			req:   impersonatePOSTWithIssuedAt(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`, time.Now().Add(-31*time.Minute).Unix()),
			setup: func(mock pgxmock.PgxPoolIface) { expectAdminLookup(mock, true) },
			want:  http.StatusForbidden,
		},
		{
			name:  "future admin authentication",
			req:   impersonatePOSTWithIssuedAt(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`, time.Now().Add(3*time.Minute).Unix()),
			setup: func(mock pgxmock.PgxPoolIface) { expectAdminLookup(mock, true) },
			want:  http.StatusForbidden,
		},
		{
			name:  "invalid json body",
			req:   impersonatePOST(impersonateAdmin, "{bad"),
			setup: func(mock pgxmock.PgxPoolIface) { expectAdminLookup(mock, true) },
			want:  http.StatusBadRequest,
		},
		{
			name:  "missing email",
			req:   impersonatePOST(impersonateAdmin, `{"email":""}`),
			setup: func(mock pgxmock.PgxPoolIface) { expectAdminLookup(mock, true) },
			want:  http.StatusBadRequest,
		},
		{
			name: "target not found",
			req:  impersonatePOST(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`),
			setup: func(mock pgxmock.PgxPoolIface) {
				expectAdminLookup(mock, true)
				mock.ExpectQuery(impersonateUserQuery).WithArgs(impersonateTarget).
					WillReturnError(pgx.ErrNoRows)
			},
			want: http.StatusNotFound,
		},
		{
			name: "target lookup fails",
			req:  impersonatePOST(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`),
			setup: func(mock pgxmock.PgxPoolIface) {
				expectAdminLookup(mock, true)
				mock.ExpectQuery(impersonateUserQuery).WithArgs(impersonateTarget).
					WillReturnError(errors.New("db read failed"))
			},
			want: http.StatusInternalServerError,
		},
		{
			name: "target is admin",
			req:  impersonatePOST(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`),
			setup: func(mock pgxmock.PgxPoolIface) {
				expectAdminLookup(mock, true)
				mock.ExpectQuery(impersonateUserQuery).WithArgs(impersonateTarget).
					WillReturnRows(impersonateUserRowWithState(2, impersonateTarget, true, false))
			},
			want: http.StatusForbidden,
		},
		{
			name: "target is disabled",
			req:  impersonatePOST(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`),
			setup: func(mock pgxmock.PgxPoolIface) {
				expectAdminLookup(mock, true)
				mock.ExpectQuery(impersonateUserQuery).WithArgs(impersonateTarget).
					WillReturnRows(impersonateUserRowWithState(2, impersonateTarget, false, true))
			},
			want: http.StatusForbidden,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			mock := installImpersonateMock(t)
			if tc.setup != nil {
				tc.setup(mock)
			}
			rr := httptest.NewRecorder()
			ImpersonateHandler(rr, tc.req)
			assert.Equal(t, tc.want, rr.Code)
			assert.NoError(t, mock.ExpectationsWereMet())
		})
	}
}

// TestImpersonateHandler_RevokedToken rejects a request whose bearer token was
// revoked after the auth context was established.
func TestImpersonateHandler_RevokedToken(t *testing.T) {
	original := adapterhandler.IsTokenRevoked
	adapterhandler.IsTokenRevoked = func(context.Context, string) bool { return true }
	t.Cleanup(func() { adapterhandler.IsTokenRevoked = original })

	req := impersonatePOST(impersonateAdmin, "")
	req.Header.Set("Authorization", "Bearer revoked-token")
	rr := httptest.NewRecorder()
	ImpersonateHandler(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

// TestImpersonateHandler_QueriesUnavailable returns 503 when the database is
// unreachable.
func TestImpersonateHandler_QueriesUnavailable(t *testing.T) {
	handler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return nil, errors.New("db unavailable")
	})
	t.Cleanup(func() { handler.SetQueriesOverride(nil) })

	rr := httptest.NewRecorder()
	ImpersonateHandler(rr, impersonatePOST(impersonateAdmin, ""))
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

// TestImpersonateHandler_EncodeFailure returns 500 when token encoding fails
// (empty AUTH_SECRET).
func TestImpersonateHandler_EncodeFailure(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	mock := installImpersonateMock(t)
	expectAdminLookup(mock, true)
	mock.ExpectQuery(impersonateUserQuery).WithArgs(impersonateTarget).
		WillReturnRows(impersonateUserRow(2, impersonateTarget, false))

	rr := httptest.NewRecorder()
	ImpersonateHandler(rr, impersonatePOST(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`))
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// TestImpersonateHandler_Success issues an impersonation token for a valid admin
// and target, exercising the full happy path including the target's full name.
func TestImpersonateHandler_Success(t *testing.T) {
	t.Setenv("AUTH_SECRET", "test-secret-value-that-is-long-enough")
	targetName := "Target"
	mock := installImpersonateMock(t)
	expectAdminLookup(mock, true)
	mock.ExpectQuery(impersonateUserQuery).WithArgs(impersonateTarget).
		WillReturnRows(impersonateUserRowWithName(2, impersonateTarget, false, &targetName))
	mock.ExpectQuery("INSERT INTO audit_logs").
		WithArgs(stringPtr("1"), pgxmock.AnyArg(), "IMPERSONATION_START", "user", stringPtr("2"), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), true, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows(dbtest.AuditLogColumns()).
			AddRow(int32(7), pgtype.Timestamp{Time: time.Now(), Valid: true}, "1", nil, "IMPERSONATION_START", "user", "2", nil, nil, []byte("{}"), true, nil))

	rr := httptest.NewRecorder()
	ImpersonateHandler(rr, impersonatePOST(impersonateAdmin, `{"email":"`+impersonateTarget+`"}`))

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), "Now impersonating "+impersonateTarget)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func stringPtr(value string) *string {
	return &value
}
