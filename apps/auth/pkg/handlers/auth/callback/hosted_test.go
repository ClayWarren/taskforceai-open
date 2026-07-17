package callback_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	provider_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/providers"
	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	auth_handler "github.com/TaskForceAI/auth-service/pkg/handlers/auth/callback"
	stateutil "github.com/TaskForceAI/auth-service/pkg/handlers/auth/state"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
)

func TestHostedHandler_MethodNotAllowed(t *testing.T) {
	h := &auth_handler.HostedHandlerStruct{WorkOS: new(provider_mocks.WorkOSProvider)}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/callback", nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusMethodNotAllowed, rr.Code)
}

func TestHostedHandler_MissingCode(t *testing.T) {
	h := &auth_handler.HostedHandlerStruct{WorkOS: new(provider_mocks.WorkOSProvider)}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "abc"})
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestHostedHandler_InvalidState(t *testing.T) {
	h := &auth_handler.HostedHandlerStruct{WorkOS: new(provider_mocks.WorkOSProvider)}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1", nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestHostedHandler_AuthFailure(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{}, errors.New("fail"))

	h := &auth_handler.HostedHandlerStruct{
		WorkOS: mockWorkOS,
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "abc"})
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestHostedHandler_AuthFailure_AuditLogged(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{}, errors.New("fail"))

	mockAudit := new(auth_mocks.AuditLogRepository)
	mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil)

	h := &auth_handler.HostedHandlerStruct{
		WorkOS:      mockWorkOS,
		AuditLogger: auth.NewAuditService(mockAudit),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "abc"})
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
	mockAudit.AssertExpectations(t)
}

func TestHostedHandler_Success(t *testing.T) {
	secret := "this-is-a-long-enough-secret-key-123"
	t.Setenv("AUTH_SECRET", secret)
	stateParam, fullState, err := stateutil.BuildStatePayload("abc", "/dashboard", secret)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state="+fullState, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
	rr := httptest.NewRecorder()

	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "user@example.com"},
	}, nil)

	h := &auth_handler.HostedHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, user usermanagement.User) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: user.Email}, nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusTemporaryRedirect, rr.Code)
	assert.Equal(t, "/dashboard", rr.Header().Get("Location"))
}

func TestHostedHandler_SetsSecureSessionCookieInProductionWithoutAuthURL(t *testing.T) {
	secret := "this-is-a-long-enough-secret-key-123"
	t.Setenv("AUTH_SECRET", secret)
	t.Setenv("AUTH_URL", "")
	t.Setenv("NODE_ENV", "production")

	stateParam, fullState, err := stateutil.BuildStatePayload("abc", "/dashboard", secret)
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state="+fullState, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
	rr := httptest.NewRecorder()

	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "user@example.com"},
	}, nil)

	h := &auth_handler.HostedHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, user usermanagement.User) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: user.Email}, nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusTemporaryRedirect, rr.Code)
	foundSessionCookie := false
	for _, cookie := range rr.Header().Values("Set-Cookie") {
		if strings.HasPrefix(cookie, "session_token=") {
			foundSessionCookie = true
			assert.Contains(t, cookie, "Secure")
		}
	}
	assert.True(t, foundSessionCookie, "session_token cookie should be present")
}

func TestHostedHandler_LinkUserError(t *testing.T) {
	secret := "this-is-a-long-enough-secret-key-123"
	t.Setenv("AUTH_SECRET", secret)
	stateParam, fullState, err := stateutil.BuildStatePayload("abc", "", secret)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state="+fullState, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
	rr := httptest.NewRecorder()

	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "user@example.com"},
	}, nil)

	h := &auth_handler.HostedHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, user usermanagement.User) (*auth.AuthUser, error) {
			return nil, errors.New("link failed")
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestHostedHandler_DisabledUser(t *testing.T) {
	secret := "this-is-a-long-enough-secret-key-123"
	t.Setenv("AUTH_SECRET", secret)
	stateParam, fullState, err := stateutil.BuildStatePayload("abc", "", secret)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state="+fullState, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
	rr := httptest.NewRecorder()

	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "disabled@example.com"},
	}, nil)

	h := &auth_handler.HostedHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, user usermanagement.User) (*auth.AuthUser, error) {
			return nil, auth.ErrUserDisabled
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusForbidden, rr.Code)
}

func TestHostedHandler_TokenError(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "abc"})
	rr := httptest.NewRecorder()

	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "user@example.com"},
	}, nil)

	h := &auth_handler.HostedHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, user usermanagement.User) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: user.Email}, nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestHostedHandler_GetQueriesError(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "abc"})
	rr := httptest.NewRecorder()

	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "user@example.com"},
	}, nil)

	h := &auth_handler.HostedHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, user usermanagement.User) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: user.Email}, nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return nil, errors.New("db error")
		},
	}

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestHostedHandler_Success_WithOrgID_IndexedWorkOSLookup(t *testing.T) {
	secret := "this-is-a-long-enough-secret-key-123"
	t.Setenv("AUTH_SECRET", secret)
	stateParam, fullState, err := stateutil.BuildStatePayload("abc", "", secret)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state="+fullState, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
	rr := httptest.NewRecorder()

	dbMock := dbtest.NewMockPoolRegexp(t)

	orgColumns := []string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}
	ts := pgtype.Timestamp{Time: time.Now(), Valid: true}
	workosID := "org_123"
	// Keep this predicate pinned to the indexed column used by shared DB schema:
	// organizations_workos_organization_id_key on organizations(workos_organization_id).
	dbMock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(&workosID).
		WillReturnRows(pgxmock.NewRows(orgColumns).AddRow(
			int32(2), "Org", "org", nil, ts, ts, "free", nil, nil, nil, &workosID, false, []byte("{}"),
		))

	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User:           usermanagement.User{Email: "user@example.com"},
		OrganizationID: workosID,
	}, nil)

	h := &auth_handler.HostedHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(ctx context.Context, q *db.Queries, user usermanagement.User) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: user.Email}, nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return db.New(dbMock), nil
		},
	}

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusTemporaryRedirect, rr.Code)
	assert.NoError(t, dbMock.ExpectationsWereMet())
}

func TestHostedHandler_OrganizationLookupFailureDoesNotIssueSession(t *testing.T) {
	secret := "this-is-a-long-enough-secret-key-123"
	t.Setenv("AUTH_SECRET", secret)
	stateParam, fullState, err := stateutil.BuildStatePayload("abc", "", secret)
	require.NoError(t, err)
	workosID := "org_missing"

	dbMock := dbtest.NewMockPoolRegexp(t)
	dbMock.ExpectQuery(`SELECT .* FROM organizations WHERE workos_organization_id = \$1`).
		WithArgs(&workosID).
		WillReturnError(pgx.ErrNoRows)
	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "user@example.com"}, OrganizationID: workosID,
	}, nil)
	h := &auth_handler.HostedHandlerStruct{
		WorkOS: mockWorkOS,
		LinkUser: func(context.Context, *db.Queries, usermanagement.User) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: "user@example.com"}, nil
		},
		GetQueries: func(context.Context) (*db.Queries, error) { return db.New(dbMock), nil },
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state="+fullState, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: stateParam})
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
	for _, cookie := range rr.Result().Cookies() {
		assert.NotEqual(t, auth.SessionCookieName, cookie.Name)
		assert.NotEqual(t, auth.SecureSessionCookieName, cookie.Name)
	}
	assert.NoError(t, dbMock.ExpectationsWereMet())
}

func TestHostedHandler_RateLimited(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(100, nil)

	h := &auth_handler.HostedHandlerStruct{
		WorkOS:  new(provider_mocks.WorkOSProvider),
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
		LinkUser: func(ctx context.Context, q *db.Queries, user usermanagement.User) (*auth.AuthUser, error) {
			return &auth.AuthUser{ID: 1, Email: "user@example.com"}, nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "abc"})
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusTooManyRequests, rr.Code)
}

func TestHostedHandler_RateLimitErrorReturnsServiceUnavailable(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	mockRedis := new(ratelimit_mocks.RedisClient)
	mockRedis.On("Incr", mock.Anything, mock.Anything).Return(0, errors.New("redis down"))

	h := &auth_handler.HostedHandlerStruct{
		WorkOS:  new(provider_mocks.WorkOSProvider),
		Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "abc"})
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestHostedHandler_MissingLinkUserReturnsServerError(t *testing.T) {
	t.Setenv("AUTH_SECRET", "")
	mockWorkOS := new(provider_mocks.WorkOSProvider)
	mockWorkOS.On("AuthenticateWithCode", mock.Anything, mock.Anything).Return(usermanagement.AuthenticateResponse{
		User: usermanagement.User{Email: "user@example.com"},
	}, nil)

	h := &auth_handler.HostedHandlerStruct{
		WorkOS: mockWorkOS,
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback?code=1&state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "abc"})
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestLinkOrCreateWorkOSUserWithTM_Error(t *testing.T) {
	dbMock := dbtest.NewMockPool(t)

	q := db.New(dbMock)
	workosUser := usermanagement.User{
		ID:    "workos-123",
		Email: "workos@example.com",
	}

	dbMock.ExpectBegin()
	// linkOrCreateOAuthUser checks for existing account/user
	dbMock.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("workos", "workos-123").
		WillReturnError(errors.New("not found"))

	dbMock.ExpectRollback()

	user, err := auth_handler.LinkOrCreateWorkOSUserWithTM(context.Background(), q, workosUser, dbMock)
	require.Error(t, err)
	assert.Nil(t, user)
	assert.NoError(t, dbMock.ExpectationsWereMet())
}

func TestLinkOrCreateWorkOSUserWithTM_Success(t *testing.T) {
	dbMock := dbtest.NewMockPool(t)

	q := db.New(dbMock)
	workosUser := usermanagement.User{
		ID:    "workos-123",
		Email: "workos@example.com",
	}

	dbMock.ExpectBegin()
	// 1. GetUserByAccount
	dbMock.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
		WithArgs("workos", "workos-123").
		WillReturnRows(pgxmock.NewRows([]string{"id"})) // Not found

	// 2. FindByEmail
	dbMock.ExpectQuery("SELECT (.+) FROM users WHERE email = \\$1").
		WithArgs("workos@example.com").
		WillReturnRows(pgxmock.NewRows([]string{"id"})) // Not found

	// 3. CreateUser
	dbMock.ExpectQuery("INSERT INTO users").
		WithArgs("workos@example.com", (*string)(nil), "free").
		WillReturnRows(dbtest.UserRow(dbtest.User{
			ID: 1, Email: "workos@example.com", APITier: "STARTER", APIRequestsLimit: 100,
		}))

	// 4. CreateAuditLog (from logUserCreated) in an isolated savepoint.
	dbMock.ExpectBeginTx(pgx.TxOptions{})
	dbMock.ExpectQuery("INSERT INTO audit_logs").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(dbtest.AuditLogRow(dbtest.AuditLog{ID: 1}))
	dbMock.ExpectCommit()

	// 5. CreateAccount
	dbMock.ExpectQuery("INSERT INTO accounts").
		WithArgs(pgxmock.AnyArg(), int32(1), "oauth", "workos", "workos-123", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"id", "user_id", "type", "provider", "provideraccountid", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state"}).
			AddRow("acc-1", int32(1), "oauth", "workos", "workos-123", nil, nil, nil, nil, nil, nil, nil))

	dbMock.ExpectCommit()

	user, err := auth_handler.LinkOrCreateWorkOSUserWithTM(context.Background(), q, workosUser, dbMock)
	require.NoError(t, err)
	assert.NotNil(t, user)
	assert.Equal(t, "workos@example.com", user.Email)
	assert.NoError(t, dbMock.ExpectationsWereMet())
}

func TestHostedHandler_Wrapper(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "test-client-id")
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_URL", "postgres://localhost:5432")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/callback", nil)
	rr := httptest.NewRecorder()

	auth_handler.HostedHandler(rr, req)

	assert.Equal(t, http.StatusMethodNotAllowed, rr.Code)
}
