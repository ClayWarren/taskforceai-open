package projects

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
	"github.com/TaskForceAI/core/pkg/projects"
	"github.com/TaskForceAI/go-core/internal/handlertest"
)

type mockProjectService struct {
	listFunc   func(ctx context.Context, userID int32, orgID *int32) ([]projects.Project, error)
	createFunc func(ctx context.Context, input projects.CreateProjectInput) (*projects.Project, error)
	deleteFunc func(ctx context.Context, id int32, userID int32, orgID *int32) error
}

func (m *mockProjectService) GetUserProjects(ctx context.Context, userID int32, orgID *int32) ([]projects.Project, error) {
	if m.listFunc != nil {
		return m.listFunc(ctx, userID, orgID)
	}
	return nil, nil
}

func (m *mockProjectService) ListProjects(ctx context.Context, userID int32) ([]projects.Project, error) {
	return m.GetUserProjects(ctx, userID, nil)
}

func (m *mockProjectService) CreateProject(ctx context.Context, input projects.CreateProjectInput) (*projects.Project, error) {
	if m.createFunc != nil {
		return m.createFunc(ctx, input)
	}
	return &projects.Project{}, nil
}

func (m *mockProjectService) DeleteProject(ctx context.Context, id int32, userID int32, orgID *int32) error {
	if m.deleteFunc != nil {
		return m.deleteFunc(ctx, id, userID, orgID)
	}
	return nil
}

func setupProjectsRouter(service *mockProjectService, user *auth.AuthenticatedUser, orgID int) *chi.Mux {
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

func TestListProjects_Success(t *testing.T) {
	service := &mockProjectService{
		listFunc: func(ctx context.Context, userID int32, orgID *int32) ([]projects.Project, error) {
			return []projects.Project{{ID: 1, Name: "Alpha"}}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 10, Email: "test@example.com"}
	router := setupProjectsRouter(service, user, 0)

	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/projects")

	var body []ProjectResponse
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)
	require.Len(t, body, 1)
	assert.Equal(t, int32(1), body[0].ID)
}

func TestListProjects_ServiceError(t *testing.T) {
	service := &mockProjectService{
		listFunc: func(ctx context.Context, userID int32, orgID *int32) ([]projects.Project, error) {
			return nil, errors.New("fail")
		},
	}

	user := &auth.AuthenticatedUser{ID: 10, Email: "test@example.com"}
	router := setupProjectsRouter(service, user, 0)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodGet, "/api/v1/projects")
}

func TestListProjects_WithOrgID(t *testing.T) {
	var capturedOrg *int32
	service := &mockProjectService{
		listFunc: func(ctx context.Context, userID int32, orgID *int32) ([]projects.Project, error) {
			capturedOrg = orgID
			return []projects.Project{}, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 10}
	router := setupProjectsRouter(service, user, 55)
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/projects")
	require.NotNil(t, capturedOrg)
	assert.Equal(t, int32(55), *capturedOrg)
}

func TestCreateProject_Success(t *testing.T) {
	service := &mockProjectService{
		createFunc: func(ctx context.Context, input projects.CreateProjectInput) (*projects.Project, error) {
			if input.Name != "Alpha" {
				return nil, errors.New("bad input")
			}
			return &projects.Project{ID: 5, Name: input.Name}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 10, Email: "test@example.com"}
	router := setupProjectsRouter(service, user, 0)

	reqBody := `{"name":"Alpha","description":"desc","custom_instructions":"guide","icon":"icon","color":"#ffffff","tags":[]}`
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPost, "/api/v1/projects", strings.NewReader(reqBody))
}

func TestCreateProject_ServiceError(t *testing.T) {
	service := &mockProjectService{
		createFunc: func(ctx context.Context, input projects.CreateProjectInput) (*projects.Project, error) {
			return nil, errors.New("fail")
		},
	}

	user := &auth.AuthenticatedUser{ID: 10, Email: "test@example.com"}
	router := setupProjectsRouter(service, user, 0)

	reqBody := `{"name":"Alpha","description":"desc","custom_instructions":"guide","icon":"icon","color":"#ffffff","tags":[]}`
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodPost, "/api/v1/projects", strings.NewReader(reqBody))
}

func TestCreateProject_WithOrgID(t *testing.T) {
	var capturedOrg *int32
	service := &mockProjectService{
		createFunc: func(ctx context.Context, input projects.CreateProjectInput) (*projects.Project, error) {
			capturedOrg = input.OrganizationID
			return &projects.Project{ID: 1, Name: input.Name}, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 10}
	router := setupProjectsRouter(service, user, 66)
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPost, "/api/v1/projects", strings.NewReader(`{"name":"test"}`))
	require.NotNil(t, capturedOrg)
	assert.Equal(t, int32(66), *capturedOrg)
}

func TestDeleteProject_Success(t *testing.T) {
	var capturedID int32
	service := &mockProjectService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			capturedID = id
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 10, Email: "test@example.com"}
	router := setupProjectsRouter(service, user, 0)

	handlertest.ServeStatus(t, router, http.StatusNoContent, http.MethodDelete, "/api/v1/projects/22")
	assert.Equal(t, int32(22), capturedID)
}

func TestDeleteProject_ServiceError(t *testing.T) {
	service := &mockProjectService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			return errors.New("fail")
		},
	}

	user := &auth.AuthenticatedUser{ID: 10, Email: "test@example.com"}
	router := setupProjectsRouter(service, user, 0)

	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodDelete, "/api/v1/projects/22")
}

func TestDeleteProject_WithOrgID(t *testing.T) {
	var capturedOrg *int32
	service := &mockProjectService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			capturedOrg = orgID
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 10}
	router := setupProjectsRouter(service, user, 77)
	handlertest.ServeStatus(t, router, http.StatusNoContent, http.MethodDelete, "/api/v1/projects/1")
	require.NotNil(t, capturedOrg)
	assert.Equal(t, int32(77), *capturedOrg)
}

func TestDeleteProject_IDOutOfRange(t *testing.T) {
	called := false
	service := &mockProjectService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			called = true
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 10}
	router := setupProjectsRouter(service, user, 0)

	handlertest.ServeStatus(t, router, http.StatusUnprocessableEntity, http.MethodDelete, "/api/v1/projects/4294967297")
	assert.False(t, called)
}

func TestDeleteProject_NonPositiveID(t *testing.T) {
	called := false
	service := &mockProjectService{
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			called = true
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 10}
	router := setupProjectsRouter(service, user, 0)

	for _, path := range []string{"/api/v1/projects/0", "/api/v1/projects/-1"} {
		handlertest.ServeStatus(t, router, http.StatusUnprocessableEntity, http.MethodDelete, path)
	}
	assert.False(t, called)
}

func TestProjectEndpointsRejectInvalidAuthIDsBeforeService(t *testing.T) {
	called := false
	service := &mockProjectService{
		listFunc: func(ctx context.Context, userID int32, orgID *int32) ([]projects.Project, error) {
			called = true
			return nil, nil
		},
		createFunc: func(ctx context.Context, input projects.CreateProjectInput) (*projects.Project, error) {
			called = true
			return &projects.Project{}, nil
		},
		deleteFunc: func(ctx context.Context, id int32, userID int32, orgID *int32) error {
			called = true
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: math.MaxInt32 + 1}
	router := setupProjectsRouter(service, user, 0)

	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list", method: http.MethodGet, path: "/api/v1/projects"},
		{name: "create", method: http.MethodPost, path: "/api/v1/projects", body: `{"name":"Alpha"}`},
		{name: "delete", method: http.MethodDelete, path: "/api/v1/projects/1"},
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

func TestProjectEndpointsRejectInvalidOrganizationIDBeforeService(t *testing.T) {
	called := false
	service := &mockProjectService{
		listFunc: func(ctx context.Context, userID int32, orgID *int32) ([]projects.Project, error) {
			called = true
			return nil, nil
		},
	}
	router := setupProjectsRouter(service, &auth.AuthenticatedUser{ID: 10}, -1)

	handlertest.ServeStatus(t, router, http.StatusBadRequest, http.MethodGet, "/api/v1/projects")
	assert.False(t, called)
}
