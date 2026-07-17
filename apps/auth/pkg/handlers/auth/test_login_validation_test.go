//go:build !production

package auth

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTestLoginHandler_ValidationError(t *testing.T) {
	t.Setenv("GO_ENV", "test")
	t.Setenv("ENABLE_TEST_LOGIN", "true")

	body, _ := json.Marshal(map[string]string{"email": "not-an-email"})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBuffer(body))
	rr := httptest.NewRecorder()
	TestLoginHandler(rr, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
