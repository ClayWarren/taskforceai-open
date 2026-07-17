// Package admin provides administrative interfaces and logic.
package admin

import (
	"context"
	"time"
)

// AdminDashboardCounts represents summary counts
type AdminDashboardCounts struct {
	TotalUsers         int `json:"totalUsers"`
	ActiveUsers24h     int `json:"activeUsers24h"`
	FreeUsers          int `json:"freeUsers"`
	ProUsers           int `json:"proUsers"`
	SuperUsers         int `json:"superUsers"`
	TotalConversations int `json:"totalConversations"`
}

// AdminDashboardUser represents a user in the dashboard
type AdminDashboardUser struct {
	ID                   int        `json:"id"`
	Email                string     `json:"email"`
	FullName             *string    `json:"fullName"`
	Plan                 *string    `json:"plan"`
	IsAdmin              bool       `json:"isAdmin"`
	MessageCount         *int       `json:"messageCount"`
	LastMessageTimestamp *time.Time `json:"lastMessageTimestamp"`
	SubscriptionStatus   *string    `json:"subscriptionStatus"`
	CurrentPeriodStart   *time.Time `json:"currentPeriodStart"`
	CurrentPeriodEnd     *time.Time `json:"currentPeriodEnd"`
	CancelAtPeriodEnd    bool       `json:"cancelAtPeriodEnd"`
	Disabled             bool       `json:"disabled"`
}

type AdminUserUpdate struct {
	UserID  *int32
	Email   string
	Plan    *string
	IsAdmin *bool
}

// AdminDashboardRepository defines operations for the dashboard
type AdminDashboardRepository interface {
	GetDashboardCounts(ctx context.Context) (*AdminDashboardCounts, error)
	UpdateUserPlan(ctx context.Context, email, plan string) (*AdminDashboardUser, error)
	UpdateUserPlanByID(ctx context.Context, id int32, plan string) (*AdminDashboardUser, error)
	UpdateUserAdmin(ctx context.Context, email string, isAdmin bool) (*AdminDashboardUser, error)
	UpdateUserAdminByID(ctx context.Context, id int32, isAdmin bool) (*AdminDashboardUser, error)
	UpdateUser(ctx context.Context, input AdminUserUpdate) error
	GetUserByID(ctx context.Context, id int32) (*AdminDashboardUser, error)
	UpdateOrganization(ctx context.Context, orgID int32, plan string, rpmQuota int, tokenQuota int64, workosID string) error
	ListOrganizations(ctx context.Context) ([]AdminOrgRecord, error)
}

// AdminUsersPage represents a paginated list of users
type AdminUsersPage struct {
	Users []AdminDashboardUser `json:"users"`
	Total int                  `json:"total"`
}

type AdminUserFilters struct {
	Search string
	Plan   string
}

// AdminUsersRepository defines operations for user management
type AdminUsersRepository interface {
	ListUsers(ctx context.Context, limit, offset int) (*AdminUsersPage, error)
	ListUsersFiltered(ctx context.Context, filters AdminUserFilters, limit, offset int) (*AdminUsersPage, error)
}

// --- Insights ---

type ConversationAggregate struct {
	Count int      `json:"count"`
	Avg   *float64 `json:"avg"`
	Max   *float64 `json:"max"`
	Sum   *int     `json:"sum"`
}

type ModelUsageEntry struct {
	Model string `json:"model"`
	Count int    `json:"count"`
}

type SlowConversation struct {
	ID            int       `json:"id"`
	ExecutionTime *float64  `json:"executionTime"`
	UserID        *string   `json:"userId"`
	Timestamp     time.Time `json:"timestamp"`
}

type PlanCountEntry struct {
	Plan  string `json:"plan"`
	Count int    `json:"count"`
}

type TopUserEntry struct {
	ID           int    `json:"id"`
	Email        string `json:"email"`
	Plan         string `json:"plan"`
	MessageCount int    `json:"messageCount"`
}

type TokenAggregate struct {
	PromptTokens     *int     `json:"promptTokens"`
	CompletionTokens *int     `json:"completionTokens"`
	TotalTokens      *int     `json:"totalTokens"`
	CostMicros       *float64 `json:"costMicros"`
}

type TokensByModelEntry struct {
	Model       string   `json:"model"`
	TotalTokens *int     `json:"totalTokens"`
	CostMicros  *float64 `json:"costMicros"`
}

type ToolUsageEntry struct {
	ToolName    string   `json:"toolName"`
	Count       int      `json:"count"`
	SumDuration *float64 `json:"sumDurationMs"`
	AvgDuration *float64 `json:"avgDurationMs"`
}

type ToolSuccessEntry struct {
	ToolName string `json:"toolName"`
	Success  bool   `json:"success"`
	Count    int    `json:"count"`
}

type AdminInsightsData struct {
	ActiveUsers24h        int                   `json:"activeUsers24h"`
	Messages24h           int                   `json:"messages24h"`
	ConversationAggregate ConversationAggregate `json:"conversationAggregate"`
	ModelUsage            []ModelUsageEntry     `json:"modelUsage"`
	SlowestConversations  []SlowConversation    `json:"slowestConversations"`
	InProgress            int                   `json:"inProgress"`
	PlanCounts            []PlanCountEntry      `json:"planCounts"`
	TopUsers              []TopUserEntry        `json:"topUsers"`
	Tokens24h             TokenAggregate        `json:"tokens24h"`
	TokensAllTime         TokenAggregate        `json:"tokensAllTime"`
	TokensByModel         []TokensByModelEntry  `json:"tokensByModel"`
	ToolUsage             []ToolUsageEntry      `json:"toolUsage"`
	ToolSuccess           []ToolSuccessEntry    `json:"toolSuccess"`
}

type AdminInsightsRepository interface {
	FetchInsightsData(ctx context.Context, since24h, since5m time.Time) (*AdminInsightsData, error)
}

// --- Audit Logs ---

type AdminAuditUser struct {
	ID      int  `json:"id"`
	IsAdmin bool `json:"isAdmin"`
}

type AuditLogRecord struct {
	ID             int       `json:"id"`
	Timestamp      time.Time `json:"timestamp"`
	UserID         *string   `json:"userId"`
	OrganizationID *int32    `json:"organizationId"`
	Action         string    `json:"action"`
	Resource       string    `json:"resource"`
	ResourceID     *string   `json:"resourceId"`
	IPAddress      *string   `json:"ipAddress"`
	UserAgent      *string   `json:"userAgent"`
	Details        any       `json:"details"`
	Success        bool      `json:"success"`
	ErrorMessage   *string   `json:"errorMessage"`
}

type AuditLogFilters struct {
	UserID         *string    `json:"userId"`
	OrganizationID *int32     `json:"organizationId"`
	Action         *string    `json:"action"`
	Resource       *string    `json:"resource"`
	StartDate      *time.Time `json:"startDate"`
	EndDate        *time.Time `json:"endDate"`
}
type AuditLogPage struct {
	Logs  []AuditLogRecord `json:"logs"`
	Total int              `json:"total"`
}

type AdminAuditLogsRepository interface {
	FindUserByEmail(ctx context.Context, email string) (*AdminAuditUser, error)
	ListAuditLogs(ctx context.Context, filters AuditLogFilters, limit, offset int) (*AuditLogPage, error)
}

// --- Incidents ---

type AdminIncident struct {
	ID         int        `json:"id"`
	ServiceID  string     `json:"serviceId"`
	Status     string     `json:"status"`
	Message    string     `json:"message"`
	StartedAt  *time.Time `json:"startedAt"`
	ResolvedAt *time.Time `json:"resolvedAt"`
}

type AdminIncidentsRepository interface {
	CreateIncident(ctx context.Context, serviceID, status, message string) error
	ListIncidents(ctx context.Context, limit int) ([]AdminIncident, error)
}

// --- Organizations ---

type AdminOrgRecord struct {
	ID               int32  `json:"id"`
	Name             string `json:"name"`
	Slug             string `json:"slug"`
	Plan             string `json:"plan"`
	WorkosOrgID      string `json:"workosOrgId"`
	MemberCount      int    `json:"memberCount"`
	RPMQuota         int    `json:"rpmQuota"`
	TokensQuotaMonth int64  `json:"tokensQuotaMonth"`
	CreatedAt        string `json:"createdAt"`
}
