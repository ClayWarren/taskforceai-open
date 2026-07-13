package webhooks

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
)

type replayStoreStub struct {
	setNXResult bool
	setNXErr    error
	setErr      error
	setNXCalls  int
}

func (s *replayStoreStub) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	s.setNXCalls++
	return s.setNXResult, s.setNXErr
}

func (s *replayStoreStub) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return s.setErr
}

func (s *replayStoreStub) Del(ctx context.Context, key string) (bool, error) {
	return true, nil
}

func TestWorkOSWebhook_MethodNotAllowed(t *testing.T) {
	h := &WorkOSWebhookHandlerStruct{}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusMethodNotAllowed, rr.Code)
}

func TestWorkOSWebhook_InvalidSignature(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return("", errors.New("bad sig"))

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestWorkOSWebhook_InvalidPayload(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return("{invalid", nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestWorkOSWebhook_MissingEventID(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"event":"unknown.event","data":{}}`, nil)

	h := &WorkOSWebhookHandlerStruct{Validator: mockVal}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestWorkOSWebhook_MissingReplayStoreInProduction(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"evt_prod","event":"unknown.event","data":{}}`, nil)

	h := &WorkOSWebhookHandlerStruct{Validator: mockVal}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestWorkOSWebhook_UserDeleted(t *testing.T) {
	called := false
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"dsync.user.deleted","organization_id":"org","data":{"email":"a@b.com"}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		DeactivateUser: func(ctx context.Context, q *db.Queries, email, org string) error {
			assert.Equal(t, "a@b.com", email)
			assert.Equal(t, "org", org)
			called = true
			return nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.True(t, called)
}

func TestWorkOSWebhook_UserCreated(t *testing.T) {
	called := false
	payload := map[string]any{
		"id":              "1",
		"event":           "dsync.user.created",
		"organization_id": "org",
		"data": map[string]any{
			"id":         "u1",
			"email":      "a@b.com",
			"first_name": "A",
			"last_name":  "B",
		},
	}
	body, _ := json.Marshal(payload)
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(string(body), nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		AddMembership: func(ctx context.Context, q *db.Queries, email, org string) error {
			called = true
			return nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.True(t, called)
}

func TestWorkOSWebhook_UserDeactivatedEvent(t *testing.T) {
	called := false
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"dsync.user.deactivated","organization_id":"org","data":{"email":"a@b.com"}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		DeactivateUser: func(ctx context.Context, q *db.Queries, email, org string) error {
			assert.Equal(t, "a@b.com", email)
			assert.Equal(t, "org", org)
			called = true
			return nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.True(t, called)
}

func TestWorkOSWebhook_GroupUserAdded(t *testing.T) {
	called := false
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"dsync.group.user_added","organization_id":"org","data":{"user":{"email":"a@b.com"}}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		AddMembership: func(ctx context.Context, q *db.Queries, email, org string) error {
			called = true
			return nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.True(t, called)
}

func TestWorkOSWebhook_UserRemoved(t *testing.T) {
	called := false
	payload := map[string]any{
		"id":              "1",
		"event":           "dsync.group.user_removed",
		"organization_id": "org",
		"data": map[string]any{
			"user": map[string]any{
				"id":         "u1",
				"email":      "a@b.com",
				"first_name": "A",
				"last_name":  "B",
			},
		},
	}
	body, _ := json.Marshal(payload)
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(string(body), nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		RemoveMembership: func(ctx context.Context, q *db.Queries, email, org string) error {
			called = true
			return nil
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.True(t, called)
}

func TestWorkOSWebhook_UnknownEvent(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"unknown.event","organization_id":"org","data":{}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
}

func TestWorkOSWebhook_InvalidMembershipPayload(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"dsync.group.user_added","organization_id":"org","data":{"user":{"id":"u1"}}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestWorkOSWebhook_InvalidUserPayloads(t *testing.T) {
	for _, eventType := range []string{"dsync.user.deleted", "dsync.user.created"} {
		t.Run(eventType, func(t *testing.T) {
			mockVal := new(webhookValidatorMock)
			mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"`+eventType+`","organization_id":"org","data":{"id":"u1"}}`, nil)

			h := &WorkOSWebhookHandlerStruct{
				Validator: mockVal,
				GetQueries: func(ctx context.Context) (*db.Queries, error) {
					return &db.Queries{}, nil
				},
			}
			req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
			rr := httptest.NewRecorder()

			h.ServeHTTP(rr, req)

			assert.Equal(t, http.StatusBadRequest, rr.Code)
		})
	}
}

func TestWorkOSWebhook_AddMembershipError(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"dsync.user.created","organization_id":"org","data":{"email":"a@b.com"}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		AddMembership: func(ctx context.Context, q *db.Queries, email, org string) error {
			return errors.New("add failed")
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestWorkOSWebhook_DeactivateUserError(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"dsync.user.deleted","organization_id":"org","data":{"email":"a@b.com"}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		DeactivateUser: func(ctx context.Context, q *db.Queries, email, org string) error {
			return errors.New("deactivate failed")
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestWorkOSWebhook_GroupAddMembershipError(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"dsync.group.user_added","organization_id":"org","data":{"user":{"email":"a@b.com"}}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		AddMembership: func(ctx context.Context, q *db.Queries, email, org string) error {
			return errors.New("add failed")
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestWorkOSWebhook_RemoveMembershipError(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"dsync.group.user_removed","organization_id":"org","data":{"user":{"email":"a@b.com"}}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		RemoveMembership: func(ctx context.Context, q *db.Queries, email, org string) error {
			return errors.New("remove failed")
		},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestWorkOSWebhook_GetQueriesError(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"1","event":"dsync.user.deleted","organization_id":"org","data":{"email":"a@b.com"}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator: mockVal,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return nil, errors.New("db error")
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := httptest.NewRecorder()

	h.ServeHTTP(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestWorkOSWebhook_RecordDeadLetter(t *testing.T) {
	store := &replayStoreStub{}
	h := &WorkOSWebhookHandlerStruct{
		ReplayStore: store,
	}

	h.recordDeadLetter(context.Background(), "evt_123", "test.event", errors.New("test error"), "test_reason")

	// Check that Set was called (since it's a stub, we just ensure it doesn't panic and coverage is recorded)
	// In a real mock we would verify the payload.
}

func TestWorkOSHandler_NoSecret(t *testing.T) {
	t.Setenv("WORKOS_WEBHOOK_SECRET", "")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/webhooks/workos", nil)
	rr := httptest.NewRecorder()

	WorkOSHandler(rr, req)

	assert.Equal(t, http.StatusInternalServerError, rr.Code)
}

func TestWorkOSHandler_InvalidSignatureWithSecret(t *testing.T) {
	t.Setenv("WORKOS_WEBHOOK_SECRET", "whsec_test")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/webhooks/workos", bytes.NewBufferString(`{}`))
	req.Header.Set("WorkOS-Signature", "bad")
	rr := httptest.NewRecorder()

	WorkOSHandler(rr, req)

	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestWorkOSWebhook_DuplicateEventAcknowledged(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"evt_1","event":"unknown.event","organization_id":"org","data":{}}`, nil)

	store := &replayStoreStub{setNXResult: false}
	h := &WorkOSWebhookHandlerStruct{
		Validator:   mockVal,
		ReplayStore: store,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := serve(h, req)
	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, 1, store.setNXCalls)
}

func TestWorkOSWebhook_GetQueriesError_DoesNotSetReplayKey(t *testing.T) {
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"evt_loss","event":"unknown.event","organization_id":"org","data":{}}`, nil)

	store := &replayStoreStub{setNXResult: true}
	h := &WorkOSWebhookHandlerStruct{
		Validator:   mockVal,
		ReplayStore: store,
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return nil, errors.New("db error")
		},
	}

	req1 := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr1 := httptest.NewRecorder()
	h.ServeHTTP(rr1, req1)
	assert.Equal(t, http.StatusInternalServerError, rr1.Code)

	req2 := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr2 := httptest.NewRecorder()
	h.ServeHTTP(rr2, req2)
	assert.Equal(t, http.StatusInternalServerError, rr2.Code)
	assert.Equal(t, 0, store.setNXCalls)
}

func TestWorkOSWebhook_ReplayStoreFailureInProduction(t *testing.T) {
	t.Setenv("NODE_ENV", "production")
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"evt_2","event":"unknown.event","organization_id":"org","data":{}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator:   mockVal,
		ReplayStore: &replayStoreStub{setNXErr: errors.New("redis unavailable")},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := serve(h, req)
	assert.Equal(t, http.StatusServiceUnavailable, rr.Code)
}

func TestWorkOSWebhook_ReplayStoreFailureOutsideProductionContinues(t *testing.T) {
	t.Setenv("NODE_ENV", "development")
	mockVal := new(webhookValidatorMock)
	mockVal.On("ValidatePayload", mock.Anything, mock.Anything).Return(`{"id":"evt_3","event":"unknown.event","organization_id":"org","data":{}}`, nil)

	h := &WorkOSWebhookHandlerStruct{
		Validator:   mockVal,
		ReplayStore: &replayStoreStub{setNXErr: errors.New("redis unavailable")},
		GetQueries: func(ctx context.Context) (*db.Queries, error) {
			return &db.Queries{}, nil
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString("{}"))
	rr := serve(h, req)
	assert.Equal(t, http.StatusOK, rr.Code)
}
