package memories

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	corememories "github.com/TaskForceAI/core/pkg/memories"
	"github.com/TaskForceAI/go-core/internal/handlertest"
)

type mockMemoryService struct {
	getFunc    func(ctx context.Context, userID int32, orgID *int32) ([]corememories.MemoryRecord, error)
	saveFunc   func(ctx context.Context, userID int32, orgID *int32, content string, memoryType string) error
	updateFunc func(ctx context.Context, input corememories.UpdateMemoryInput) (corememories.MemoryRecord, error)
	deleteFunc func(ctx context.Context, id int32, userID int32, orgID *int32) error
}

func (m *mockMemoryService) GetUserMemories(ctx context.Context, userID int32, orgID *int32) ([]corememories.MemoryRecord, error) {
	if m.getFunc != nil {
		return m.getFunc(ctx, userID, orgID)
	}
	return nil, nil
}

func (m *mockMemoryService) GetFinancialMemories(ctx context.Context, userID int32, orgID *int32) ([]corememories.MemoryRecord, error) {
	return m.GetUserMemories(ctx, userID, orgID)
}

func (m *mockMemoryService) SaveMemory(ctx context.Context, userID int32, orgID *int32, content string, memoryType string) error {
	if m.saveFunc != nil {
		return m.saveFunc(ctx, userID, orgID, content, memoryType)
	}
	return nil
}

func (m *mockMemoryService) SaveFinancialMemory(ctx context.Context, userID int32, orgID *int32, content string) error {
	return nil
}

func (m *mockMemoryService) UpdateMemory(ctx context.Context, input corememories.UpdateMemoryInput) (corememories.MemoryRecord, error) {
	if m.updateFunc != nil {
		return m.updateFunc(ctx, input)
	}
	return corememories.MemoryRecord{}, nil
}

func (m *mockMemoryService) DeleteMemory(ctx context.Context, id int32, userID int32, orgID *int32) error {
	if m.deleteFunc != nil {
		return m.deleteFunc(ctx, id, userID, orgID)
	}
	return nil
}

func (m *mockMemoryService) ExtractAndSaveMemories(ctx context.Context, userID int, orgID *int32, sourceConversationID *int32, userPrompt, assistantResponse string) error {
	return nil
}

func setupMemoryRouter(service *mockMemoryService, user *auth.AuthenticatedUser, orgID int) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				if orgID != 0 {
					ctx = context.WithValue(ctx, adapterhandler.OrgIDContextKey, orgID)
				}
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})
	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, service)
	return r
}

func TestListMemories_Success(t *testing.T) {
	var capturedUser int32
	var capturedOrg *int32
	service := &mockMemoryService{
		getFunc: func(ctx context.Context, userID int32, orgID *int32) ([]corememories.MemoryRecord, error) {
			capturedUser = userID
			capturedOrg = orgID
			return []corememories.MemoryRecord{{ID: 1, Content: "remember this", Type: "fact", CreatedAt: "2026-06-04T19:00:00Z", UpdatedAt: "2026-06-04T19:30:00Z"}}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 12, Email: "test@example.com"}
	router := setupMemoryRouter(service, user, 24)

	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/memories")
	assert.Equal(t, int32(12), capturedUser)
	require.NotNil(t, capturedOrg)
	assert.Equal(t, int32(24), *capturedOrg)

	var body []MemoryResponse
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)
	require.Len(t, body, 1)
	assert.Equal(t, int32(1), body[0].ID)
	assert.Equal(t, "2026-06-04T19:00:00Z", body[0].CreatedAt)
	assert.Equal(t, "2026-06-04T19:30:00Z", body[0].UpdatedAt)
}

func TestListMemories_ServiceError(t *testing.T) {
	service := &mockMemoryService{
		getFunc: func(ctx context.Context, userID int32, orgID *int32) ([]corememories.MemoryRecord, error) {
			return nil, errors.New("db error")
		},
	}

	user := &auth.AuthenticatedUser{ID: 12, Email: "test@example.com"}
	router := setupMemoryRouter(service, user, 0)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/memories")
}

func TestCreateMemory_Success(t *testing.T) {
	var capturedUser int32
	var capturedOrg *int32
	var capturedContent string
	var capturedType string
	service := &mockMemoryService{
		saveFunc: func(ctx context.Context, userID int32, orgID *int32, content string, memoryType string) error {
			capturedUser = userID
			capturedOrg = orgID
			capturedContent = content
			capturedType = memoryType
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 12, Email: "test@example.com"}
	router := setupMemoryRouter(service, user, 24)

	handlertest.ServeStatus(t, router, http.StatusNoContent, http.MethodPost, "/api/v1/memories", strings.NewReader(`{"content":"User prefers concise updates","type":"preference"}`))
	assert.Equal(t, int32(12), capturedUser)
	require.NotNil(t, capturedOrg)
	assert.Equal(t, int32(24), *capturedOrg)
	assert.Equal(t, "User prefers concise updates", capturedContent)
	assert.Equal(t, "preference", capturedType)
}

func TestCreateMemory_ServiceError(t *testing.T) {
	service := &mockMemoryService{
		saveFunc: func(ctx context.Context, userID int32, orgID *int32, content string, memoryType string) error {
			return errors.New("invalid memory")
		},
	}

	user := &auth.AuthenticatedUser{ID: 12, Email: "test@example.com"}
	router := setupMemoryRouter(service, user, 0)

	handlertest.ServeStatus(t, router, http.StatusBadRequest, http.MethodPost, "/api/v1/memories", strings.NewReader(`{"content":"","type":"fact"}`))
}

func TestUpdateMemory_Success(t *testing.T) {
	var captured corememories.UpdateMemoryInput
	service := &mockMemoryService{
		updateFunc: func(ctx context.Context, input corememories.UpdateMemoryInput) (corememories.MemoryRecord, error) {
			captured = input
			return corememories.MemoryRecord{
				ID:        input.ID,
				UserID:    input.UserID,
				Content:   input.Content,
				Type:      input.Type,
				CreatedAt: "2026-06-04T19:00:00Z",
				UpdatedAt: "2026-06-04T20:00:00Z",
			}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "test@example.com"}
	router := setupMemoryRouter(service, user, 42)

	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPatch, "/api/v1/memories/55", strings.NewReader(`{"content":"Updated memory","type":"preference"}`))
	assert.Equal(t, int32(55), captured.ID)
	assert.Equal(t, int32(7), captured.UserID)
	require.NotNil(t, captured.OrganizationID)
	assert.Equal(t, int32(42), *captured.OrganizationID)
	assert.Equal(t, "Updated memory", captured.Content)
	assert.Equal(t, "preference", captured.Type)

	var body MemoryResponse
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &body))
	assert.Equal(t, int32(55), body.ID)
	assert.Equal(t, "Updated memory", body.Content)
	assert.Equal(t, "2026-06-04T20:00:00Z", body.UpdatedAt)
}

func TestUpdateMemory_ServiceError(t *testing.T) {
	service := &mockMemoryService{
		updateFunc: func(ctx context.Context, input corememories.UpdateMemoryInput) (corememories.MemoryRecord, error) {
			return corememories.MemoryRecord{}, errors.New("update failed")
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "test@example.com"}
	router := setupMemoryRouter(service, user, 0)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodPatch, "/api/v1/memories/55", strings.NewReader(`{"content":"Updated memory","type":"preference"}`))
}

func TestDeleteMemory_Success(t *testing.T) {
	var capturedID int32
	var capturedUser int32
	var capturedOrg *int32
	service := &mockMemoryService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			capturedID = id
			capturedUser = userID
			capturedOrg = orgID
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "test@example.com"}
	router := setupMemoryRouter(service, user, 0)

	handlertest.ServeStatus(t, router, http.StatusNoContent, http.MethodDelete, "/api/v1/memories/55")
	assert.Equal(t, int32(55), capturedID)
	assert.Equal(t, int32(7), capturedUser)
	assert.Nil(t, capturedOrg)
}

func TestDeleteMemory_ServiceError(t *testing.T) {
	service := &mockMemoryService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			return errors.New("delete failed")
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "test@example.com"}
	router := setupMemoryRouter(service, user, 0)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodDelete, "/api/v1/memories/55")
}

func TestDeleteMemory_WithOrg(t *testing.T) {
	var capturedOrg *int32
	service := &mockMemoryService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			capturedOrg = orgID
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 7, Email: "test@example.com"}
	router := setupMemoryRouter(service, user, 42)

	handlertest.ServeStatus(t, router, http.StatusNoContent, http.MethodDelete, "/api/v1/memories/55")
	require.NotNil(t, capturedOrg)
	assert.Equal(t, int32(42), *capturedOrg)
}

func TestMemoryEndpointsRejectInvalidAuthIDsBeforeService(t *testing.T) {
	called := false
	service := &mockMemoryService{
		getFunc: func(ctx context.Context, userID int32, orgID *int32) ([]corememories.MemoryRecord, error) {
			called = true
			return nil, nil
		},
		saveFunc: func(ctx context.Context, userID int32, orgID *int32, content string, memoryType string) error {
			called = true
			return nil
		},
		updateFunc: func(ctx context.Context, input corememories.UpdateMemoryInput) (corememories.MemoryRecord, error) {
			called = true
			return corememories.MemoryRecord{}, nil
		},
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			called = true
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: math.MaxInt32 + 1}
	router := setupMemoryRouter(service, user, 0)

	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list", method: http.MethodGet, path: "/api/v1/memories"},
		{name: "create", method: http.MethodPost, path: "/api/v1/memories", body: `{"content":"remember","type":"fact"}`},
		{name: "update", method: http.MethodPatch, path: "/api/v1/memories/1", body: `{"content":"updated","type":"fact"}`},
		{name: "delete", method: http.MethodDelete, path: "/api/v1/memories/1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, http.StatusBadRequest, resp.Code)
		})
	}
	assert.False(t, called)
}

func TestMemoryEndpointsRejectInvalidOrganizationIDBeforeService(t *testing.T) {
	called := false
	service := &mockMemoryService{
		getFunc: func(ctx context.Context, userID int32, orgID *int32) ([]corememories.MemoryRecord, error) {
			called = true
			return nil, nil
		},
	}
	router := setupMemoryRouter(service, &auth.AuthenticatedUser{ID: 10}, -1)

	handlertest.ServeStatus(t, router, http.StatusBadRequest, http.MethodGet, "/api/v1/memories")
	assert.False(t, called)
}
