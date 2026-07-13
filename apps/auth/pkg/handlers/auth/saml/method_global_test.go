package saml

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMethodHandler_GlobalSuccess(t *testing.T) {
	body, err := json.Marshal(LoginMethodRequest{Email: "user@example.com"})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login-method", bytes.NewBuffer(body))
	rr := httptest.NewRecorder()
	MethodHandler(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Contains(t, rr.Body.String(), `"method":"OAUTH"`)
}
