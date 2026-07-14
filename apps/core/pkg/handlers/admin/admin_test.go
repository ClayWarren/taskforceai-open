package admin

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/TaskForceAI/adapters/pkg/auth"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	coreidentity "github.com/TaskForceAI/core/pkg/identity"
	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/go-core/pkg/admin"
)

// mockAdminRepo implements admin.Repository for testing
type mockAdminRepo struct {
	getDashboardCountsFunc  func(ctx context.Context) (*admin.AdminDashboardCounts, error)
	listUsersFunc           func(ctx context.Context, limit, offset int) (*admin.AdminUsersPage, error)
	listUsersFilteredFunc   func(ctx context.Context, filters admin.AdminUserFilters, limit, offset int) (*admin.AdminUsersPage, error)
	listAuditLogsFunc       func(ctx context.Context, filters admin.AuditLogFilters, limit, offset int) (*admin.AuditLogPage, error)
	fetchInsightsDataFunc   func(ctx context.Context, since24h, since5m time.Time) (*admin.AdminInsightsData, error)
	listIncidentsFunc       func(ctx context.Context, limit int) ([]admin.AdminIncident, error)
	createIncidentFunc      func(ctx context.Context, serviceID, status, message string) error
	listOrganizationsFunc   func(ctx context.Context) ([]admin.AdminOrgRecord, error)
	updateOrganizationFunc  func(ctx context.Context, orgID int32, plan string, rpmQuota int, tokenQuota int64, workosID string) error
	updateUserPlanFunc      func(ctx context.Context, email, plan string) (*admin.AdminDashboardUser, error)
	updateUserPlanByIDFunc  func(ctx context.Context, id int32, plan string) (*admin.AdminDashboardUser, error)
	updateUserAdminFunc     func(ctx context.Context, email string, isAdmin bool) (*admin.AdminDashboardUser, error)
	updateUserAdminByIDFunc func(ctx context.Context, id int32, isAdmin bool) (*admin.AdminDashboardUser, error)
	updateUserFunc          func(ctx context.Context, input admin.AdminUserUpdate) error
	getUserByIDFunc         func(ctx context.Context, id int32) (*admin.AdminDashboardUser, error)
	findUserByEmailFunc     func(ctx context.Context, email string) (*admin.AdminAuditUser, error)
}

func (m *mockAdminRepo) GetDashboardCounts(ctx context.Context) (*admin.AdminDashboardCounts, error) {
	if m.getDashboardCountsFunc != nil {
		return m.getDashboardCountsFunc(ctx)
	}
	return &admin.AdminDashboardCounts{}, nil
}

func (m *mockAdminRepo) ListUsers(ctx context.Context, limit, offset int) (*admin.AdminUsersPage, error) {
	if m.listUsersFunc != nil {
		return m.listUsersFunc(ctx, limit, offset)
	}
	return &admin.AdminUsersPage{}, nil
}

func (m *mockAdminRepo) ListUsersFiltered(ctx context.Context, filters admin.AdminUserFilters, limit, offset int) (*admin.AdminUsersPage, error) {
	if m.listUsersFilteredFunc != nil {
		return m.listUsersFilteredFunc(ctx, filters, limit, offset)
	}
	return m.ListUsers(ctx, limit, offset)
}

func (m *mockAdminRepo) ListAuditLogs(ctx context.Context, filters admin.AuditLogFilters, limit, offset int) (*admin.AuditLogPage, error) {
	if m.listAuditLogsFunc != nil {
		return m.listAuditLogsFunc(ctx, filters, limit, offset)
	}
	return &admin.AuditLogPage{}, nil
}

func (m *mockAdminRepo) FetchInsightsData(ctx context.Context, since24h, since5m time.Time) (*admin.AdminInsightsData, error) {
	if m.fetchInsightsDataFunc != nil {
		return m.fetchInsightsDataFunc(ctx, since24h, since5m)
	}
	return &admin.AdminInsightsData{}, nil
}

func (m *mockAdminRepo) ListIncidents(ctx context.Context, limit int) ([]admin.AdminIncident, error) {
	if m.listIncidentsFunc != nil {
		return m.listIncidentsFunc(ctx, limit)
	}
	return []admin.AdminIncident{}, nil
}

func (m *mockAdminRepo) CreateIncident(ctx context.Context, serviceID, status, message string) error {
	if m.createIncidentFunc != nil {
		return m.createIncidentFunc(ctx, serviceID, status, message)
	}
	return nil
}

func (m *mockAdminRepo) ListOrganizations(ctx context.Context) ([]admin.AdminOrgRecord, error) {
	if m.listOrganizationsFunc != nil {
		return m.listOrganizationsFunc(ctx)
	}
	return []admin.AdminOrgRecord{}, nil
}

func (m *mockAdminRepo) UpdateOrganization(ctx context.Context, orgID int32, plan string, rpmQuota int, tokenQuota int64, workosID string) error {
	if m.updateOrganizationFunc != nil {
		return m.updateOrganizationFunc(ctx, orgID, plan, rpmQuota, tokenQuota, workosID)
	}
	return nil
}

func (m *mockAdminRepo) UpdateUserPlan(ctx context.Context, email, plan string) (*admin.AdminDashboardUser, error) {
	if m.updateUserPlanFunc != nil {
		return m.updateUserPlanFunc(ctx, email, plan)
	}
	return &admin.AdminDashboardUser{}, nil
}

func (m *mockAdminRepo) UpdateUserPlanByID(ctx context.Context, id int32, plan string) (*admin.AdminDashboardUser, error) {
	if m.updateUserPlanByIDFunc != nil {
		return m.updateUserPlanByIDFunc(ctx, id, plan)
	}
	return &admin.AdminDashboardUser{}, nil
}

func (m *mockAdminRepo) UpdateUserAdmin(ctx context.Context, email string, isAdmin bool) (*admin.AdminDashboardUser, error) {
	if m.updateUserAdminFunc != nil {
		return m.updateUserAdminFunc(ctx, email, isAdmin)
	}
	return &admin.AdminDashboardUser{}, nil
}

func (m *mockAdminRepo) UpdateUserAdminByID(ctx context.Context, id int32, isAdmin bool) (*admin.AdminDashboardUser, error) {
	if m.updateUserAdminByIDFunc != nil {
		return m.updateUserAdminByIDFunc(ctx, id, isAdmin)
	}
	return &admin.AdminDashboardUser{}, nil
}

func (m *mockAdminRepo) UpdateUser(ctx context.Context, input admin.AdminUserUpdate) error {
	if m.updateUserFunc != nil {
		return m.updateUserFunc(ctx, input)
	}
	if input.Plan != nil {
		if input.UserID != nil {
			if _, err := m.UpdateUserPlanByID(ctx, *input.UserID, *input.Plan); err != nil {
				return err
			}
		} else if _, err := m.UpdateUserPlan(ctx, input.Email, *input.Plan); err != nil {
			return err
		}
	}
	if input.IsAdmin != nil {
		if input.UserID != nil {
			_, err := m.UpdateUserAdminByID(ctx, *input.UserID, *input.IsAdmin)
			return err
		}
		_, err := m.UpdateUserAdmin(ctx, input.Email, *input.IsAdmin)
		return err
	}
	return nil
}

func (m *mockAdminRepo) GetUserByID(ctx context.Context, id int32) (*admin.AdminDashboardUser, error) {
	if m.getUserByIDFunc != nil {
		return m.getUserByIDFunc(ctx, id)
	}
	return &admin.AdminDashboardUser{}, nil
}

func (m *mockAdminRepo) FindUserByEmail(ctx context.Context, email string) (*admin.AdminAuditUser, error) {
	if m.findUserByEmailFunc != nil {
		return m.findUserByEmailFunc(ctx, email)
	}
	return &admin.AdminAuditUser{}, nil
}

// setupAdminTestRouter creates a test router with auth context injection
func setupAdminTestRouter(repo admin.Repository, user *auth.AuthenticatedUser) *chi.Mux {
	now := time.Now()
	return setupAdminTestRouterWithIssuedAtAndStatus(repo, user, &now, nil)
}

func setupAdminTestRouterWithIssuedAt(repo admin.Repository, user *auth.AuthenticatedUser, issuedAt *time.Time) *chi.Mux {
	return setupAdminTestRouterWithIssuedAtAndStatus(repo, user, issuedAt, nil)
}

func setupAdminTestRouterWithIssuedAtAndStatus(repo admin.Repository, user *auth.AuthenticatedUser, issuedAt *time.Time, statusSvc *platform.StatusService) *chi.Mux {
	r := chi.NewRouter()

	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if user != nil {
				ctx := context.WithValue(r.Context(), adapterhandler.UserContextKey, user)
				if issuedAt != nil {
					ctx = context.WithValue(ctx, adapterhandler.TokenIssuedAtContextKey, issuedAt.Unix())
				}
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
		})
	})

	api := humachi.New(r, huma.DefaultConfig("Test API", "1.0.0"))
	RegisterHandlers(api, repo, statusSvc)
	return r
}

func TestAdminDashboard_Success(t *testing.T) {
	mockRepo := &mockAdminRepo{
		getDashboardCountsFunc: func(ctx context.Context) (*admin.AdminDashboardCounts, error) {
			return &admin.AdminDashboardCounts{
				TotalUsers:         100,
				ActiveUsers24h:     50,
				FreeUsers:          70,
				ProUsers:           25,
				SuperUsers:         5,
				TotalConversations: 1000,
			}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin")

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "totalUsers")
}

func TestAdminDashboard_NonAdminForbidden(t *testing.T) {
	mockRepo := &mockAdminRepo{}

	// Non-admin user
	user := &auth.AuthenticatedUser{ID: 1, Email: "user@example.com", IsAdmin: false}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin")

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestAdminDashboard_Unauthorized(t *testing.T) {
	mockRepo := &mockAdminRepo{}
	router := setupAdminTestRouter(mockRepo, nil)

	resp := doGet(router, "/api/v1/admin")

	assert.Equal(t, http.StatusUnauthorized, resp.Code)
}

func TestAdminDashboard_DBError(t *testing.T) {
	mockRepo := &mockAdminRepo{
		getDashboardCountsFunc: func(ctx context.Context) (*admin.AdminDashboardCounts, error) {
			return nil, errors.New("database error")
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin")

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestAdminListUsers_Success(t *testing.T) {
	mockRepo := &mockAdminRepo{
		listUsersFunc: func(ctx context.Context, limit, offset int) (*admin.AdminUsersPage, error) {
			return &admin.AdminUsersPage{
				Users: []admin.AdminDashboardUser{
					{ID: 1, Email: "user1@example.com"},
					{ID: 2, Email: "user2@example.com"},
				},
				Total: 2,
			}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/users")

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "user1@example.com")
	assert.Contains(t, resp.Body.String(), "user2@example.com")
}

func TestAdminListUsers_NonAdminForbidden(t *testing.T) {
	mockRepo := &mockAdminRepo{}

	user := &auth.AuthenticatedUser{ID: 1, Email: "user@example.com", IsAdmin: false}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/users")

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestAdminListUsers_Pagination(t *testing.T) {
	limitCalled := 0
	offsetCalled := 0

	mockRepo := &mockAdminRepo{
		listUsersFunc: func(ctx context.Context, limit, offset int) (*admin.AdminUsersPage, error) {
			limitCalled = limit
			offsetCalled = offset
			return &admin.AdminUsersPage{Users: []admin.AdminDashboardUser{}, Total: 0}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/users?limit=25&offset=50")

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, 25, limitCalled)
	assert.Equal(t, 50, offsetCalled)
}

func TestAdminListUsers_AcceptsOffsetBeyondTenThousand(t *testing.T) {
	called := false
	mockRepo := &mockAdminRepo{
		listUsersFunc: func(ctx context.Context, limit, offset int) (*admin.AdminUsersPage, error) {
			called = true
			assert.Equal(t, 10000, offset)
			return &admin.AdminUsersPage{Users: []admin.AdminDashboardUser{}, Total: 10001}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/users?limit=100&offset=10000")

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.True(t, called)
}

func TestAdminListUsers_AppliesSearchAndPlanFilters(t *testing.T) {
	mockRepo := &mockAdminRepo{
		listUsersFilteredFunc: func(_ context.Context, filters admin.AdminUserFilters, limit, offset int) (*admin.AdminUsersPage, error) {
			assert.Equal(t, "clay", filters.Search)
			assert.Equal(t, "pro", filters.Plan)
			assert.Equal(t, 25, limit)
			assert.Equal(t, 50, offset)
			return &admin.AdminUsersPage{Users: []admin.AdminDashboardUser{}, Total: 0}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	resp := doGet(setupAdminTestRouter(mockRepo, user), "/api/v1/admin/users?limit=25&offset=50&search=clay&plan=PRO")

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestAdminListUsers_RejectsInvalidPlanFilter(t *testing.T) {
	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	resp := doGet(setupAdminTestRouter(&mockAdminRepo{}, user), "/api/v1/admin/users?plan=enterprise-plus")

	assert.Equal(t, http.StatusBadRequest, resp.Code)
}

func TestAdminGetInsights_Success(t *testing.T) {
	mockRepo := &mockAdminRepo{
		fetchInsightsDataFunc: func(ctx context.Context, since24h, since5m time.Time) (*admin.AdminInsightsData, error) {
			return &admin.AdminInsightsData{
				ActiveUsers24h: 100,
				Messages24h:    500,
			}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/insights")

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "activeUsers24h")
}

func TestAdminGetInsights_NonAdminForbidden(t *testing.T) {
	mockRepo := &mockAdminRepo{}

	user := &auth.AuthenticatedUser{ID: 1, Email: "user@example.com", IsAdmin: false}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/insights")

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestAdminListIncidents_Success(t *testing.T) {
	now := time.Now()
	mockRepo := &mockAdminRepo{
		listIncidentsFunc: func(ctx context.Context, limit int) ([]admin.AdminIncident, error) {
			return []admin.AdminIncident{
				{ID: 1, ServiceID: "api", Status: "operational", Message: "All systems go", StartedAt: &now},
			}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/incidents")

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "api")
}

func TestAdminListIncidents_EmptyList(t *testing.T) {
	mockRepo := &mockAdminRepo{
		listIncidentsFunc: func(ctx context.Context, limit int) ([]admin.AdminIncident, error) {
			return nil, nil // Returns nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/incidents")

	assert.Equal(t, http.StatusOK, resp.Code)
	// Should return empty array, not null
	assert.Contains(t, resp.Body.String(), "[]")
}

func TestAdminListOrganizations_Success(t *testing.T) {
	mockRepo := &mockAdminRepo{
		listOrganizationsFunc: func(ctx context.Context) ([]admin.AdminOrgRecord, error) {
			return []admin.AdminOrgRecord{
				{ID: 1, Name: "Org 1", Slug: "org-1", Plan: "pro"},
				{ID: 2, Name: "Org 2", Slug: "org-2", Plan: "super"},
			}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/orgs")

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "Org 1")
}

func TestAdminListOrganizations_NonAdminForbidden(t *testing.T) {
	mockRepo := &mockAdminRepo{}

	user := &auth.AuthenticatedUser{ID: 1, Email: "user@example.com", IsAdmin: false}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/orgs")

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestAdminListAuditLogs_Success(t *testing.T) {
	mockRepo := &mockAdminRepo{
		listAuditLogsFunc: func(ctx context.Context, filters admin.AuditLogFilters, limit, offset int) (*admin.AuditLogPage, error) {
			return &admin.AuditLogPage{
				Logs: []admin.AuditLogRecord{
					{ID: 1, Action: "LOGIN", Resource: "user"},
					{ID: 2, Action: "UPDATE", Resource: "settings"},
				},
				Total: 2,
			}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/audit-logs")

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "LOGIN")
}

func TestAdminListAuditLogs_NonAdminForbidden(t *testing.T) {
	mockRepo := &mockAdminRepo{}

	user := &auth.AuthenticatedUser{ID: 1, Email: "user@example.com", IsAdmin: false}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/audit-logs")

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestAdminListAuditLogs_Error(t *testing.T) {
	mockRepo := &mockAdminRepo{
		listAuditLogsFunc: func(ctx context.Context, filters admin.AuditLogFilters, limit, offset int) (*admin.AuditLogPage, error) {
			return nil, errors.New("db error")
		},
	}
	user := &auth.AuthenticatedUser{ID: 1, IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	resp := doGet(router, "/api/v1/admin/audit-logs")

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

// Test that all admin endpoints require admin access
func TestAllAdminEndpoints_RequireAdmin(t *testing.T) {
	mockRepo := &mockAdminRepo{}

	endpoints := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/admin"},
		{http.MethodGet, "/api/v1/admin/users"},
		{http.MethodGet, "/api/v1/admin/audit-logs"},
		{http.MethodGet, "/api/v1/admin/insights"},
		{http.MethodGet, "/api/v1/admin/incidents"},
		{http.MethodGet, "/api/v1/admin/orgs"},
	}

	for _, ep := range endpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			// Test with non-admin user
			user := &auth.AuthenticatedUser{ID: 1, Email: "user@example.com", IsAdmin: false}
			router := setupAdminTestRouter(mockRepo, user)

			req := httptest.NewRequest(ep.method, ep.path, nil)
			resp := httptest.NewRecorder()
			router.ServeHTTP(resp, req)

			assert.Equal(t, http.StatusForbidden, resp.Code, "Endpoint %s should require admin", ep.path)
		})
	}
}

func TestRequireReauth(t *testing.T) {
	t.Setenv("ADMIN_REAUTH_MAX_AGE_MINUTES", "30")
	now := time.Now()

	freshCtx := context.WithValue(context.Background(), adapterhandler.TokenIssuedAtContextKey, now.Unix())
	require.NoError(t, requireReauth(freshCtx))

	freshIntCtx := context.WithValue(context.Background(), adapterhandler.TokenIssuedAtContextKey, int(now.Unix()))
	require.NoError(t, requireReauth(freshIntCtx))

	staleCtx := context.WithValue(context.Background(), adapterhandler.TokenIssuedAtContextKey, now.Add(-2*time.Hour).Unix())
	require.Error(t, requireReauth(staleCtx))

	futureCtx := context.WithValue(context.Background(), adapterhandler.TokenIssuedAtContextKey, now.Add(10*time.Minute).Unix())
	require.Error(t, requireReauth(futureCtx))

	assert.Error(t, requireReauth(context.Background()))
}

func TestAdminReauthMaxAge_InvalidEnvFallsBack(t *testing.T) {
	t.Setenv("ADMIN_REAUTH_MAX_AGE_MINUTES", "bad")
	assert.Equal(t, coreidentity.DefaultAdminReauthMaxAge, adminReauthMaxAge())

	t.Setenv("ADMIN_REAUTH_MAX_AGE_MINUTES", "0")
	assert.Equal(t, coreidentity.DefaultAdminReauthMaxAge, adminReauthMaxAge())

	t.Setenv("ADMIN_REAUTH_MAX_AGE_MINUTES", "5")
	assert.Equal(t, 5*time.Minute, adminReauthMaxAge())
}

func TestAdminCreateIncident_Success(t *testing.T) {
	mockRepo := &mockAdminRepo{
		createIncidentFunc: func(ctx context.Context, serviceID, status, message string) error {
			assert.Equal(t, "api", serviceID)
			assert.Equal(t, "degraded", status)
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"serviceId": "api", "status": "degraded", "message": "Investigating"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/incidents", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Reauthenticated", "true")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestAdminCreateIncident_PublishErrorReturnsUnavailable(t *testing.T) {
	t.Setenv("BLOB_READ_WRITE_TOKEN", "")
	mockRepo := &mockAdminRepo{
		createIncidentFunc: func(ctx context.Context, serviceID, status, message string) error {
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	now := time.Now()
	router := setupAdminTestRouterWithIssuedAtAndStatus(mockRepo, user, &now, platform.NewStatusService())

	body := `{"serviceId": "api", "status": "degraded", "message": "Investigating"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/incidents", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusServiceUnavailable, resp.Code)
	assert.Contains(t, resp.Body.String(), "could not be published")
}

func TestAdminCreateIncident_StaleSession(t *testing.T) {
	mockRepo := &mockAdminRepo{}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	stale := time.Now().Add(-2 * time.Hour)
	router := setupAdminTestRouterWithIssuedAt(mockRepo, user, &stale)

	body := `{"serviceId": "api", "status": "degraded", "message": "Investigating"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/incidents", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
	assert.Contains(t, resp.Body.String(), "re-authentication required")
}

func TestAdminUpdateOrganization_Success(t *testing.T) {
	mockRepo := &mockAdminRepo{
		updateOrganizationFunc: func(ctx context.Context, orgID int32, plan string, rpmQuota int, tokenQuota int64, workosID string) error {
			assert.Equal(t, int32(123), orgID)
			assert.Equal(t, "pro", plan)
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"plan": "pro", "rpmQuota": 100, "tokensQuotaMonth": 100000, "workosOrgId": "org_abc"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/orgs/123", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Reauthenticated", "true")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestAdminUpdateOrganization_InvalidPlan(t *testing.T) {
	originalNormalize := normalizeOrganizationPlanForUpdate
	t.Cleanup(func() {
		normalizeOrganizationPlanForUpdate = originalNormalize
	})
	normalizeOrganizationPlanForUpdate = func(plan string) (string, bool) {
		return strings.ToLower(strings.TrimSpace(plan)), false
	}
	called := false
	mockRepo := &mockAdminRepo{
		updateOrganizationFunc: func(ctx context.Context, orgID int32, plan string, rpmQuota int, tokenQuota int64, workosID string) error {
			called = true
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"plan": "pro", "rpmQuota": 100, "tokensQuotaMonth": 100000, "workosOrgId": "org_abc"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/orgs/123", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Reauthenticated", "true")
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.False(t, called)
}

func TestAdminUpdateOrganization_StaleSession(t *testing.T) {
	mockRepo := &mockAdminRepo{}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	stale := time.Now().Add(-2 * time.Hour)
	router := setupAdminTestRouterWithIssuedAt(mockRepo, user, &stale)

	body := `{"plan": "pro", "rpmQuota": 100, "tokensQuotaMonth": 100000, "workosOrgId": "org_abc"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/admin/orgs/123", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusForbidden, resp.Code)
}

func TestAdminUpdateUser_PlanByEmail(t *testing.T) {
	mockRepo := &mockAdminRepo{
		updateUserPlanFunc: func(ctx context.Context, email, plan string) (*admin.AdminDashboardUser, error) {
			assert.Equal(t, "user@example.com", email)
			assert.Equal(t, "pro", plan)
			return &admin.AdminDashboardUser{Email: email, Plan: &plan}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"userId": null, "email": "user@example.com", "plan": "pro", "isAdmin": null}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Reauthenticated", "true")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Contains(t, resp.Body.String(), "success\":true")
}

func TestAdminUpdateUser_InvalidPlan(t *testing.T) {
	called := false
	mockRepo := &mockAdminRepo{
		updateUserPlanFunc: func(ctx context.Context, email, plan string) (*admin.AdminDashboardUser, error) {
			called = true
			return nil, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"userId": null, "email": "user@example.com", "plan": "enterprise", "isAdmin": null}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Reauthenticated", "true")
	resp := serve(router, req)

	assert.Equal(t, http.StatusBadRequest, resp.Code)
	assert.False(t, called)
}

func TestAdminUpdateUser_AdminByID(t *testing.T) {
	mockRepo := &mockAdminRepo{
		updateUserAdminByIDFunc: func(ctx context.Context, id int32, isAdmin bool) (*admin.AdminDashboardUser, error) {
			assert.Equal(t, int32(99), id)
			assert.True(t, isAdmin)
			return &admin.AdminDashboardUser{ID: int(id), IsAdmin: isAdmin}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"userId": 99, "email": "any@example.com", "plan": null, "isAdmin": true}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Reauthenticated", "true")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestAdminUpdateUser_AdminByIDRepoError(t *testing.T) {
	mockRepo := &mockAdminRepo{
		updateUserAdminByIDFunc: func(ctx context.Context, id int32, isAdmin bool) (*admin.AdminDashboardUser, error) {
			return nil, errors.New("admin role update failed")
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"userId": 99, "email": "any@example.com", "plan": null, "isAdmin": true}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Admin-Reauthenticated", "true")
	resp := serve(router, req)

	assert.Equal(t, http.StatusInternalServerError, resp.Code)
}

func TestAdminUpdateUser_PlanByID(t *testing.T) {
	plan := "pro"
	mockRepo := &mockAdminRepo{
		updateUserPlanByIDFunc: func(ctx context.Context, id int32, requestedPlan string) (*admin.AdminDashboardUser, error) {
			assert.Equal(t, int32(99), id)
			assert.Equal(t, plan, requestedPlan)
			return &admin.AdminDashboardUser{ID: int(id), Plan: &requestedPlan}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"userId": 99, "email": "", "plan": "pro", "isAdmin": null}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestAdminUpdateUser_AdminByEmail(t *testing.T) {
	mockRepo := &mockAdminRepo{
		updateUserAdminFunc: func(ctx context.Context, email string, isAdmin bool) (*admin.AdminDashboardUser, error) {
			assert.Equal(t, "user@example.com", email)
			assert.True(t, isAdmin)
			return &admin.AdminDashboardUser{Email: email, IsAdmin: isAdmin}, nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"userId": null, "email": "user@example.com", "plan": null, "isAdmin": true}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
}

func TestAdminUpdateUser_PlanAndAdminByEmail(t *testing.T) {
	updateCalls := 0
	mockRepo := &mockAdminRepo{
		updateUserFunc: func(ctx context.Context, input admin.AdminUserUpdate) error {
			updateCalls++
			assert.Nil(t, input.UserID)
			assert.Equal(t, "user@example.com", input.Email)
			require.NotNil(t, input.Plan)
			assert.Equal(t, "pro", *input.Plan)
			require.NotNil(t, input.IsAdmin)
			assert.True(t, *input.IsAdmin)
			return nil
		},
	}

	user := &auth.AuthenticatedUser{ID: 1, Email: "admin@example.com", IsAdmin: true}
	router := setupAdminTestRouter(mockRepo, user)

	body := `{"userId": null, "email": " user@example.com ", "plan": "pro", "isAdmin": true}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update-user", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp := serve(router, req)

	assert.Equal(t, http.StatusOK, resp.Code)
	assert.Equal(t, 1, updateCalls)
}

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
