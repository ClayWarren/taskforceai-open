package saml

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMethodHandler_InvalidEmailParts(t *testing.T) {
	h := &MethodHandlerStruct{}
	body, _ := json.Marshal(LoginMethodRequest{Email: "user@@example.com"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-method", bytes.NewBuffer(body))
	rr := serve(h, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
