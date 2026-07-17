package saml

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMethodHandler_CORSOptions(t *testing.T) {
	h := &MethodHandlerStruct{}
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/auth/login-method", nil)
	req.Header.Set("Origin", "https://console.taskforceai.chat")
	req.Header.Set("Access-Control-Request-Method", "POST")
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusNoContent, rr.Code)
}
