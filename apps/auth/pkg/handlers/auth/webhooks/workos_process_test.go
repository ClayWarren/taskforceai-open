package webhooks

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

func TestProcessEvent_UserCreatedSuccess(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_create","event":"dsync.user.created","data":{"organization_id":"org_1","email":"new@example.com","id":"user_1"}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		AddMembership: func(ctx context.Context, q *db.Queries, email, org string) error {
			assert.Equal(t, "new@example.com", email)
			assert.Equal(t, "org_1", org)
			return nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`))
	rr := serve(h, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestProcessEvent_UserCreatedInvalidPayload(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_create_invalid","event":"dsync.user.created","organization_id":"org_1","data":{}}`, nil)

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

func TestProcessEvent_DeactivateInvalidPayload(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_del_invalid","event":"dsync.user.deleted","organization_id":"org_1","data":{}}`, nil)

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

func TestProcessEvent_DeactivateFailureClearsReplay(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_del_fail","event":"dsync.user.deleted","data":{"organization_id":"org_1","email":"user@example.com"}}`, nil)

	store := &replayStoreStub{setNXResult: true}
	h := &WorkOSWebhookHandlerStruct{
		Validator:   mockVal,
		ReplayStore: store,
		DeactivateUser: func(ctx context.Context, q *db.Queries, email, org string) error {
			assert.Equal(t, "org_1", org)
			return errors.New("deactivate failed")
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`))
	rr := serve(h, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestProcessEvent_UserUpdatedChangesEmailWithinSignedOrganization(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_update","event":"dsync.user.updated","data":{"id":"user_1","organization_id":"org_1","email":"new@example.com","previous_attributes":{"email":"old@example.com"},"state":"active"}}`, nil)

	called := false
	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		UpdateUser: func(_ context.Context, _ *db.Queries, user WorkosUser) error {
			called = true
			assert.Equal(t, "org_1", user.OrganizationID)
			assert.Equal(t, "old@example.com", user.PreviousAttributes.Email)
			assert.Equal(t, "new@example.com", user.Email)
			return nil
		},
		GetQueries: func(context.Context) (*db.Queries, error) { return &db.Queries{}, nil },
	}

	rr := serve(h, httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`)))

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.True(t, called)
}

func TestProcessEvent_InactiveUserUpdateDeactivatesPreviousEmail(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).
		Return(`{"id":"evt_inactive","event":"dsync.user.updated","data":{"id":"user_1","organization_id":"org_1","email":"new@example.com","previous_attributes":{"email":"old@example.com"},"state":"inactive"}}`, nil)

	called := false
	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		DeactivateUser: func(_ context.Context, _ *db.Queries, email, org string) error {
			called = true
			assert.Equal(t, "old@example.com", email)
			assert.Equal(t, "org_1", org)
			return nil
		},
		GetQueries: func(context.Context) (*db.Queries, error) { return &db.Queries{}, nil },
	}

	rr := serve(h, httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(`{}`)))

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.True(t, called)
}
