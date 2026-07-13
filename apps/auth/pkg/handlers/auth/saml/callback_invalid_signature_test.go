package saml

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/auth-service/pkg/testutils"
	"github.com/stretchr/testify/assert"
)

func TestCallbackHandler_InvalidSignedState(t *testing.T) {
	t.Setenv("WORKOS_API_KEY", "test")
	t.Setenv("WORKOS_CLIENT_ID", "test")
	t.Setenv("AUTH_SECRET", "test_secret_must_be_long_enough_32_chars")

	req := requestWithState(t, "/api/v1/auth/saml/callback?code=valid")
	req.URL.RawQuery = "code=valid&state=not.the.cookie.value"
	rr := httptest.NewRecorder()

	h := &CallbackHandlerStruct{WorkOS: &testutils.MockWorkOSClient{}}
	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
