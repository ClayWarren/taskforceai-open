package signin

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/testutils"
)

func TestGitHubSigninHandler_Success(t *testing.T) {
	_ = os.Setenv("GITHUB_CLIENT_ID", "test")
	_ = os.Setenv("GITHUB_CLIENT_SECRET", "secret")
	_ = os.Setenv("GITHUB_REDIRECT_URL", "http://localhost/callback")
	defer func() {
		_ = os.Unsetenv("GITHUB_CLIENT_ID")
		_ = os.Unsetenv("GITHUB_CLIENT_SECRET")
		_ = os.Unsetenv("GITHUB_REDIRECT_URL")
	}()

	mockGH := &testutils.MockGitHubClient{
		AuthURL: "https://github.com/login/oauth/authorize",
	}

	h := &GitHubSigninHandlerStruct{GitHub: mockGH}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/signin/github", nil)
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusTemporaryRedirect {
		t.Errorf("Expected 307, got %d", w.Result().StatusCode)
	}

	// Verify state cookie was set
	cookies := w.Result().Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == "oauth_state" && c.Value != "" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected oauth_state cookie to be set")
	}
}

func TestGitHubSigninHandler_MissingConfig(t *testing.T) {
	_ = os.Unsetenv("GITHUB_CLIENT_ID")
	_ = os.Unsetenv("GITHUB_CLIENT_SECRET")
	_ = os.Unsetenv("GITHUB_REDIRECT_URL")

	h := &GitHubSigninHandlerStruct{}
	w := doGet(h, "/api/auth/signin/github")
	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", w.Result().StatusCode)
	}
}

func TestGitHubSigninHandler_PartialConfig(t *testing.T) {
	// Only client ID set, missing secret and redirect
	_ = os.Setenv("GITHUB_CLIENT_ID", "test")
	_ = os.Unsetenv("GITHUB_CLIENT_SECRET")
	_ = os.Unsetenv("GITHUB_REDIRECT_URL")
	defer func() { _ = os.Unsetenv("GITHUB_CLIENT_ID") }()

	h := &GitHubSigninHandlerStruct{}
	w := doGet(h, "/api/auth/signin/github")
	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Errorf("expected 500 for partial config, got %d", w.Result().StatusCode)
	}
}

func TestGitHubSigninHandler_MethodNotAllowed(t *testing.T) {
	t.Setenv("GITHUB_CLIENT_ID", "test")
	t.Setenv("GITHUB_CLIENT_SECRET", "secret")
	t.Setenv("GITHUB_REDIRECT_URL", "url")
	h := &GitHubSigninHandlerStruct{}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rr := serve(h, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rr.Code)
	}
}

func TestGlobalGitHubSigninHandler(t *testing.T) {
	_ = os.Setenv("GITHUB_CLIENT_ID", "test")
	_ = os.Setenv("GITHUB_CLIENT_SECRET", "secret")
	_ = os.Setenv("GITHUB_REDIRECT_URL", "http://localhost/callback")
	defer func() {
		_ = os.Unsetenv("GITHUB_CLIENT_ID")
		_ = os.Unsetenv("GITHUB_CLIENT_SECRET")
		_ = os.Unsetenv("GITHUB_REDIRECT_URL")
	}()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/signin/github", nil)
	w := httptest.NewRecorder()
	// Should not panic since config is properly initialized
	GitHubSigninHandler(w, req)
	if w.Result().StatusCode != http.StatusTemporaryRedirect {
		t.Errorf("expected 307, got %d", w.Result().StatusCode)
	}
}
