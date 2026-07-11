package signin

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/testutils"
)

func TestGoogleDriveSigninHandler_Success(t *testing.T) {
	_ = os.Setenv("GOOGLE_CLIENT_ID", "test")
	_ = os.Setenv("GOOGLE_CLIENT_SECRET", "secret")
	_ = os.Setenv("GOOGLE_DRIVE_REDIRECT_URL", "http://localhost/callback")
	defer func() {
		_ = os.Unsetenv("GOOGLE_CLIENT_ID")
		_ = os.Unsetenv("GOOGLE_CLIENT_SECRET")
		_ = os.Unsetenv("GOOGLE_DRIVE_REDIRECT_URL")
	}()

	mockGoogle := &testutils.MockGoogleClient{
		AuthURL: "https://mock.google.com/auth",
	}

	h := &GoogleDriveSigninHandlerStruct{Google: mockGoogle}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/signin/google-drive", nil)
	w := httptest.NewRecorder()

	h.ServeHTTP(w, req)

	if w.Result().StatusCode != http.StatusTemporaryRedirect {
		t.Errorf("Expected 307, got %d", w.Result().StatusCode)
	}
}

func TestGoogleDriveSigninHandler_Error(t *testing.T) {
	_ = os.Unsetenv("GOOGLE_CLIENT_ID")
	h := &GoogleDriveSigninHandlerStruct{}
	w := doGet(h, "/api/auth/signin/google-drive")
	if w.Result().StatusCode != http.StatusInternalServerError {
		t.Error("expected 500")
	}
}

func TestGoogleDriveSigninHandler_MethodNotAllowed(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "test")
	t.Setenv("GOOGLE_CLIENT_SECRET", "secret")
	t.Setenv("GOOGLE_DRIVE_REDIRECT_URL", "url")
	h := &GoogleDriveSigninHandlerStruct{}
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rr := serve(h, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rr.Code)
	}
}

func TestGlobalGoogleDriveSigninHandler(t *testing.T) {
	_ = os.Setenv("GOOGLE_CLIENT_ID", "test")
	_ = os.Setenv("GOOGLE_CLIENT_SECRET", "secret")
	_ = os.Setenv("GOOGLE_DRIVE_REDIRECT_URL", "http://localhost/callback")
	defer func() {
		_ = os.Unsetenv("GOOGLE_CLIENT_ID")
		_ = os.Unsetenv("GOOGLE_CLIENT_SECRET")
		_ = os.Unsetenv("GOOGLE_DRIVE_REDIRECT_URL")
	}()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/signin/google-drive", nil)
	w := httptest.NewRecorder()
	func() {
		defer func() { _ = recover() }()
		GoogleDriveSigninHandler(w, req)
	}()
}
