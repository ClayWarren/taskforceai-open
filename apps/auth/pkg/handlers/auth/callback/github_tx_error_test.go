package callback

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"golang.org/x/oauth2"
)

func TestGitHubCallbackHandler_TransactionFailed(t *testing.T) {
	t.Setenv("DATABASE_URL", "mock")
	t.Setenv("ENCRYPTION_KEY", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "v1")

	mockGH := &testutils.MockGitHubClient{
		Token: &oauth2.Token{AccessToken: "gh-token", TokenType: "bearer"},
		User:  &providers.GitHubUser{ID: 456, Login: "testuser", Email: "test@example.com"},
	}
	mockPool, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	defer mockPool.Close()

	h := &GitHubCallbackHandlerStruct{
		GitHub: mockGH,
		AuthUserGetter: func(r *http.Request) *adapterauth.AuthenticatedUser {
			return &adapterauth.AuthenticatedUser{ID: 123, Email: "test@example.com"}
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			mockPool.ExpectBeginTx(pgx.TxOptions{})
			expectOAuthAccountLock(mockPool)
			mockPool.ExpectExec("DELETE FROM accounts").
				WithArgs(int32(123), "github").
				WillReturnResult(pgxmock.NewResult("DELETE", 1))
			mockPool.ExpectQuery("INSERT INTO accounts").
				WithArgs(callbackInsertArgs()...).
				WillReturnError(errors.New("insert failed"))
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
