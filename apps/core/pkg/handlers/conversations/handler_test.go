package conversations

import (
	"context"
	"encoding/json"
	"errors"
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
	"github.com/TaskForceAI/core/pkg/conversations"
)

type mockConversationService struct {
	listFunc   func(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversations.ConversationsPage, error)
	getFunc    func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error)
	createFunc func(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error)
	updateFunc func(ctx context.Context, userID string, orgID *int, conversationID int, input conversations.ConversationUpdateInput) (bool, error)
	deleteFunc func(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error)
}

func (m *mockConversationService) ListConversations(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversations.ConversationsPage, error) {
	return m.listFunc(ctx, userID, orgID, limit, offset)
}

func (m *mockConversationService) GetConversation(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
	return m.getFunc(ctx, userID, orgID, conversationID)
}

func (m *mockConversationService) CreateConversation(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error) {
	return m.createFunc(ctx, input)
}

func (m *mockConversationService) UpdateConversation(ctx context.Context, userID string, orgID *int, conversationID int, input conversations.ConversationUpdateInput) (bool, error) {
	return m.updateFunc(ctx, userID, orgID, conversationID, input)
}

func (m *mockConversationService) DeleteConversation(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error) {
	return m.deleteFunc(ctx, userID, orgID, conversationID)
}

func setupConversationRouter(service conversations.Service, user *auth.AuthenticatedUser, orgID int) *chi.Mux {
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

func resetConversationCopy(t *testing.T) {
	t.Helper()
	originalCopy := copyConversationValue
	t.Cleanup(func() {
		copyConversationValue = originalCopy
	})
}

func TestRegisterHandlers_ListConversations_Success(t *testing.T) {
	var capturedOrg *int
	service := &mockConversationService{
		listFunc: func(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversations.ConversationsPage, error) {
			capturedOrg = orgID
			return &conversations.ConversationsPage{
				Conversations: []conversations.ConversationApiView{{ID: 1}},
				Total:         1,
				Limit:         50,
				Offset:        0,
				HasMore:       false,
			}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 21)

	serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/conversations")
	require.NotNil(t, capturedOrg)
	assert.Equal(t, 21, *capturedOrg)
}

func TestRegisterHandlers_RejectInvalidResolvedUserID(t *testing.T) {
	service := &mockConversationService{}
	user := &auth.AuthenticatedUser{ID: 1 << 40}
	router := setupConversationRouter(service, user, 0)
	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list", method: http.MethodGet, path: "/api/v1/conversations"},
		{name: "create", method: http.MethodPost, path: "/api/v1/conversations", body: `{"title":"hello"}`},
		{name: "get", method: http.MethodGet, path: "/api/v1/conversations/1"},
		{name: "update", method: http.MethodPut, path: "/api/v1/conversations/1", body: `{"title":"new"}`},
		{name: "delete", method: http.MethodDelete, path: "/api/v1/conversations/1"},
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
}

func TestRegisterHandlers_ConversationMappingErrors(t *testing.T) {
	resetConversationCopy(t)
	copyConversationValue = func(toValue any, fromValue any) error {
		return errors.New("copy failed")
	}

	tests := []struct {
		name    string
		method  string
		path    string
		body    string
		service *mockConversationService
	}{
		{
			name:   "list",
			method: http.MethodGet,
			path:   "/api/v1/conversations",
			service: &mockConversationService{
				listFunc: func(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversations.ConversationsPage, error) {
					return &conversations.ConversationsPage{Conversations: []conversations.ConversationApiView{{ID: 1}}}, nil
				},
			},
		},
		{
			name:   "get",
			method: http.MethodGet,
			path:   "/api/v1/conversations/1",
			service: &mockConversationService{
				getFunc: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
					return &conversations.ConversationApiView{ID: conversationID}, nil
				},
			},
		},
		{
			name:   "update",
			method: http.MethodPut,
			path:   "/api/v1/conversations/1",
			body:   `{"title":"new"}`,
			service: &mockConversationService{
				updateFunc: func(ctx context.Context, userID string, orgID *int, conversationID int, input conversations.ConversationUpdateInput) (bool, error) {
					t.Fatal("update should not be called after mapping failure")
					return false, nil
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := setupConversationRouter(tt.service, &auth.AuthenticatedUser{ID: 3}, 0)
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, http.StatusInternalServerError, resp.Code)
		})
	}
}

func TestRegisterHandlers_ListConversations_DoesNotFanOutPerConversation(t *testing.T) {
	listCalls := 0
	getCalls := 0
	service := &mockConversationService{
		listFunc: func(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversations.ConversationsPage, error) {
			listCalls++
			return &conversations.ConversationsPage{
				Conversations: []conversations.ConversationApiView{
					{ID: 1, UserInput: "first"},
					{ID: 2, UserInput: "second"},
					{ID: 3, UserInput: "third"},
				},
				Total:   3,
				Limit:   limit,
				Offset:  offset,
				HasMore: false,
			}, nil
		},
		getFunc: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			getCalls++
			return nil, errors.New("unexpected get conversation call while listing")
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 0)

	serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/conversations?limit=3&offset=0")
	assert.Equal(t, 1, listCalls)
	assert.Equal(t, 0, getCalls)
}

func TestRegisterHandlers_CreateConversation_DefaultAgentCount(t *testing.T) {
	var captured conversations.ConversationCreateInput
	service := &mockConversationService{
		createFunc: func(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error) {
			captured = input
			return &conversations.ConversationApiView{ID: 7}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 0)

	serveJSONRequest(t, router, http.StatusOK, http.MethodPost, "/api/v1/conversations", strings.NewReader(`{"title":"hello"}`))
	assert.Equal(t, 4, captured.AgentCount)
}

func TestRegisterHandlers_GetConversation_Error(t *testing.T) {
	service := &mockConversationService{
		getFunc: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			return nil, errors.New("fail")
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 0)

	serveRequest(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/conversations/1")
}

func TestRegisterHandlers_GetConversation_NotFound(t *testing.T) {
	service := &mockConversationService{
		getFunc: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			return nil, conversations.ErrConversationNotFound
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 0)

	serveRequest(t, router, http.StatusNotFound, http.MethodGet, "/api/v1/conversations/1")
}

func TestRegisterHandlers_UpdateConversation_Success(t *testing.T) {
	service := &mockConversationService{
		updateFunc: func(ctx context.Context, userID string, orgID *int, conversationID int, input conversations.ConversationUpdateInput) (bool, error) {
			return true, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 0)

	body := `{"title":"new","result":"ok"}`
	serveJSONRequest(t, router, http.StatusOK, http.MethodPut, "/api/v1/conversations/1", strings.NewReader(body))
}

func TestRegisterHandlers_DeleteConversation_Success(t *testing.T) {
	service := &mockConversationService{
		deleteFunc: func(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error) {
			return true, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 0)

	serveRequest(t, router, http.StatusNoContent, http.MethodDelete, "/api/v1/conversations/1")
}

func TestRegisterHandlers_DeleteConversation_NotFound(t *testing.T) {
	service := &mockConversationService{
		deleteFunc: func(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error) {
			return false, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 0)

	serveRequest(t, router, http.StatusNotFound, http.MethodDelete, "/api/v1/conversations/1")
}

func TestRegisterHandlers_GetConversation_Success(t *testing.T) {
	service := &mockConversationService{
		getFunc: func(ctx context.Context, userID string, orgID *int, conversationID int) (*conversations.ConversationApiView, error) {
			return &conversations.ConversationApiView{ID: conversationID, UserInput: "hi"}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 0)

	resp := serveRequest(t, router, http.StatusOK, http.MethodGet, "/api/v1/conversations/1")

	var body ConversationResponse
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)
	assert.Equal(t, 1, body.ID)
}

func TestRegisterHandlers_CreateConversation_AgentCountClamping(t *testing.T) {
	var captured conversations.ConversationCreateInput
	service := &mockConversationService{
		createFunc: func(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error) {
			captured = input
			return &conversations.ConversationApiView{ID: 7}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 0)

	serveJSONRequest(t, router, http.StatusOK, http.MethodPost, "/api/v1/conversations", strings.NewReader(`{"title":"hello","agentCount":100}`))
	assert.Equal(t, 50, captured.AgentCount) // Clamped
}

func TestRegisterHandlers_CreateConversation_WithExecutionTime(t *testing.T) {
	var captured conversations.ConversationCreateInput
	service := &mockConversationService{
		createFunc: func(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error) {
			captured = input
			return &conversations.ConversationApiView{ID: 7}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3, Email: "test@example.com"}
	router := setupConversationRouter(service, user, 0)

	serveJSONRequest(t, router, http.StatusOK, http.MethodPost, "/api/v1/conversations", strings.NewReader(`{"title":"hello","executionTime":123}`))
	require.NotNil(t, captured.ExecutionTime)
	assert.Equal(t, 123, *captured.ExecutionTime)
}

func TestRegisterHandlers_CreateConversation_WithOrgID(t *testing.T) {
	var captured conversations.ConversationCreateInput
	service := &mockConversationService{
		createFunc: func(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error) {
			captured = input
			return &conversations.ConversationApiView{ID: 7}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3}
	router := setupConversationRouter(service, user, 88)

	serveJSONRequest(t, router, http.StatusOK, http.MethodPost, "/api/v1/conversations", strings.NewReader(`{"title":"hello"}`))
	require.NotNil(t, captured.OrganizationID)
	assert.Equal(t, 88, *captured.OrganizationID)
}

func TestRegisterHandlers_UpdateConversation_WithOrgID(t *testing.T) {
	var capturedOrg *int
	service := &mockConversationService{
		updateFunc: func(ctx context.Context, userID string, orgID *int, conversationID int, input conversations.ConversationUpdateInput) (bool, error) {
			capturedOrg = orgID
			return true, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 3}
	router := setupConversationRouter(service, user, 99)

	serveJSONRequest(t, router, http.StatusOK, http.MethodPut, "/api/v1/conversations/1", strings.NewReader(`{"title":"new"}`))
	require.NotNil(t, capturedOrg)
	assert.Equal(t, 99, *capturedOrg)
}

func TestRegisterHandlers_ListConversations_Error(t *testing.T) {
	service := &mockConversationService{
		listFunc: func(ctx context.Context, userID string, orgID *int, limit, offset int) (*conversations.ConversationsPage, error) {
			return nil, errors.New("list fail")
		},
	}
	user := &auth.AuthenticatedUser{ID: 3}
	router := setupConversationRouter(service, user, 0)
	serveRequest(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/conversations")
}

func TestRegisterHandlers_CreateConversation_Error(t *testing.T) {
	service := &mockConversationService{
		createFunc: func(ctx context.Context, input conversations.ConversationCreateInput) (*conversations.ConversationApiView, error) {
			return nil, errors.New("create fail")
		},
	}
	user := &auth.AuthenticatedUser{ID: 3}
	router := setupConversationRouter(service, user, 0)
	serveJSONRequest(t, router, http.StatusInternalServerError, http.MethodPost, "/api/v1/conversations", strings.NewReader(`{"title":"hello"}`))
}

func TestRegisterHandlers_UpdateConversation_Error(t *testing.T) {
	service := &mockConversationService{
		updateFunc: func(ctx context.Context, userID string, orgID *int, conversationID int, input conversations.ConversationUpdateInput) (bool, error) {
			return false, errors.New("update fail")
		},
	}
	user := &auth.AuthenticatedUser{ID: 3}
	router := setupConversationRouter(service, user, 0)
	serveJSONRequest(t, router, http.StatusInternalServerError, http.MethodPut, "/api/v1/conversations/1", strings.NewReader(`{"title":"new"}`))
}

func TestRegisterHandlers_DeleteConversation_Error(t *testing.T) {
	service := &mockConversationService{
		deleteFunc: func(ctx context.Context, userID string, orgID *int, conversationID int) (bool, error) {
			return false, errors.New("delete fail")
		},
	}
	user := &auth.AuthenticatedUser{ID: 3}
	router := setupConversationRouter(service, user, 0)
	serveRequest(t, router, http.StatusInternalServerError, http.MethodDelete, "/api/v1/conversations/1")
}
