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

func TestProcessEvent_GroupUserAddedSuccess(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_add","event":"dsync.group.user_added","organization_id":"org_1","data":{"user":{"email":"member@example.com","id":"u1"}}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		AddMembership: func(ctx context.Context, q *db.Queries, email, org string) error {
			assert.Equal(t, "member@example.com", email)
			assert.Equal(t, "org_1", org)
			return nil
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`))
	rr := serve(h, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestProcessEvent_GroupUserRemovedSuccess(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_remove","event":"dsync.group.user_removed","organization_id":"org_1","data":{"user":{"email":"member@example.com","id":"u1"}}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		RemoveMembership: func(ctx context.Context, q *db.Queries, email, org string) error {
			assert.Equal(t, "member@example.com", email)
			assert.Equal(t, "org_1", org)
			return nil
		},
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`))
	rr := serve(h, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestProcessEvent_UnknownEventAcknowledged(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_unknown","event":"dsync.unknown.event","organization_id":"org_1","data":{}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		GetQueries: func(context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`))
	rr := serve(h, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}
