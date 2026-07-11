package webhooks

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestProcessEvent_UserRemovedInvalidPayload(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_removed_bad","event":"dsync.group.user_removed","organization_id":"org_1","data":{"user":{"email":""}}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`))
	rr := serve(h, req)
	assert.Equal(t, http.StatusBadRequest, rr.Code)
}
