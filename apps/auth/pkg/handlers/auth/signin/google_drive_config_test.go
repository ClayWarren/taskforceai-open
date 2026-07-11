package signin

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGoogleDriveSigninHandler_MissingConfiguration(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "")
	t.Setenv("GOOGLE_CLIENT_SECRET", "")
	t.Setenv("GOOGLE_DRIVE_REDIRECT_URL", "")

	req := httptest.NewRequest(http.MethodGet, "/api/auth/signin/google-drive", nil)
	rr := httptest.NewRecorder()
	GoogleDriveSigninHandler(rr, req)
	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}
