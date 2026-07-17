package callback

import (
	"context"
	"errors"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"golang.org/x/oauth2"
)

func TestGitHubCallbackHandler_Success(t *testing.T) {
	_ = os.Setenv("DATABASE_URL", "mock")
	_ = os.Setenv("ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	_ = os.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")
	defer func() {
		_ = os.Unsetenv("DATABASE_URL")
		_ = os.Unsetenv("ENCRYPTION_KEY")
		_ = os.Unsetenv("ENCRYPTION_KEY_ACTIVE_VERSION")
	}()

	mockGH := &testutils.MockGitHubClient{
		Token: &oauth2.Token{AccessToken: "gh-token", TokenType: "bearer"},
		User:  &providers.GitHubUser{ID: 456, Login: "testuser", Email: "test@example.com"},
	}
	mockPool := dbtest.NewMockPool(t)

	mockUserGetter := func(r *http.Request) *adapterauth.AuthenticatedUser {
		return &adapterauth.AuthenticatedUser{
			ID:    123,
			Email: "test@example.com",
		}
	}

	h := &GitHubCallbackHandlerStruct{
		GitHub:         mockGH,
		AuthUserGetter: mockUserGetter,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			mockPool.ExpectBeginTx(pgx.TxOptions{})
			expectOAuthAccountLock(mockPool)
			mockPool.ExpectExec("DELETE FROM accounts").
				WithArgs(int32(123), "github").
				WillReturnResult(pgxmock.NewResult("DELETE", 1))
			mockPool.ExpectQuery("INSERT INTO accounts").
				WithArgs(callbackInsertArgs()...).
				WillReturnRows(pgxmock.NewRows([]string{
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
				}).AddRow("acc_1", int32(123), "oauth", "github", "456", nil, new("gh-token"), nil, new("bearer"), new("repo,read:user"), nil, nil))
			mockPool.ExpectCommit()
			return db.New(mockPool), nil
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/github?code=code&state=state", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state_github", Value: "state"})
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusTemporaryRedirect {
		t.Errorf("Expected 307, got %d", w.Result().StatusCode)
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}

	// Verify state cookie was cleared
	cookies := w.Result().Cookies()
	for _, c := range cookies {
		if c.Name == "oauth_state_github" && c.MaxAge == -1 {
			return // found cleared cookie
		}
	}
	t.Error("expected GitHub OAuth state cookie to be cleared")
}

func TestGitHubCallbackHandler_Errors(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	mockGH := &testutils.MockGitHubClient{}
	h := &GitHubCallbackHandlerStruct{
		GitHub:         mockGH,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return nil },
	}

	// 0. Method Not Allowed
	req := httptest.NewRequest(http.MethodPost, "/api/auth/callback/github", nil)
	w := serve(h, req)
	if w.Result().StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", w.Result().StatusCode)
	}

	// 1. Unauthorized
	req = httptest.NewRequest(http.MethodGet, "/api/auth/callback/github", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Result().StatusCode)
	}

	// 2. Missing Code
	h.AuthUserGetter = func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{} }
	req = httptest.NewRequest(http.MethodGet, "/api/auth/callback/github", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for missing code, got %d", w.Result().StatusCode)
	}

	// 3. Invalid State (no cookie)
	req = httptest.NewRequest(http.MethodGet, "/api/auth/callback/github?code=ok&state=state", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid state, got %d", w.Result().StatusCode)
	}

	// 4. State mismatch
	req = httptest.NewRequest(http.MethodGet, "/api/auth/callback/github?code=ok&state=abc", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state_github", Value: "xyz"})
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for state mismatch, got %d", w.Result().StatusCode)
	}
}

func TestGitHubCallbackHandler_ExchangeError(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	mockGH := &testutils.MockGitHubClient{
		TokenErr: errors.New("exchange failed"),
	}
	h := &GitHubCallbackHandlerStruct{
		GitHub:         mockGH,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{} },
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/github?code=ok&state=s", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state_github", Value: "s"})
	w := serve(h, req)
	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Result().StatusCode)
	}
}

func TestGitHubCallbackHandler_EmptyTokenResponse(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	mockGH := &testutils.MockGitHubClient{}
	h := &GitHubCallbackHandlerStruct{
		GitHub:         mockGH,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{} },
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/github?code=ok&state=s", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state_github", Value: "s"})
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", w.Result().StatusCode)
	}
}

func TestGitHubCallbackHandler_UserInfoError(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	mockGH := &testutils.MockGitHubClient{
		Token:   &oauth2.Token{AccessToken: "token"},
		UserErr: errors.New("user info failed"),
	}
	h := &GitHubCallbackHandlerStruct{
		GitHub:         mockGH,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{} },
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/github?code=ok&state=s", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state_github", Value: "s"})
	w := serve(h, req)
	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Result().StatusCode)
	}
}

func TestGitHubCallbackHandler_InvalidUserInfoResponse(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	mockGH := &testutils.MockGitHubClient{
		Token: &oauth2.Token{AccessToken: "token"},
		User:  &providers.GitHubUser{},
	}
	h := &GitHubCallbackHandlerStruct{
		GitHub:         mockGH,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{} },
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/github?code=ok&state=s", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state_github", Value: "s"})
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", w.Result().StatusCode)
	}
}

func TestGitHubCallbackHandler_QueryAndPoolErrors(t *testing.T) {
	mockGH := &testutils.MockGitHubClient{
		Token: &oauth2.Token{AccessToken: "token"},
		User:  &providers.GitHubUser{ID: 456},
	}

	for _, tc := range []struct {
		name       string
		getQueries func(context.Context) (*db.Queries, error)
	}{
		{
			name: "query error",
			getQueries: func(context.Context) (*db.Queries, error) {
				return nil, errors.New("db unavailable")
			},
		},
		{
			name: "pool error",
			getQueries: func(context.Context) (*db.Queries, error) {
				return db.New(nonTransactorDB{}), nil
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			postgres.Close()
			t.Cleanup(postgres.Close)
			t.Setenv("DATABASE_URL", "")
			h := &GitHubCallbackHandlerStruct{
				GitHub:         mockGH,
				AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{ID: 1} },
				GetQueries:     tc.getQueries,
			}
			req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/github?code=ok&state=s", nil)
			req.AddCookie(&http.Cookie{Name: "oauth_state_github", Value: "s"})
			w := httptest.NewRecorder()

			h.ServeHTTP(w, req)

			if w.Result().StatusCode != http.StatusInternalServerError {
				t.Errorf("expected 500, got %d", w.Result().StatusCode)
			}
		})
	}
}

func TestGitHubCallbackHandler_ConfigMissing(t *testing.T) {
	_ = os.Unsetenv("GITHUB_CLIENT_ID")
	_ = os.Unsetenv("GITHUB_CLIENT_SECRET")
	_ = os.Unsetenv("GITHUB_REDIRECT_URL")
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/github", nil)
	w := httptest.NewRecorder()

	GitHubCallbackHandler(w, req)

	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Result().StatusCode)
	}
}

func TestGlobalGitHubCallbackHandler(t *testing.T) {
	_ = os.Setenv("GITHUB_CLIENT_ID", "test")
	_ = os.Setenv("GITHUB_CLIENT_SECRET", "secret")
	_ = os.Setenv("GITHUB_REDIRECT_URL", "http://localhost/callback")
	defer func() {
		_ = os.Unsetenv("GITHUB_CLIENT_ID")
		_ = os.Unsetenv("GITHUB_CLIENT_SECRET")
		_ = os.Unsetenv("GITHUB_REDIRECT_URL")
	}()

	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/github", nil)
	w := httptest.NewRecorder()
	// Should not panic — config is properly initialized
	GitHubCallbackHandler(w, req)
	// Expect 401 since no auth user
	if w.Result().StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Result().StatusCode)
	}
}
