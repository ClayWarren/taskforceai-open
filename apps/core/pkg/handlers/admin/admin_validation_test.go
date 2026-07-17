package admin

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/go-core/pkg/admin"
)

func TestAdminUpdateUser_RequiresValidTargetIdentity(t *testing.T) {
	called := false
	mockRepo := &mockAdminRepo{
		updateUserPlanFunc: func(ctx context.Context, email, plan string) (*admin.AdminDashboardUser, error) {
			called = true
			return nil, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"userId": null, "email": "not-an-email", "plan": "pro", "isAdmin": null}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.False(t, called)
}

func TestAdminUpdateUser_BadRequest(t *testing.T) {
	mockRepo := &mockAdminRepo{}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"userId": null, "email": "user@example.com", "plan": null, "isAdmin": null}` // No plan or isAdmin
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Reauthenticated", "true")
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestAdminUpdateUser_StaleSession(t *testing.T) {
	mockRepo := &mockAdminRepo{}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	stale := time.Now().Add(-2 * time.Hour)
	router := setupAdminTestRouterWithIssuedAt(mockRepo, user, &stale)

	body := `{"userId": null, "email": "user@example.com", "plan": "pro", "isAdmin": null}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestAdminListUsers_DBError(t *testing.T) {
	mockRepo := &mockAdminRepo{
		listUsersFunc: func(ctx context.Context, limit, offset int) (*admin.AdminUsersPage, error) {
			return nil, errors.New("db error")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)
	resp := doGet(router, "/api/v1/admin/users")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestAdminGetInsights_Error(t *testing.T) {
	mockRepo := &mockAdminRepo{
		fetchInsightsDataFunc: func(ctx context.Context, since24h, since5m time.Time) (*admin.AdminInsightsData, error) {
			return nil, errors.New("db error")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)
	resp := doGet(router, "/api/v1/admin/insights")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestAdminUpdateOrganization_Error(t *testing.T) {
	mockRepo := &mockAdminRepo{
		updateOrganizationFunc: func(ctx context.Context, orgID int32, plan string, rpmQuota int, tokenQuota int64, workosID string) error {
			return errors.New("db error")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)
	body := `{"plan": "pro", "rpmQuota": 100, "tokensQuotaMonth": 100000, "workosOrgId": "org_abc"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/orgs/123", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Reauthenticated", "true")
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestAdminCreateIncident_Error(t *testing.T) {
	mockRepo := &mockAdminRepo{
		createIncidentFunc: func(ctx context.Context, serviceID, status, message string) error {
			return errors.New("db error")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)
	body := `{"serviceId": "api", "status": "degraded", "message": "Investigating"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/incidents", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestAdminUpdateOrganization_RPMQuotaOutOfRange(t *testing.T) {
	called := false
	mockRepo := &mockAdminRepo{
		updateOrganizationFunc: func(ctx context.Context, orgID int32, plan string, rpmQuota int, tokenQuota int64, workosID string) error {
			called = true
			return nil
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"plan":"pro","rpmQuota":3000000000,"tokensQuotaMonth":100000,"workosOrgId":"org_abc"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/orgs/123", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusUnprocessableEntity, resp.Code)
	assert.False(t, called)
}

func TestAdminUpdateUser_Error(t *testing.T) {
	mockRepo := &mockAdminRepo{
		updateUserPlanFunc: func(ctx context.Context, email, plan string) (*admin.AdminDashboardUser, error) {
			return nil, errors.New("db error")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)
	body := `{"userId": null, "email": "user@example.com", "plan": "pro", "isAdmin": null}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Reauthenticated", "true")
	resp := serve(router, req)
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestAdminListIncidents_Error(t *testing.T) {
	mockRepo := &mockAdminRepo{
		listIncidentsFunc: func(ctx context.Context, limit int) ([]admin.AdminIncident, error) {
			return nil, errors.New("db error")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)
	resp := doGet(router, "/api/v1/admin/incidents")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestAdminListOrganizations_Error(t *testing.T) {
	mockRepo := &mockAdminRepo{
		listOrganizationsFunc: func(ctx context.Context) ([]admin.AdminOrgRecord, error) {
			return nil, errors.New("db error")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)
	resp := doGet(router, "/api/v1/admin/orgs")
	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}
