package webhooks

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

type brokenReader struct{}

func (brokenReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
func (brokenReader) Close() error             { return nil }

func TestWorkOSWebhookHandler_ReadBodyError(t *testing.T) {
	h := &WorkOSWebhookHandlerStruct{
		Validator: new(webhookValidatorMock),
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/webhooks/workos", brokenReader{})
	req.Body = io.NopCloser(brokenReader{})
	rr := serve(h, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestWorkOSWebhookHandler_InvalidSignature(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return("", errors.New("bad sig"))

	h := &WorkOSWebhookHandlerStruct{Validator: mockVal}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/webhooks/workos", strings.NewReader("{}"))
	rr := serve(h, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}
