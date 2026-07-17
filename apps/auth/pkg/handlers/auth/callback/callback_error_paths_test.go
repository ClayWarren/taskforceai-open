package callback

import (
	"context"
	"errors"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"net/http"
	"net/http/httptest"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	auth_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/auth"
	ratelimit_mocks "github.com/TaskForceAI/auth-service/mocks/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/auth"
	authhandler "github.com/TaskForceAI/auth-service/pkg/handler"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/ratelimit"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	infraredis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/workos/workos-go/v6/pkg/usermanagement"
	"golang.org/x/oauth2"
)

type callbackNonTransactorDBTX struct{}

func (callbackNonTransactorDBTX) Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unused")
}

func (callbackNonTransactorDBTX) Query(context.Context, string, ...interface{}) (pgx.Rows, error) {
	return nil, errors.New("unused")
}

func (callbackNonTransactorDBTX) QueryRow(context.Context, string, ...interface{}) pgx.Row {
	return callbackUnusedRow{}
}

type callbackUnusedRow struct{}

func (callbackUnusedRow) Scan(...interface{}) error {
	return errors.New("unused")
}

func TestCallbackHandlersHandleCORSPreflight(t *testing.T) {
	tests := []struct {
		name    string
		handler http.Handler
		path    string
	}{
		{
			name:    "github",
			handler: &GitHubCallbackHandlerStruct{},
			path:    "/api/auth/callback/github",
		},
		{
			name:    "google drive",
			handler: &GoogleDriveCallbackHandlerStruct{},
			path:    "/api/auth/callback/google-drive",
		},
		{
			name:    "hosted",
			handler: &HostedHandlerStruct{},
			path:    "/api/v1/auth/callback",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodOptions, tt.path, nil)
			rr := serve(tt.handler, req)
			if rr.Code != http.StatusNoContent {
				t.Fatalf("expected 204, got %d", rr.Code)
			}
		})
	}
}

func TestCallbackRedirectHelperEdgeCases(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/callback?state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "xyz"})
	if _, err := verifyState(httptest.NewRecorder(), req); err == nil {
		t.Fatal("expected state mismatch error")
	}

	if got := maybeConvertToAppURL("https://external.example/path"); got != "https://external.example/path" {
		t.Fatalf("expected external URL passthrough, got %s", got)
	}

	t.Setenv("APP_URL", "")
	t.Setenv("WEB_URL", "")
	t.Setenv("NEXT_PUBLIC_APP_URL", "")
	t.Setenv("ALLOWED_REDIRECT_DOMAIN", "////")
	if got := maybeConvertToAppURL("/dashboard"); got != "/dashboard" {
		t.Fatalf("expected malformed allowed domain to keep relative target, got %s", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_redirect", Value: "/safe%ZZ"})
	if got := determineRedirectTarget(req, ""); got != "/safe%ZZ" {
		t.Fatalf("expected invalid escape cookie fallback, got %s", got)
	}
}

func TestGitHubCallbackHandler_DeleteAccountFailure(t *testing.T) {
	t.Setenv("DATABASE_URL", "mock")
	t.Setenv("ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	mockGH := &testutils.MockGitHubClient{
		Token: &oauth2.Token{AccessToken: "gh-token", TokenType: "bearer"},
		User:  &providers.GitHubUser{ID: 456, Login: "testuser", Email: "test@example.com"},
	}
	mockPool := dbtest.NewMockPool(t)

	h := &GitHubCallbackHandlerStruct{
		GitHub: mockGH,
		AuthUserGetter: func(*http.Request) *adapterauth.AuthenticatedUser {
			return &adapterauth.AuthenticatedUser{ID: 123, Email: "test@example.com"}
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			mockPool.ExpectBeginTx(pgx.TxOptions{})
			expectOAuthAccountLock(mockPool)
			mockPool.ExpectExec("DELETE FROM accounts").
				WithArgs(int32(123), "github").
				WillReturnError(errors.New("delete failed"))
			mockPool.ExpectRollback()
			return db.New(mockPool), nil
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/github?code=code&state=state", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state_github", Value: "state"})
	rr := serve(h, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestGoogleDriveCallbackHandler_ScopeAndDeleteFailure(t *testing.T) {
	t.Run("scope from token extra", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "mock")
		t.Setenv("ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
		t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

		token := (&oauth2.Token{
			AccessToken:  "token",
			RefreshToken: "refresh",
			TokenType:    "bearer",
		}).WithExtra(map[string]any{"scope": "drive.file"})
		mockGoogle := &testutils.MockGoogleClient{
			Token: token,
			User:  &providers.GoogleUser{ID: "google-user-id", Email: "test@example.com"},
		}
		mockPool := dbtest.NewMockPool(t)

		h := &GoogleDriveCallbackHandlerStruct{
			Google: mockGoogle,
			AuthUserGetter: func(*http.Request) *adapterauth.AuthenticatedUser {
				return &adapterauth.AuthenticatedUser{ID: 123, Email: "test@example.com"}
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				mockPool.ExpectBeginTx(pgx.TxOptions{})
				expectOAuthAccountLock(mockPool)
				mockPool.ExpectExec("DELETE FROM accounts").
					WithArgs(int32(123), "google-drive").
					WillReturnResult(pgxmock.NewResult("DELETE", 1))
				mockPool.ExpectQuery("INSERT INTO accounts").
					WithArgs(callbackInsertArgs()...).
					WillReturnRows(accountRow("acc_1", int32(123), "google-drive", "google-user-id", &token.RefreshToken, &token.AccessToken, &token.TokenType, ptrString("drive.file")))
				mockPool.ExpectCommit()
				return db.New(mockPool), nil
			},
		}

		req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive?code=code&state=state", nil)
		req.AddCookie(&http.Cookie{Name: "oauth_state_google_drive", Value: "state"})
		rr := serve(h, req)

		if rr.Code != http.StatusTemporaryRedirect {
			t.Fatalf("expected 307, got %d", rr.Code)
		}
		if err := mockPool.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})

	t.Run("delete failure", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "mock")
		t.Setenv("ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
		t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

		mockGoogle := &testutils.MockGoogleClient{
			Token: &oauth2.Token{AccessToken: "token"},
			User:  &providers.GoogleUser{ID: "google-user-id", Email: "test@example.com"},
		}
		mockPool := dbtest.NewMockPool(t)

		h := &GoogleDriveCallbackHandlerStruct{
			Google: mockGoogle,
			AuthUserGetter: func(*http.Request) *adapterauth.AuthenticatedUser {
				return &adapterauth.AuthenticatedUser{ID: 123, Email: "test@example.com"}
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				mockPool.ExpectBeginTx(pgx.TxOptions{})
				expectOAuthAccountLock(mockPool)
				mockPool.ExpectExec("DELETE FROM accounts").
					WithArgs(int32(123), "google-drive").
					WillReturnError(errors.New("delete failed"))
				mockPool.ExpectRollback()
				return db.New(mockPool), nil
			},
		}

		req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive?code=code&state=state", nil)
		req.AddCookie(&http.Cookie{Name: "oauth_state_google_drive", Value: "state"})
		rr := serve(h, req)

		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("expected 500, got %d", rr.Code)
		}
		if err := mockPool.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})
}

func TestHostedCallbackFallbackBranches(t *testing.T) {
	t.Run("rate limiter allows missing IP", func(t *testing.T) {
		mockRedis := new(ratelimit_mocks.RedisClient)
		h := &HostedHandlerStruct{
			Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
		}
		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback", nil)
		req.RemoteAddr = ""
		rr := httptest.NewRecorder()

		if h.writeRateLimitError(rr, req) {
			t.Fatal("expected missing IP to skip limiter")
		}
		mockRedis.AssertNotCalled(t, "Incr", mock.Anything, mock.Anything)
	})

	t.Run("rate limiter allowed", func(t *testing.T) {
		mockRedis := new(ratelimit_mocks.RedisClient)
		mockRedis.On("Incr", mock.Anything, mock.Anything).Return(1, nil)
		mockRedis.On("Set", mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return(nil)
		h := &HostedHandlerStruct{
			Limiter: ratelimit.NewRedisRateLimiter(mockRedis, ""),
		}
		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/callback", nil)
		req.Header.Set("X-Forwarded-For", "203.0.113.20")
		rr := httptest.NewRecorder()

		if h.writeRateLimitError(rr, req) {
			t.Fatal("expected allowed limiter result")
		}
		mockRedis.AssertExpectations(t)
	})

	t.Run("MFA starts pending web login", func(t *testing.T) {
		t.Setenv("AUTH_SECRET", hostedTestAuthSecret)
		req := hostedSuccessRequest(t)
		rr := httptest.NewRecorder()

		h := &HostedHandlerStruct{
			WorkOS: &testutils.MockWorkOSClient{
				AuthResponse: usermanagement.AuthenticateResponse{User: usermanagement.User{Email: "mfa@example.com"}},
			},
			LinkUser: func(context.Context, *db.Queries, usermanagement.User) (*auth.AuthUser, error) {
				return &auth.AuthUser{ID: 1, Email: "mfa@example.com", MFAEnabled: true}, nil
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				return &db.Queries{}, nil
			},
		}

		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusTemporaryRedirect {
			t.Fatalf("expected 307, got %d", rr.Code)
		}
	})

	t.Run("successful login audit", func(t *testing.T) {
		t.Setenv("AUTH_SECRET", hostedTestAuthSecret)
		req := hostedSuccessRequest(t)
		rr := httptest.NewRecorder()
		mockAudit := new(auth_mocks.AuditLogRepository)
		mockAudit.On("CreateAuditLog", mock.Anything, mock.Anything).Return(nil)

		h := &HostedHandlerStruct{
			WorkOS: &testutils.MockWorkOSClient{
				AuthResponse: usermanagement.AuthenticateResponse{User: usermanagement.User{Email: "audit@example.com"}},
			},
			AuditLogger: auth.NewAuditService(mockAudit),
			LinkUser: func(context.Context, *db.Queries, usermanagement.User) (*auth.AuthUser, error) {
				return &auth.AuthUser{ID: 1, Email: "audit@example.com"}, nil
			},
			GetQueries: func(context.Context) (*db.Queries, error) {
				return &db.Queries{}, nil
			},
		}

		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusTemporaryRedirect {
			t.Fatalf("expected 307, got %d", rr.Code)
		}
		mockAudit.AssertExpectations(t)
	})
}

func TestHostedHandlerWrapperUsesRedisLimiter(t *testing.T) {
	t.Setenv("WORKOS_CLIENT_ID", "client")
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	t.Setenv("DATABASE_URL", "postgres://localhost:5432")

	authhandler.SetQueriesOverride(func(context.Context) (*db.Queries, error) {
		return &db.Queries{}, nil
	})
	authhandler.SetRedisClient(infraredis.NewMockClient())
	t.Cleanup(func() {
		authhandler.SetQueriesOverride(nil)
		authhandler.SetRedisClient(nil)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/callback", nil)
	rr := httptest.NewRecorder()
	HostedHandler(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rr.Code)
	}
}

func TestLinkOrCreateWorkOSUserPoolAndCommitErrors(t *testing.T) {
	t.Run("pool error", func(t *testing.T) {
		original := getWorkOSDBPool
		getWorkOSDBPool = func(context.Context) (*pgxpool.Pool, error) {
			return nil, errors.New("pool unavailable")
		}
		t.Cleanup(func() { getWorkOSDBPool = original })

		user, err := linkOrCreateWorkOSUser(context.Background(), db.New(dbtest.NewMockPool(t)), usermanagement.User{
			ID:    "workos-pool",
			Email: "pool@example.com",
		})
		if err == nil {
			t.Fatal("expected pool error")
		}
		if user != nil {
			t.Fatalf("expected nil user, got %#v", user)
		}
	})

	t.Run("commit error", func(t *testing.T) {
		mockPool := dbtest.NewMockPool(t)
		q := db.New(mockPool)
		workosUser := usermanagement.User{
			ID:    "workos-commit",
			Email: "commit@example.com",
		}

		mockPool.ExpectBegin()
		mockPool.ExpectQuery("SELECT (.+) FROM users AS u JOIN accounts AS a").
			WithArgs("workos", "workos-commit").
			WillReturnRows(pgxmock.NewRows([]string{"id"}))
		mockPool.ExpectQuery("SELECT (.+) FROM users WHERE email = \\$1").
			WithArgs("commit@example.com").
			WillReturnRows(pgxmock.NewRows([]string{"id"}))
		mockPool.ExpectQuery("INSERT INTO users").
			WithArgs("commit@example.com", (*string)(nil), "free").
			WillReturnRows(dbtest.UserRow(dbtest.User{
				ID: 1, Email: "commit@example.com", APITier: "STARTER", APIRequestsLimit: 100,
			}))
		mockPool.ExpectBeginTx(pgx.TxOptions{})
		mockPool.ExpectQuery("INSERT INTO audit_logs").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnRows(dbtest.AuditLogRow(dbtest.AuditLog{ID: 1}))
		mockPool.ExpectCommit()
		mockPool.ExpectQuery("INSERT INTO accounts").
			WithArgs(pgxmock.AnyArg(), int32(1), "oauth", "workos", "workos-commit", pgxmock.AnyArg(), pgxmock.AnyArg(), (*int32)(nil), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnRows(accountRow("acc-1", int32(1), "workos", "workos-commit", nil, nil, nil, nil))
		mockPool.ExpectCommit().WillReturnError(errors.New("commit failed"))
		mockPool.ExpectRollback()

		user, err := LinkOrCreateWorkOSUserWithTM(context.Background(), q, workosUser, mockPool)
		if err == nil {
			t.Fatal("expected commit error")
		}
		if user != nil {
			t.Fatalf("expected nil user, got %#v", user)
		}
		if err := mockPool.ExpectationsWereMet(); err != nil {
			t.Fatalf("unmet expectations: %v", err)
		}
	})
}

func TestReplaceOAuthAccountUsesInjectedPoolWhenQueriesDBIsNotTransactor(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "")
	mockPool := dbtest.NewMockPool(t)
	original := getOAuthAccountPool
	getOAuthAccountPool = func(context.Context) (postgres.Transactor, error) {
		return mockPool, nil
	}
	t.Cleanup(func() { getOAuthAccountPool = original })

	mockPool.ExpectBeginTx(pgx.TxOptions{})
	expectOAuthAccountLock(mockPool)
	mockPool.ExpectExec("DELETE FROM accounts").
		WithArgs(int32(7), "github").
		WillReturnResult(pgxmock.NewResult("DELETE", 1))
	mockPool.ExpectQuery("INSERT INTO accounts").
		WithArgs(
			pgxmock.AnyArg(),
			int32(7),
			"oauth",
			"github",
			"provider-7",
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			(*int32)(nil),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
		).
		WillReturnRows(accountRow("acc-7", int32(7), "github", "provider-7", nil, nil, nil, nil))
	mockPool.ExpectCommit()

	err := replaceOAuthAccount(context.Background(), db.New(callbackNonTransactorDBTX{}), 7, auth.CreateAccountInput{
		UserID:            7,
		Type:              "oauth",
		Provider:          "github",
		ProviderAccountID: "provider-7",
	})

	if err != nil {
		t.Fatalf("expected replaceOAuthAccount to use injected pool: %v", err)
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestReplaceOAuthAccountLockFailure(t *testing.T) {
	mockPool := dbtest.NewMockPool(t)
	original := getOAuthAccountPool
	getOAuthAccountPool = func(context.Context) (postgres.Transactor, error) { return mockPool, nil }
	t.Cleanup(func() { getOAuthAccountPool = original })
	mockPool.ExpectBeginTx(pgx.TxOptions{})
	mockPool.ExpectExec("SELECT PG_ADVISORY_XACT_LOCK").WithArgs("7", "github").WillReturnError(errors.New("lock failed"))
	mockPool.ExpectRollback()

	err := replaceOAuthAccount(context.Background(), db.New(callbackNonTransactorDBTX{}), 7, auth.CreateAccountInput{UserID: 7, Provider: "github"})
	require.ErrorContains(t, err, "failed to lock account replacement")
	require.NoError(t, mockPool.ExpectationsWereMet())
}

func ptrString(value string) *string {
	return &value
}

func accountRow(id string, userID int32, provider string, providerAccountID string, refreshToken, accessToken, tokenType, scope *string) *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id",
		"user_id",
		"type",
		"provider",
		"provideraccountid",
		"refresh_token",
		"access_token",
		"expires_at",
		"token_type",
		"scope",
		"id_token",
		"session_state",
	}).AddRow(id, userID, "oauth", provider, providerAccountID, refreshToken, accessToken, nil, tokenType, scope, nil, nil)
}

func callbackInsertArgs() []any {
	args := make([]any, 12)
	for i := range args {
		args[i] = pgxmock.AnyArg()
	}
	return args
}
