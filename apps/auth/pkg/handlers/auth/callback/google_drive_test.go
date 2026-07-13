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

func TestGoogleDriveCallbackHandler_Success(t *testing.T) {
	_ = os.Setenv("DATABASE_URL", "mock")
	_ = os.Setenv("ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	_ = os.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")
	defer func() {
		_ = os.Unsetenv("DATABASE_URL")
		_ = os.Unsetenv("ENCRYPTION_KEY")
		_ = os.Unsetenv("ENCRYPTION_KEY_ACTIVE_VERSION")
	}()

	mockGoogle := &testutils.MockGoogleClient{
		Token: &oauth2.Token{AccessToken: "token"},
		User: &providers.GoogleUser{
			ID:    "google-user-id",
			Email: "test@example.com",
		},
	}
	mockPool := dbtest.NewMockPool(t)

	mockUserGetter := func(r *http.Request) *adapterauth.AuthenticatedUser {
		return &adapterauth.AuthenticatedUser{
			ID:    123,
			Email: "test@example.com",
		}
	}

	h := &GoogleDriveCallbackHandlerStruct{
		Google:         mockGoogle,
		AuthUserGetter: mockUserGetter,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			mockPool.ExpectBeginTx(pgx.TxOptions{})
			mockPool.ExpectExec("DELETE FROM accounts").
				WithArgs(int32(123), "google-drive").
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
				}).AddRow("acc_1", int32(123), "oauth", "google-drive", "google-user-id", nil, new("token"), nil, nil, nil, nil, nil))
			mockPool.ExpectCommit()
			return db.New(mockPool), nil
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive?code=code&state=state", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "state"})
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusTemporaryRedirect {
		t.Errorf("Expected 307, got %d", w.Result().StatusCode)
	}
	if err := mockPool.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}

	// Verify state cookie was cleared to prevent replay attacks
	cookies := w.Result().Cookies()
	stateCookieCleared := false
	for _, c := range cookies {
		if c.Name == "oauth_state" && c.MaxAge == -1 {
			stateCookieCleared = true
			break
		}
	}
	if !stateCookieCleared {
		t.Error("expected oauth_state cookie to be cleared after successful callback")
	}
}

func TestGoogleDriveCallbackHandler_Errors(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	mockGoogle := &testutils.MockGoogleClient{}
	h := &GoogleDriveCallbackHandlerStruct{
		Google:         mockGoogle,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return nil },
	}

	// 0. Method Not Allowed
	req := httptest.NewRequest(http.MethodPost, "/api/auth/callback/google-drive", nil)
	w := serve(h, req)
	if w.Result().StatusCode != http.StatusMethodNotAllowed {
		t.Error("expected 405")
	}

	// 1. Unauthorized
	req = httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusUnauthorized {
		t.Error("expected 401")
	}

	// 2. Missing Code
	h.AuthUserGetter = func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{} }
	req = httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for missing code")
	}

	// 3. Invalid State
	req = httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive?code=ok&state=state", nil)
	w = serve(h, req)
	if w.Result().StatusCode != http.StatusBadRequest {
		t.Error("expected 400 for invalid state")
	}
}

func TestGoogleDriveCallbackHandler_ExchangeError(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	mockGoogle := &testutils.MockGoogleClient{
		TokenErr: errors.New("exchange failed"),
	}
	h := &GoogleDriveCallbackHandlerStruct{
		Google:         mockGoogle,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{} },
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive?code=ok&state=s", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "s"})
	w := serve(h, req)
	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Result().StatusCode)
	}
}

func TestGoogleDriveCallbackHandler_EmptyTokenResponse(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	mockGoogle := &testutils.MockGoogleClient{}
	h := &GoogleDriveCallbackHandlerStruct{
		Google:         mockGoogle,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{} },
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive?code=ok&state=s", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "s"})
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", w.Result().StatusCode)
	}
}

func TestGoogleDriveCallbackHandler_UserInfoError(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	mockGoogle := &testutils.MockGoogleClient{
		Token:   &oauth2.Token{AccessToken: "token"},
		UserErr: errors.New("userinfo failed"),
	}
	h := &GoogleDriveCallbackHandlerStruct{
		Google:         mockGoogle,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{} },
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive?code=ok&state=s", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "s"})
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", w.Result().StatusCode)
	}
}

func TestGoogleDriveCallbackHandler_InvalidUserInfoResponse(t *testing.T) {
	_ = os.Unsetenv("DATABASE_URL")
	mockGoogle := &testutils.MockGoogleClient{
		Token: &oauth2.Token{AccessToken: "token"},
		User:  &providers.GoogleUser{},
	}
	h := &GoogleDriveCallbackHandlerStruct{
		Google:         mockGoogle,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{} },
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive?code=ok&state=s", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "s"})
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", w.Result().StatusCode)
	}
}

func TestGoogleDriveCallbackHandler_QueryAndPoolErrors(t *testing.T) {
	mockGoogle := &testutils.MockGoogleClient{
		Token: &oauth2.Token{AccessToken: "token"},
		User:  &providers.GoogleUser{ID: "google-user-id"},
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
			h := &GoogleDriveCallbackHandlerStruct{
				Google:         mockGoogle,
				AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser { return &adapterauth.AuthenticatedUser{ID: 1} },
				GetQueries:     tc.getQueries,
			}
			req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive?code=ok&state=s", nil)
			req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "s"})
			w := httptest.NewRecorder()

			h.ServeHTTP(w, req)

			if w.Result().StatusCode != http.StatusInternalServerError {
				t.Errorf("expected 500, got %d", w.Result().StatusCode)
			}
		})
	}
}

func TestGoogleDriveCallbackHandler_ConfigMissing(t *testing.T) {
	_ = os.Unsetenv("GOOGLE_CLIENT_ID")
	_ = os.Unsetenv("GOOGLE_CLIENT_SECRET")
	_ = os.Unsetenv("GOOGLE_DRIVE_REDIRECT_URL")
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive", nil)
	w := httptest.NewRecorder()

	GoogleDriveCallbackHandler(w, req)

	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Result().StatusCode)
	}
}

func TestGlobalGoogleDriveCallbackHandler(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/google-drive", nil)
	w := httptest.NewRecorder()

	func() {
		defer func() { _ = recover() }()
		GoogleDriveCallbackHandler(w, req)
	}()
}
