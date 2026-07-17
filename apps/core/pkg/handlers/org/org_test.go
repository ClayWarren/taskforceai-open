package org

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	"github.com/TaskForceAI/core/pkg/identity"
	"github.com/TaskForceAI/go-core/internal/handlertest"
)

type mockIdentityService struct {
	listFunc        func(ctx context.Context, orgID, userID int32) ([]identity.MemberRecord, error)
	exportFunc      func(ctx context.Context, orgID, userID int32) (any, error)
	getSettingsFunc func(ctx context.Context, orgID, userID int32) (*identity.OrganizationSettings, error)
	updateSettings  func(ctx context.Context, orgID, userID int32, settings identity.OrganizationSettings) error
	updateRoleFunc  func(ctx context.Context, orgID, targetUserID, actorUserID int32, role identity.OrganizationRole) error
	removeFunc      func(ctx context.Context, orgID, targetUserID, actorUserID int32) error
}

func (m *mockIdentityService) ListMembers(ctx context.Context, orgID, userID int32) ([]identity.MemberRecord, error) {
	return m.listFunc(ctx, orgID, userID)
}

func (m *mockIdentityService) GetSettings(ctx context.Context, orgID, userID int32) (*identity.OrganizationSettings, error) {
	return m.getSettingsFunc(ctx, orgID, userID)
}

func (m *mockIdentityService) UpdateSettings(ctx context.Context, orgID, userID int32, settings identity.OrganizationSettings) error {
	return m.updateSettings(ctx, orgID, userID, settings)
}

func (m *mockIdentityService) UpdateMemberRole(ctx context.Context, orgID, targetUserID, actorUserID int32, role identity.OrganizationRole) error {
	return m.updateRoleFunc(ctx, orgID, targetUserID, actorUserID, role)
}

func (m *mockIdentityService) RemoveMember(ctx context.Context, orgID, targetUserID, actorUserID int32) error {
	return m.removeFunc(ctx, orgID, targetUserID, actorUserID)
}

func (m *mockIdentityService) ExportOrganizationData(ctx context.Context, orgID, userID int32) (any, error) {
	return m.exportFunc(ctx, orgID, userID)
}

func setupOrgRouter(service identity.Service, user *auth.AuthenticatedUser, orgID int) *chi.Mux {
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

func TestListMembers_RequiresOrg(t *testing.T) {
	service := &mockIdentityService{
		listFunc: func(ctx context.Context, orgID, userID int32) ([]identity.MemberRecord, error) {
			return nil, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupOrgRouter(service, user, 0)

	handlertest.ServeStatus(t, router, http.StatusForbidden, http.MethodGet, "/api/v1/org/members")
}

func TestListMembers_Success(t *testing.T) {
	service := &mockIdentityService{
		listFunc: func(ctx context.Context, orgID, userID int32) ([]identity.MemberRecord, error) {
			return []identity.MemberRecord{{UserID: 2, Email: "member@example.com"}}, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupOrgRouter(service, user, 99)

	resp := handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/org/members")

	var body []identity.MemberRecord
	err := json.Unmarshal(resp.Body.Bytes(), &body)
	require.NoError(t, err)
	require.Len(t, body, 1)
	assert.Equal(t, int32(2), body[0].UserID)
}

func TestExportData_Success(t *testing.T) {
	service := &mockIdentityService{
		exportFunc: func(ctx context.Context, orgID, userID int32) (any, error) {
			return map[string]string{"status": "ok"}, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupOrgRouter(service, user, 10)

	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/org/export")
}

func TestGetSettings_Success(t *testing.T) {
	service := &mockIdentityService{
		getSettingsFunc: func(ctx context.Context, orgID, userID int32) (*identity.OrganizationSettings, error) {
			return &identity.OrganizationSettings{AllowPublicProjects: true, DefaultRole: "member"}, nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupOrgRouter(service, user, 10)

	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodGet, "/api/v1/org/settings")
}

func TestUpdateSettings_Success(t *testing.T) {
	service := &mockIdentityService{
		updateSettings: func(ctx context.Context, orgID, userID int32, settings identity.OrganizationSettings) error {
			if !settings.AllowPublicProjects {
				return errors.New("bad settings")
			}
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupOrgRouter(service, user, 10)

	body := `{"allowPublicProjects":true,"defaultRole":"member"}`
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPatch, "/api/v1/org/settings", strings.NewReader(body))
}

func TestUpdateMemberRole_Unauthorized(t *testing.T) {
	service := &mockIdentityService{
		updateRoleFunc: func(ctx context.Context, orgID, targetUserID, actorUserID int32, role identity.OrganizationRole) error {
			return identity.ErrUnauthorized
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupOrgRouter(service, user, 10)

	body := `{"role":"admin"}`
	handlertest.ServeStatus(t, router, http.StatusForbidden, http.MethodPatch, "/api/v1/org/members/2", strings.NewReader(body))
}

func TestUpdateMemberRole_InvalidRole(t *testing.T) {
	service := &mockIdentityService{
		updateRoleFunc: func(ctx context.Context, orgID, targetUserID, actorUserID int32, role identity.OrganizationRole) error {
			return identity.ErrInvalidRole
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupOrgRouter(service, user, 10)

	body := `{"role":"admin"}`
	handlertest.ServeStatus(t, router, http.StatusBadRequest, http.MethodPatch, "/api/v1/org/members/2", strings.NewReader(body))
}

func TestUpdateMemberRole_OwnerPolicyErrors(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
	}{
		{name: "protected owner", err: identity.ErrOwnerRoleProtected, status: http.StatusForbidden},
		{name: "last owner", err: identity.ErrCannotRemoveLastOwner, status: http.StatusConflict},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := &mockIdentityService{
				updateRoleFunc: func(ctx context.Context, orgID, targetUserID, actorUserID int32, role identity.OrganizationRole) error {
					return tt.err
				},
			}
			router := setupOrgRouter(service, &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}, 10)
			handlertest.ServeStatus(t, router, tt.status, http.MethodPatch, "/api/v1/org/members/2", strings.NewReader(`{"role":"member"}`))
		})
	}
}

func TestUpdateMemberRole_Success(t *testing.T) {
	service := &mockIdentityService{
		updateRoleFunc: func(ctx context.Context, orgID, targetUserID, actorUserID int32, role identity.OrganizationRole) error {
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupOrgRouter(service, user, 10)

	body := `{"role":"admin"}`
	handlertest.ServeStatus(t, router, http.StatusOK, http.MethodPatch, "/api/v1/org/members/2", strings.NewReader(body))
}

func TestRemoveMember_Unauthorized(t *testing.T) {
	service := &mockIdentityService{
		removeFunc: func(ctx context.Context, orgID, targetUserID, actorUserID int32) error {
			return identity.ErrCannotRemoveSelf
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupOrgRouter(service, user, 10)

	handlertest.ServeStatus(t, router, http.StatusForbidden, http.MethodDelete, "/api/v1/org/members/2")
}

func TestRemoveMember_Success(t *testing.T) {
	service := &mockIdentityService{
		removeFunc: func(ctx context.Context, orgID, targetUserID, actorUserID int32) error {
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}
	router := setupOrgRouter(service, user, 10)

	handlertest.ServeStatus(t, router, http.StatusNoContent, http.MethodDelete, "/api/v1/org/members/2")
}

func TestRemoveMember_OwnerPolicyErrors(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		status int
	}{
		{name: "protected owner", err: identity.ErrOwnerRoleProtected, status: http.StatusForbidden},
		{name: "last owner", err: identity.ErrCannotRemoveLastOwner, status: http.StatusConflict},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := &mockIdentityService{
				removeFunc: func(ctx context.Context, orgID, targetUserID, actorUserID int32) error {
					return tt.err
				},
			}
			router := setupOrgRouter(service, &auth.AuthenticatedUser{ID: 1, Email: "test@example.com"}, 10)
			handlertest.ServeStatus(t, router, tt.status, http.MethodDelete, "/api/v1/org/members/2")
		})
	}
}

var orgEndpointCases = []handlertest.Endpoint{
	{Method: http.MethodGet, Path: "/api/v1/org/members"},
	{Method: http.MethodGet, Path: "/api/v1/org/export"},
	{Method: http.MethodGet, Path: "/api/v1/org/settings"},
	{Method: http.MethodPatch, Path: "/api/v1/org/settings", Body: `{"allowPublicProjects":true,"defaultRole":"member"}`},
	{Method: http.MethodPatch, Path: "/api/v1/org/members/2", Body: `{"role":"admin"}`},
	{Method: http.MethodDelete, Path: "/api/v1/org/members/2"},
}

func assertOrgEndpointStatuses(t *testing.T, router http.Handler, expectedStatus int, endpoints []handlertest.Endpoint) {
	t.Helper()
	for _, endpoint := range endpoints {
		t.Run(endpoint.Method+" "+endpoint.Path, func(t *testing.T) {
			handlertest.ServeEndpointStatus(t, router, expectedStatus, endpoint)
		})
	}
}

func orgEndpointCasesWithoutRoleUpdate() []handlertest.Endpoint {
	endpoints := append([]handlertest.Endpoint{}, orgEndpointCases[:4]...)
	return append(endpoints, orgEndpointCases[5])
}

func TestOrgEndpoints_RequiresContext(t *testing.T) {
	service := &mockIdentityService{}
	user := &auth.AuthenticatedUser{ID: 1}
	router := setupOrgRouter(service, user, 0) // No OrgID
	assertOrgEndpointStatuses(t, router, http.StatusForbidden, orgEndpointCases)
}

func TestOrgEndpoints_ServiceError(t *testing.T) {
	service := &mockIdentityService{
		listFunc: func(ctx context.Context, orgID, userID int32) ([]identity.MemberRecord, error) {
			return nil, errors.New("fail")
		},
		exportFunc: func(ctx context.Context, orgID, userID int32) (any, error) {
			return nil, errors.New("fail")
		},
		getSettingsFunc: func(ctx context.Context, orgID, userID int32) (*identity.OrganizationSettings, error) {
			return nil, errors.New("fail")
		},
		updateSettings: func(ctx context.Context, orgID, userID int32, settings identity.OrganizationSettings) error {
			return errors.New("fail")
		},
		removeFunc: func(ctx context.Context, orgID, targetUserID, actorUserID int32) error {
			return errors.New("fail")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1}
	router := setupOrgRouter(service, user, 10)

	assertOrgEndpointStatuses(t, router, http.StatusInternalServerError, orgEndpointCasesWithoutRoleUpdate())
}

func TestOrgEndpoints_UnauthorizedErrorMapping(t *testing.T) {
	service := &mockIdentityService{
		listFunc: func(ctx context.Context, orgID, userID int32) ([]identity.MemberRecord, error) {
			return nil, identity.ErrUnauthorized
		},
		exportFunc: func(ctx context.Context, orgID, userID int32) (any, error) {
			return nil, identity.ErrUnauthorized
		},
		getSettingsFunc: func(ctx context.Context, orgID, userID int32) (*identity.OrganizationSettings, error) {
			return nil, identity.ErrUnauthorized
		},
		updateSettings: func(ctx context.Context, orgID, userID int32, settings identity.OrganizationSettings) error {
			return identity.ErrUnauthorized
		},
		removeFunc: func(ctx context.Context, orgID, targetUserID, actorUserID int32) error {
			return identity.ErrUnauthorized
		},
	}
	user := &auth.AuthenticatedUser{ID: 1}
	router := setupOrgRouter(service, user, 10)

	assertOrgEndpointStatuses(t, router, http.StatusForbidden, orgEndpointCasesWithoutRoleUpdate())
}

func TestUpdateMemberRole_ServiceError(t *testing.T) {
	service := &mockIdentityService{
		updateRoleFunc: func(ctx context.Context, orgID, targetUserID, actorUserID int32, role identity.OrganizationRole) error {
			return errors.New("fail")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1}
	router := setupOrgRouter(service, user, 10)

	body := `{"role":"admin"}`
	handlertest.ServeStatus(t, router, http.StatusInternalServerError, http.MethodPatch, "/api/v1/org/members/2", strings.NewReader(body))
}
