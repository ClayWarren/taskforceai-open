package callback

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/auth-service/pkg/providers"
	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/pashagolub/pgxmock/v4"
	"golang.org/x/oauth2"
)

func TestGitHubCallbackHandler_EncryptTokenFailure(t *testing.T) {
	t.Setenv("ENCRYPTION_KEY", "")
	t.Setenv("ENCRYPTION_KEY_ACTIVE_VERSION", "")

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
			return db.New(mockPool), nil
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback/github?code=code&state=state", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "state"})
	rr := serve(h, req)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rr.Code)
	}
}
