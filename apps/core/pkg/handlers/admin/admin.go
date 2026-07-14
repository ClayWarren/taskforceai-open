package admin

import (
	"context"
	"log/slog"
	"net/http"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"github.com/TaskForceAI/adapters/pkg/handler"
	coreidentity "github.com/TaskForceAI/core/pkg/identity"
	"github.com/TaskForceAI/core/pkg/platform"
	"github.com/TaskForceAI/go-core/pkg/admin"
)

var validUserPlans = map[string]struct{}{
	"free":  {},
	"pro":   {},
	"super": {},
}

var validOrganizationPlans = map[string]struct{}{
	"free":  {},
	"pro":   {},
	"super": {},
	"admin": {},
}

func adminReauthMaxAge() time.Duration {
	value := os.Getenv("ADMIN_REAUTH_MAX_AGE_MINUTES")
	if value == "" {
		return coreidentity.DefaultAdminReauthMaxAge
	}

	minutes, err := strconv.Atoi(value)
	if err != nil || minutes <= 0 {
		return coreidentity.DefaultAdminReauthMaxAge
	}
	return time.Duration(minutes) * time.Minute
}

// tokenIssuedAt extracts the server-verified token issue timestamp from the
// request context; it returns the zero time when missing or malformed.
func tokenIssuedAt(ctx context.Context) time.Time {
	raw := ctx.Value(handler.TokenIssuedAtContextKey)
	var issuedAtUnix int64
	switch v := raw.(type) {
	case int64:
		issuedAtUnix = v
	case int:
		issuedAtUnix = int64(v)
	default:
		return time.Time{}
	}
	return time.Unix(issuedAtUnix, 0)
}

// requireReauth validates that the authenticated session is recent enough for
// sensitive admin mutations using a server-verified token issue timestamp.
func requireReauth(ctx context.Context) error {
	policy := coreidentity.ReauthPolicy{
		MaxAge:             adminReauthMaxAge(),
		MaxFutureClockSkew: coreidentity.DefaultReauthMaxFutureClockSkew,
	}
	if err := policy.Validate(tokenIssuedAt(ctx), time.Now()); err != nil {
		return huma.Error403Forbidden("Admin re-authentication required for this operation")
	}
	return nil
}

func normalizeUserPlan(plan string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(plan))
	_, ok := validUserPlans[normalized]
	return normalized, ok
}

func normalizeOrganizationPlan(plan string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(plan))
	_, ok := validOrganizationPlans[normalized]
	return normalized, ok
}

var normalizeOrganizationPlanForUpdate = normalizeOrganizationPlan

func normalizeAdminUpdateEmail(email string) (string, bool) {
	normalized := strings.TrimSpace(email)
	parsed, err := mail.ParseAddress(normalized)
	if err != nil || parsed.Address != normalized {
		return "", false
	}
	return normalized, true
}

// RegisterHandlers registers all admin-related handlers.
func RegisterHandlers(api huma.API, repo admin.Repository, statusSvc *platform.StatusService) {
	registerDashboard(api, repo)
	registerListUsers(api, repo)
	registerListAuditLogs(api, repo)
	registerInsights(api, repo)
	registerListIncidents(api, repo)
	registerCreateIncident(api, repo, statusSvc)
	registerListOrganizations(api, repo)
	registerUpdateOrganization(api, repo)
	registerUpdateUser(api, repo)
}

func registerDashboard(api huma.API, repo admin.Repository) {
	// Dashboard Counts
	huma.Register(api, huma.Operation{
		OperationID: "admin-get-dashboard",
		Method:      http.MethodGet,
		Path:        "/api/v1/admin",
		Summary:     "Get admin dashboard counts",
		Tags:        []string{"Admin"},
	}, func(ctx context.Context, input *struct {
		handler.AdminAuthContext
	}) (*struct{ Body *admin.AdminDashboardCounts }, error) {
		counts, err := repo.GetDashboardCounts(ctx)
		if err != nil {
			slog.Error("Failed to fetch admin dashboard counts", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch dashboard counts")
		}
		return &struct{ Body *admin.AdminDashboardCounts }{Body: counts}, nil
	})
}

func registerListUsers(api huma.API, repo admin.Repository) {
	// List Users
	huma.Register(api, huma.Operation{
		OperationID: "admin-list-users",
		Method:      http.MethodGet,
		Path:        "/api/v1/admin/users",
		Summary:     "List users (Admin)",
		Tags:        []string{"Admin"},
	}, func(ctx context.Context, input *struct {
		Limit  int    `query:"limit" default:"50" minimum:"1" maximum:"100"`
		Offset int    `query:"offset" default:"0" minimum:"0"`
		Search string `query:"search" maxLength:"200"`
		Plan   string `query:"plan"`
		handler.AdminAuthContext
	}) (*struct {
		Body struct {
			Users      []admin.AdminDashboardUser `json:"users"`
			Pagination struct {
				Total   int  `json:"total"`
				Limit   int  `json:"limit"`
				Offset  int  `json:"offset"`
				HasMore bool `json:"hasMore"`
			} `json:"pagination"`
		}
	}, error) {
		plan := strings.ToLower(strings.TrimSpace(input.Plan))
		if plan != "" {
			if _, ok := validOrganizationPlans[plan]; !ok {
				return nil, huma.Error400BadRequest("Invalid plan filter")
			}
		}

		page, err := repo.ListUsersFiltered(ctx, admin.AdminUserFilters{
			Search: input.Search,
			Plan:   plan,
		}, input.Limit, input.Offset)
		if err != nil {
			slog.Error("Failed to list users for admin", "userId", input.User.ID, "limit", input.Limit, "offset", input.Offset, "error", err)
			return nil, huma.Error500InternalServerError("Failed to list users")
		}

		var resp struct {
			Users      []admin.AdminDashboardUser `json:"users"`
			Pagination struct {
				Total   int  `json:"total"`
				Limit   int  `json:"limit"`
				Offset  int  `json:"offset"`
				HasMore bool `json:"hasMore"`
			} `json:"pagination"`
		}
		resp.Users = page.Users
		resp.Pagination.Total = page.Total
		resp.Pagination.Limit = input.Limit
		resp.Pagination.Offset = input.Offset
		resp.Pagination.HasMore = input.Offset+len(page.Users) < page.Total

		return &struct {
			Body struct {
				Users      []admin.AdminDashboardUser `json:"users"`
				Pagination struct {
					Total   int  `json:"total"`
					Limit   int  `json:"limit"`
					Offset  int  `json:"offset"`
					HasMore bool `json:"hasMore"`
				} `json:"pagination"`
			}
		}{Body: resp}, nil
	})
}

func registerListAuditLogs(api huma.API, repo admin.Repository) {
	// List Audit Logs
	huma.Register(api, huma.Operation{
		OperationID: "admin-list-audit-logs",
		Method:      http.MethodGet,
		Path:        "/api/v1/admin/audit-logs",
		Summary:     "List audit logs (Admin)",
		Tags:        []string{"Admin"},
	}, func(ctx context.Context, input *struct {
		Limit          int                   `query:"limit" default:"50" minimum:"1" maximum:"100"`
		Offset         int                   `query:"offset" default:"0" minimum:"0"`
		UserID         OptionalParam[string] `query:"userId"`
		Action         OptionalParam[string] `query:"action"`
		Resource       OptionalParam[string] `query:"resource"`
		OrganizationID OptionalParam[int32]  `query:"organizationId"`
		handler.AdminAuthContext
	}) (*struct {
		Body struct {
			Logs       []admin.AuditLogRecord `json:"logs"`
			Pagination struct {
				Total   int  `json:"total"`
				Limit   int  `json:"limit"`
				Offset  int  `json:"offset"`
				HasMore bool `json:"hasMore"`
			} `json:"pagination"`
		}
	}, error) {
		filters := admin.AuditLogFilters{
			UserID:         optionalStringParam(input.UserID),
			Action:         optionalStringParam(input.Action),
			Resource:       optionalStringParam(input.Resource),
			OrganizationID: optionalInt32Param(input.OrganizationID),
		}

		page, err := repo.ListAuditLogs(ctx, filters, input.Limit, input.Offset)
		if err != nil {
			slog.Error("Failed to list audit logs for admin", "userId", input.User.ID, "limit", input.Limit, "offset", input.Offset, "error", err)
			return nil, huma.Error500InternalServerError("Failed to list audit logs")
		}

		var resp struct {
			Logs       []admin.AuditLogRecord `json:"logs"`
			Pagination struct {
				Total   int  `json:"total"`
				Limit   int  `json:"limit"`
				Offset  int  `json:"offset"`
				HasMore bool `json:"hasMore"`
			} `json:"pagination"`
		}
		resp.Logs = page.Logs
		resp.Pagination.Total = page.Total
		resp.Pagination.Limit = input.Limit
		resp.Pagination.Offset = input.Offset
		resp.Pagination.HasMore = input.Offset+len(page.Logs) < page.Total

		return &struct {
			Body struct {
				Logs       []admin.AuditLogRecord `json:"logs"`
				Pagination struct {
					Total   int  `json:"total"`
					Limit   int  `json:"limit"`
					Offset  int  `json:"offset"`
					HasMore bool `json:"hasMore"`
				} `json:"pagination"`
			}
		}{Body: resp}, nil
	})
}

func registerInsights(api huma.API, repo admin.Repository) {
	// Get Insights
	huma.Register(api, huma.Operation{
		OperationID: "admin-get-insights",
		Method:      http.MethodGet,
		Path:        "/api/v1/admin/insights",
		Summary:     "Get administrative insights",
		Tags:        []string{"Admin"},
	}, func(ctx context.Context, input *struct {
		handler.AdminAuthContext
	}) (*struct{ Body *admin.AdminInsightsData }, error) {
		now := time.Now()
		data, err := repo.FetchInsightsData(ctx, now.Add(-24*time.Hour), now.Add(-5*time.Minute))
		if err != nil {
			slog.Error("Failed to fetch admin insights", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch insights")
		}
		return &struct{ Body *admin.AdminInsightsData }{Body: data}, nil
	})
}

func registerListIncidents(api huma.API, repo admin.Repository) {
	// List Incidents
	huma.Register(api, huma.Operation{
		OperationID: "admin-list-incidents",
		Method:      http.MethodGet,
		Path:        "/api/v1/admin/incidents",
		Summary:     "List service incidents",
		Tags:        []string{"Admin"},
	}, func(ctx context.Context, input *struct {
		handler.AdminAuthContext
	}) (*struct{ Body []admin.AdminIncident }, error) {
		incidents, err := repo.ListIncidents(ctx, 50)
		if err != nil {
			slog.Error("Failed to list service incidents for admin", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch incidents")
		}
		if incidents == nil {
			incidents = []admin.AdminIncident{}
		}
		return &struct{ Body []admin.AdminIncident }{Body: incidents}, nil
	})
}

func registerCreateIncident(api huma.API, repo admin.Repository, statusSvc *platform.StatusService) {
	// Create Incident
	huma.Register(api, huma.Operation{
		OperationID: "admin-create-incident",
		Method:      http.MethodPost,
		Path:        "/api/v1/admin/incidents",
		Summary:     "Create a service incident",
		Tags:        []string{"Admin"},
	}, func(ctx context.Context, input *struct {
		Body struct {
			ServiceID string `json:"serviceId" minLength:"1"`
			Status    string `json:"status" enum:"operational,degraded,outage,maintenance"`
			Message   string `json:"message" minLength:"1"`
		}
		handler.AdminAuthContext
	}) (*struct{ Body map[string]string }, error) {
		if err := requireReauth(ctx); err != nil {
			return nil, err
		}

		if err := repo.CreateIncident(ctx, input.Body.ServiceID, input.Body.Status, input.Body.Message); err != nil {
			slog.Error("Failed to create service incident", "userId", input.User.ID, "serviceId", input.Body.ServiceID, "status", input.Body.Status, "error", err)
			return nil, huma.Error500InternalServerError("Failed to create incident")
		}

		// Publish the current status snapshot for the public status page.
		if statusSvc != nil {
			publishCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()
			if err := statusSvc.Publish(publishCtx); err != nil {
				slog.Error("Failed to publish status after incident creation", "error", err)
				return nil, huma.Error503ServiceUnavailable("Incident was saved, but the public status snapshot could not be published")
			}
		}

		return &struct{ Body map[string]string }{Body: map[string]string{"message": "Incident created"}}, nil
	})
}

func registerListOrganizations(api huma.API, repo admin.Repository) {
	// List Organizations
	huma.Register(api, huma.Operation{
		OperationID: "admin-list-orgs",
		Method:      http.MethodGet,
		Path:        "/api/v1/admin/orgs",
		Summary:     "List organizations",
		Tags:        []string{"Admin"},
	}, func(ctx context.Context, input *struct {
		handler.AdminAuthContext
	}) (*struct{ Body []admin.AdminOrgRecord }, error) {
		orgs, err := repo.ListOrganizations(ctx)
		if err != nil {
			slog.Error("Failed to fetch organizations for admin", "userId", input.User.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to fetch organizations")
		}
		return &struct{ Body []admin.AdminOrgRecord }{Body: orgs}, nil
	})
}

func registerUpdateOrganization(api huma.API, repo admin.Repository) {
	// Update Organization
	huma.Register(api, huma.Operation{
		OperationID: "admin-update-org",
		Method:      http.MethodPatch,
		Path:        "/api/v1/admin/orgs/{id}",
		Summary:     "Update organization details",
		Tags:        []string{"Admin"},
	}, func(ctx context.Context, input *struct {
		ID   int32 `path:"id"`
		Body struct {
			Plan             string `json:"plan" enum:"free,pro,super,admin"`
			RPMQuota         int    `json:"rpmQuota" minimum:"0" maximum:"2147483647"`
			TokensQuotaMonth int64  `json:"tokensQuotaMonth" minimum:"0"`
			WorkosOrgID      string `json:"workosOrgId"`
		}
		handler.AdminAuthContext
	}) (*struct{ Body map[string]string }, error) {
		if err := requireReauth(ctx); err != nil {
			return nil, err
		}

		plan, ok := normalizeOrganizationPlanForUpdate(input.Body.Plan)
		if !ok {
			return nil, huma.Error400BadRequest("Invalid organization plan")
		}

		if err := repo.UpdateOrganization(ctx, input.ID, plan, input.Body.RPMQuota, input.Body.TokensQuotaMonth, input.Body.WorkosOrgID); err != nil {
			slog.Error("Admin organization update failed", "actorEmail", input.User.Email, "orgID", input.ID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to update organization")
		}
		return &struct{ Body map[string]string }{Body: map[string]string{"message": "Organization updated"}}, nil
	})
}

func registerUpdateUser(api huma.API, repo admin.Repository) {
	// Update User (Admin Override)
	huma.Register(api, huma.Operation{
		OperationID: "admin-update-user",
		Method:      http.MethodPost,
		Path:        "/api/v1/admin/update-user",
		Summary:     "Update user details (Admin)",
		Tags:        []string{"Admin"},
	}, func(ctx context.Context, input *struct {
		Body struct {
			UserID  *int32  `json:"userId"`
			Email   string  `json:"email"`
			Plan    *string `json:"plan"`
			IsAdmin *bool   `json:"isAdmin"`
		}
		handler.AdminAuthContext
	}) (*struct{ Body map[string]bool }, error) {
		if err := requireReauth(ctx); err != nil {
			return nil, err
		}

		if input.Body.Plan == nil && input.Body.IsAdmin == nil {
			return nil, huma.Error400BadRequest("Plan or isAdmin must be provided")
		}

		targetEmail := strings.TrimSpace(input.Body.Email)
		if input.Body.UserID == nil {
			var ok bool
			targetEmail, ok = normalizeAdminUpdateEmail(input.Body.Email)
			if !ok {
				return nil, huma.Error400BadRequest("Valid userId or email must be provided")
			}
		}

		var normalizedPlan *string
		if input.Body.Plan != nil {
			plan, ok := normalizeUserPlan(*input.Body.Plan)
			if !ok {
				return nil, huma.Error400BadRequest("Invalid plan")
			}
			normalizedPlan = &plan
		}

		if err := repo.UpdateUser(ctx, admin.AdminUserUpdate{
			UserID: input.Body.UserID, Email: targetEmail, Plan: normalizedPlan, IsAdmin: input.Body.IsAdmin,
		}); err != nil {
			slog.Error("Admin user update failed", "actorEmail", input.User.Email, "targetEmail", targetEmail, "targetID", input.Body.UserID, "error", err)
			return nil, huma.Error500InternalServerError("Failed to update user")
		}
		return &struct{ Body map[string]bool }{Body: map[string]bool{"success": true}}, nil
	})
}
