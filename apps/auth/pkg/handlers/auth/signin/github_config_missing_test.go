package signin

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGitHubSigninHandler_MissingConfiguration(t *testing.T) {
	t.Setenv("GITHUB_CLIENT_ID", "")
	t.Setenv("GITHUB_CLIENT_SECRET", "")
	t.Setenv("GITHUB_REDIRECT_URL", "")

	req := httptest.NewRequest(http.MethodGet, "/api/auth/signin/github", nil)
	rr := httptest.NewRecorder()
	GitHubSigninHandler(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}
