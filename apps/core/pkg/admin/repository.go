package admin

import (
	"context"
	"encoding/json"
	"fmt"
	postgres "github.com/TaskForceAI/infrastructure/postgres/pkg"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/collections"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/sync/errgroup"
)

type Repository interface {
	AdminDashboardRepository
	AdminUsersRepository
	AdminInsightsRepository
	AdminAuditLogsRepository
	AdminIncidentsRepository
}

type UserStatsRow = db.GetUserStatsRow
type ListUsersInput = db.ListUsersParams
type ListUsersForAdminInput = db.ListUsersForAdminParams
type CountUsersForAdminInput = db.CountUsersForAdminParams

type AdminUserRecord struct {
	ID                   int32
	Email                string
	FullName             *string
	Plan                 string
	IsAdmin              bool
	MessageCount         int32
	LastMessageTimestamp pgtype.Timestamp
	Disabled             bool
}

type UpdateUserPlanByEmailInput = db.UpdateUserPlanByEmailParams
type UpdateUserAdminByIDInput = db.UpdateUserAdminByIDParams
type AuditLogQueryInput = db.GetAuditLogsFilteredParams
type CountAuditLogsInput = db.CountAuditLogsFilteredParams
type AuditLogRow = db.AuditLog
type CreateIncidentInput = db.CreateServiceIncidentParams
type ServiceIncidentRow = db.ServiceIncident
type OrganizationAdminRow = db.ListOrganizationsForAdminRow
type UpdateOrganizationInput = db.UpdateOrganizationAdminParams
type TimestampLimitInput = db.GetModelUsageSinceParams
type CreatedAtLimitInput = db.GetTokensByModelSinceParams
type ConversationAggregateRow = db.GetConversationAggregateSinceRow
type ModelUsageRow = db.GetModelUsageSinceRow
type SlowConversationRow = db.GetSlowestConversationsSinceRow
type PlanCountRow = db.GetPlanCountsRow
type TopUserMessageCountRow = db.GetTopUsersByMessageCountRow
type TokenAggregateRow = db.GetTokenAggregateSinceRow
type TokenAggregateAllTimeRow = db.GetTokenAggregateAllTimeRow
type TokensByModelRow = db.GetTokensByModelSinceRow
type ToolUsageRow = db.GetToolUsageSinceRow
type ToolSuccessRow = db.GetToolSuccessSinceRow

type AdminQueries interface {
	GetUserStats(ctx context.Context) (UserStatsRow, error)
	CountAllConversations(ctx context.Context) (int64, error)
	ListUsers(ctx context.Context, arg ListUsersInput) ([]AdminUserRecord, error)
	ListUsersForAdmin(ctx context.Context, arg ListUsersForAdminInput) ([]AdminUserRecord, error)
	CountUsers(ctx context.Context) (int64, error)
	CountUsersForAdmin(ctx context.Context, arg CountUsersForAdminInput) (int64, error)
	GetAuditLogsFiltered(ctx context.Context, arg AuditLogQueryInput) ([]AuditLogRow, error)
	CountAuditLogsFiltered(ctx context.Context, arg CountAuditLogsInput) (int64, error)
	GetUserByEmail(ctx context.Context, email string) (AdminUserRecord, error)
	UpdateUserPlanByEmail(ctx context.Context, arg UpdateUserPlanByEmailInput) (AdminUserRecord, error)
	GetUserByID(ctx context.Context, id int32) (AdminUserRecord, error)
	UpdateUserAdminByID(ctx context.Context, arg UpdateUserAdminByIDInput) (AdminUserRecord, error)
	CountMessagesSince(ctx context.Context, createdAt pgtype.Timestamp) (int64, error)
	GetConversationAggregateSince(ctx context.Context, timestamp pgtype.Timestamp) (ConversationAggregateRow, error)
	GetModelUsageSince(ctx context.Context, arg TimestampLimitInput) ([]ModelUsageRow, error)
	GetSlowestConversationsSince(ctx context.Context, arg TimestampLimitInput) ([]SlowConversationRow, error)
	CountInProgressConversationsSince(ctx context.Context, createdAt pgtype.Timestamp) (int64, error)
	GetPlanCounts(ctx context.Context) ([]PlanCountRow, error)
	GetTopUsersByMessageCount(ctx context.Context, limit int32) ([]TopUserMessageCountRow, error)
	GetTokenAggregateSince(ctx context.Context, createdAt pgtype.Timestamp) (TokenAggregateRow, error)
	GetTokenAggregateAllTime(ctx context.Context) (TokenAggregateAllTimeRow, error)
	GetTokensByModelSince(ctx context.Context, arg CreatedAtLimitInput) ([]TokensByModelRow, error)
	GetToolUsageSince(ctx context.Context, createdAt pgtype.Timestamp) ([]ToolUsageRow, error)
	GetToolSuccessSince(ctx context.Context, createdAt pgtype.Timestamp) ([]ToolSuccessRow, error)
	CreateServiceIncident(ctx context.Context, arg CreateIncidentInput) (ServiceIncidentRow, error)
	ListServiceIncidents(ctx context.Context, limit int32) ([]ServiceIncidentRow, error)
	ListOrganizationsForAdmin(ctx context.Context) ([]OrganizationAdminRow, error)
	UpdateOrganizationAdmin(ctx context.Context, arg UpdateOrganizationInput) error
}

type RepositoryImpl struct {
	q AdminQueries
}

// NewRepository creates a new admin repository.
func NewRepository(q AdminQueries) Repository {
	return &RepositoryImpl{q: q}
}

// GetDashboardCounts fetches high-level metrics for the admin dashboard.
func (r *RepositoryImpl) GetDashboardCounts(ctx context.Context) (*AdminDashboardCounts, error) {
	stats, err := r.q.GetUserStats(ctx)
	if err != nil {
		slog.Error("Failed to get user stats for admin dashboard", "error", err)
		return nil, fmt.Errorf("failed to get user stats: %w", err)
	}

	totalConversations, err := r.q.CountAllConversations(ctx)
	if err != nil {
		slog.Error("Failed to count conversations for admin dashboard", "error", err)
		return nil, fmt.Errorf("failed to count conversations: %w", err)
	}

	return &AdminDashboardCounts{
		TotalUsers:         int(stats.TotalUsers),
		ActiveUsers24h:     int(stats.ActiveUsers24h),
		ProUsers:           int(stats.ProUsers),
		SuperUsers:         int(stats.SuperUsers),
		TotalConversations: int(totalConversations),
		FreeUsers:          int(stats.FreeUsers),
	}, nil
}

// ListUsers retrieves a paginated list of users.
func (r *RepositoryImpl) ListUsers(ctx context.Context, limit, offset int) (*AdminUsersPage, error) {
	limit32, err := toInt32(limit, "limit")
	if err != nil {
		return nil, err
	}
	offset32, err := toInt32(offset, "offset")
	if err != nil {
		return nil, err
	}

	users, err := r.q.ListUsers(ctx, ListUsersInput{
		Limit:  limit32,
		Offset: offset32,
	})
	if err != nil {
		slog.Error("Failed to list users for admin", "limit", limit, "offset", offset, "error", err)
		return nil, err
	}

	total, err := r.q.CountUsers(ctx)
	if err != nil {
		slog.Error("Failed to count users for admin", "error", err)
		return nil, err
	}

	return &AdminUsersPage{
		Users: collections.Map(users, adminDashboardUserFromRecord),
		Total: int(total),
	}, nil
}

func (r *RepositoryImpl) ListUsersFiltered(
	ctx context.Context,
	filters AdminUserFilters,
	limit, offset int,
) (*AdminUsersPage, error) {
	limit32, err := toInt32(limit, "limit")
	if err != nil {
		return nil, err
	}
	offset32, err := toInt32(offset, "offset")
	if err != nil {
		return nil, err
	}

	query := ListUsersForAdminInput{
		Search:     strings.TrimSpace(filters.Search),
		Plan:       strings.TrimSpace(filters.Plan),
		PageLimit:  limit32,
		PageOffset: offset32,
	}
	users, err := r.q.ListUsersForAdmin(ctx, query)
	if err != nil {
		slog.Error("Failed to list filtered users for admin", "limit", limit, "offset", offset, "error", err)
		return nil, err
	}

	total, err := r.q.CountUsersForAdmin(ctx, CountUsersForAdminInput{
		Search: query.Search,
		Plan:   query.Plan,
	})
	if err != nil {
		slog.Error("Failed to count filtered users for admin", "error", err)
		return nil, err
	}

	return &AdminUsersPage{
		Users: collections.Map(users, adminDashboardUserFromRecord),
		Total: int(total),
	}, nil
}

// ListAuditLogs retrieves a paginated list of audit logs.
func (r *RepositoryImpl) ListAuditLogs(ctx context.Context, filters AuditLogFilters, limit, offset int) (*AuditLogPage, error) {
	limit32, err := toInt32(limit, "limit")
	if err != nil {
		return nil, err
	}
	offset32, err := toInt32(offset, "offset")
	if err != nil {
		return nil, err
	}

	logs, err := r.q.GetAuditLogsFiltered(ctx, AuditLogQueryInput{
		UserID:         filters.UserID,
		Action:         filters.Action,
		Resource:       filters.Resource,
		OrganizationID: filters.OrganizationID,
		StartDate:      toPgTimestamp(filters.StartDate),
		EndDate:        toPgTimestamp(filters.EndDate),
		Limit:          limit32,
		Offset:         offset32,
	})
	if err != nil {
		slog.Error("Failed to get audit logs for admin", "limit", limit, "offset", offset, "error", err)
		return nil, err
	}

	total, err := r.q.CountAuditLogsFiltered(ctx, CountAuditLogsInput{
		UserID:         filters.UserID,
		Action:         filters.Action,
		Resource:       filters.Resource,
		OrganizationID: filters.OrganizationID,
		StartDate:      toPgTimestamp(filters.StartDate),
		EndDate:        toPgTimestamp(filters.EndDate),
	})
	if err != nil {
		slog.Error("Failed to count audit logs for admin", "error", err)
		return nil, err
	}

	return &AuditLogPage{
		Logs:  collections.Map(logs, auditLogRecordFromRow),
		Total: int(total),
	}, nil
}

func (r *RepositoryImpl) FindUserByEmail(ctx context.Context, email string) (*AdminAuditUser, error) {
	u, err := r.q.GetUserByEmail(ctx, email)
	if err != nil {
		slog.Error("Failed to find user by email for admin audit", "email", email, "error", err)
		return nil, err
	}
	return &AdminAuditUser{ID: int(u.ID), IsAdmin: u.IsAdmin}, nil
}

func (r *RepositoryImpl) FetchInsightsData(ctx context.Context, since24h, since5m time.Time) (*AdminInsightsData, error) {
	since24hTS := pgtype.Timestamp{Time: since24h, Valid: true}
	since5mTS := pgtype.Timestamp{Time: since5m, Valid: true}

	var (
		userStats       UserStatsRow
		messages24h     int64
		conversationAgg ConversationAggregateRow
		modelUsageRows  []ModelUsageRow
		slowestRows     []SlowConversationRow
		inProgress      int64
		planCountsRows  []PlanCountRow
		topUsersRows    []TopUserMessageCountRow
		tokens24h       TokenAggregateRow
		tokensAllTime   TokenAggregateAllTimeRow
		tokensByModel   []TokensByModelRow
		toolUsageRows   []ToolUsageRow
		toolSuccessRows []ToolSuccessRow
	)

	g, gCtx := errgroup.WithContext(ctx)

	g.Go(func() error {
		var err error
		userStats, err = postgres.WithRetry(gCtx, func() (UserStatsRow, error) {
			return r.q.GetUserStats(gCtx)
		})
		return err
	})

	g.Go(func() error {
		var err error
		messages24h, err = postgres.WithRetry(gCtx, func() (int64, error) {
			return r.q.CountMessagesSince(gCtx, since24hTS)
		})
		return err
	})

	g.Go(func() error {
		var err error
		conversationAgg, err = postgres.WithRetry(gCtx, func() (ConversationAggregateRow, error) {
			return r.q.GetConversationAggregateSince(gCtx, since24hTS)
		})
		return err
	})

	g.Go(func() error {
		var err error
		modelUsageRows, err = postgres.WithRetry(gCtx, func() ([]ModelUsageRow, error) {
			return r.q.GetModelUsageSince(gCtx, TimestampLimitInput{
				Timestamp: since24hTS,
				Limit:     10,
			})
		})
		return err
	})

	g.Go(func() error {
		var err error
		slowestRows, err = postgres.WithRetry(gCtx, func() ([]SlowConversationRow, error) {
			return r.q.GetSlowestConversationsSince(gCtx, TimestampLimitInput{
				Timestamp: since24hTS,
				Limit:     10,
			})
		})
		return err
	})

	g.Go(func() error {
		var err error
		inProgress, err = postgres.WithRetry(gCtx, func() (int64, error) {
			return r.q.CountInProgressConversationsSince(gCtx, since5mTS)
		})
		return err
	})

	g.Go(func() error {
		var err error
		planCountsRows, err = postgres.WithRetry(gCtx, func() ([]PlanCountRow, error) {
			return r.q.GetPlanCounts(gCtx)
		})
		return err
	})

	g.Go(func() error {
		var err error
		topUsersRows, err = postgres.WithRetry(gCtx, func() ([]TopUserMessageCountRow, error) {
			return r.q.GetTopUsersByMessageCount(gCtx, 10)
		})
		return err
	})

	g.Go(func() error {
		var err error
		tokens24h, err = postgres.WithRetry(gCtx, func() (TokenAggregateRow, error) {
			return r.q.GetTokenAggregateSince(gCtx, since24hTS)
		})
		return err
	})

	g.Go(func() error {
		var err error
		tokensAllTime, err = postgres.WithRetry(gCtx, func() (TokenAggregateAllTimeRow, error) {
			return r.q.GetTokenAggregateAllTime(gCtx)
		})
		return err
	})

	g.Go(func() error {
		var err error
		tokensByModel, err = postgres.WithRetry(gCtx, func() ([]TokensByModelRow, error) {
			return r.q.GetTokensByModelSince(gCtx, CreatedAtLimitInput{
				CreatedAt: since24hTS,
				Limit:     10,
			})
		})
		return err
	})

	g.Go(func() error {
		var err error
		toolUsageRows, err = postgres.WithRetry(gCtx, func() ([]ToolUsageRow, error) {
			return r.q.GetToolUsageSince(gCtx, since24hTS)
		})
		return err
	})

	g.Go(func() error {
		var err error
		toolSuccessRows, err = postgres.WithRetry(gCtx, func() ([]ToolSuccessRow, error) {
			return r.q.GetToolSuccessSince(gCtx, since24hTS)
		})
		return err
	})

	if err := g.Wait(); err != nil {
		slog.Error("Failed to fetch admin insights data in parallel", "error", err)
		return nil, err
	}

	avgExecutionTime := conversationAgg.AvgExecutionTime
	maxExecutionTime := conversationAgg.MaxExecutionTime
	sumExecutionTime := int(conversationAgg.SumExecutionTime)

	return &AdminInsightsData{
		ActiveUsers24h: int(userStats.ActiveUsers24h),
		Messages24h:    int(messages24h),
		ConversationAggregate: ConversationAggregate{
			Count: int(conversationAgg.Count),
			Avg:   &avgExecutionTime,
			Max:   &maxExecutionTime,
			Sum:   &sumExecutionTime,
		},
		ModelUsage:           collections.Map(modelUsageRows, modelUsageEntryFromRow),
		SlowestConversations: collections.Map(slowestRows, slowConversationFromRow),
		InProgress:           int(inProgress),
		PlanCounts:           collections.Map(planCountsRows, planCountEntryFromRow),
		TopUsers:             collections.Map(topUsersRows, topUserEntryFromRow),
		Tokens24h:            tokenAggregateFromRow(tokens24h.PromptTokens, tokens24h.CompletionTokens, tokens24h.TotalTokens, tokens24h.CostMicros),
		TokensAllTime:        tokenAggregateFromRow(tokensAllTime.PromptTokens, tokensAllTime.CompletionTokens, tokensAllTime.TotalTokens, tokensAllTime.CostMicros),
		TokensByModel:        collections.Map(tokensByModel, tokensByModelEntryFromRow),
		ToolUsage:            collections.Map(toolUsageRows, toolUsageEntryFromRow),
		ToolSuccess:          collections.Map(toolSuccessRows, toolSuccessEntryFromRow),
	}, nil
}

func (r *RepositoryImpl) CreateIncident(ctx context.Context, serviceID, status, message string) error {
	_, err := r.q.CreateServiceIncident(ctx, CreateIncidentInput{
		ServiceID: serviceID,
		Status:    status,
		Message:   message,
	})
	if err != nil {
		slog.Error("Failed to create service incident", "serviceId", serviceID, "status", status, "error", err)
	}
	return err
}

func (r *RepositoryImpl) ListIncidents(ctx context.Context, limit int) ([]AdminIncident, error) {
	limit32, err := toInt32(limit, "limit")
	if err != nil {
		return nil, err
	}
	incidents, err := r.q.ListServiceIncidents(ctx, limit32)
	if err != nil {
		slog.Error("Failed to list service incidents", "limit", limit, "error", err)
		return nil, err
	}

	return collections.Map(incidents, adminIncidentFromRow), nil
}

func (r *RepositoryImpl) ListOrganizations(ctx context.Context) ([]AdminOrgRecord, error) {
	rows, err := r.q.ListOrganizationsForAdmin(ctx)
	if err != nil {
		slog.Error("Failed to list organizations for admin", "error", err)
		return nil, err
	}

	return collections.Map(rows, adminOrgRecordFromRow), nil
}

func (r *RepositoryImpl) UpdateOrganization(ctx context.Context, orgID int32, plan string, rpmQuota int, tokenQuota int64, workosID string) error {
	rpmQuota32, err := toInt32(rpmQuota, "rpmQuota")
	if err != nil {
		return err
	}

	err = r.q.UpdateOrganizationAdmin(ctx, UpdateOrganizationInput{
		Plan:             plan,
		WorkosOrgID:      workosID,
		RpmQuota:         rpmQuota32,
		TokensQuotaMonth: tokenQuota,
		ID:               orgID,
	})
	if err != nil {
		slog.Error("Failed to update organization for admin", "orgId", orgID, "plan", plan, "error", err)
	}
	return err
}

func (r *RepositoryImpl) UpdateUserPlan(ctx context.Context, email, plan string) (*AdminDashboardUser, error) {
	u, err := r.q.UpdateUserPlanByEmail(ctx, UpdateUserPlanByEmailInput{
		Email: email,
		Plan:  plan,
	})
	if err != nil {
		slog.Error("Failed to update user plan for admin", "email", email, "plan", plan, "error", err)
		return nil, err
	}
	return &AdminDashboardUser{
		ID:      int(u.ID),
		Email:   u.Email,
		Plan:    &u.Plan,
		IsAdmin: u.IsAdmin,
	}, nil
}

func (r *RepositoryImpl) UpdateUserPlanByID(ctx context.Context, id int32, plan string) (*AdminDashboardUser, error) {
	u, err := r.q.GetUserByID(ctx, id)
	if err != nil {
		slog.Error("Failed to fetch user by ID for plan update", "userId", id, "error", err)
		return nil, err
	}
	return r.UpdateUserPlan(ctx, u.Email, plan)
}

func (r *RepositoryImpl) UpdateUserAdmin(ctx context.Context, email string, isAdmin bool) (*AdminDashboardUser, error) {
	u, err := r.q.GetUserByEmail(ctx, email)
	if err != nil {
		slog.Error("Failed to find user by email for admin update", "email", email, "error", err)
		return nil, err
	}
	return r.UpdateUserAdminByID(ctx, u.ID, isAdmin)
}

func (r *RepositoryImpl) UpdateUserAdminByID(ctx context.Context, id int32, isAdmin bool) (*AdminDashboardUser, error) {
	u, err := r.q.UpdateUserAdminByID(ctx, UpdateUserAdminByIDInput{
		ID:      id,
		IsAdmin: isAdmin,
	})
	if err != nil {
		slog.Error("Failed to update user admin status", "userId", id, "isAdmin", isAdmin, "error", err)
		return nil, err
	}
	return &AdminDashboardUser{
		ID:      int(u.ID),
		Email:   u.Email,
		Plan:    &u.Plan,
		IsAdmin: u.IsAdmin,
	}, nil
}

func (r *RepositoryImpl) GetUserByID(ctx context.Context, id int32) (*AdminDashboardUser, error) {
	return r.getAdminUser(ctx, id)
}

func (r *RepositoryImpl) getAdminUser(ctx context.Context, id int32) (*AdminDashboardUser, error) {
	u, err := r.q.GetUserByID(ctx, id)
	if err != nil {
		slog.Error("Failed to get admin user by ID", "userId", id, "error", err)
		return nil, err
	}
	return &AdminDashboardUser{
		ID:      int(u.ID),
		Email:   u.Email,
		Plan:    &u.Plan,
		IsAdmin: u.IsAdmin,
	}, nil
}

func adminDashboardUserFromRecord(u AdminUserRecord) AdminDashboardUser {
	var lastMsg *time.Time
	if u.LastMessageTimestamp.Valid {
		lastMsg = &u.LastMessageTimestamp.Time
	}
	plan := u.Plan
	return AdminDashboardUser{
		ID:                   int(u.ID),
		Email:                u.Email,
		FullName:             u.FullName,
		Plan:                 &plan,
		IsAdmin:              u.IsAdmin,
		MessageCount:         new(int(u.MessageCount)),
		LastMessageTimestamp: lastMsg,
		Disabled:             u.Disabled,
	}
}

func auditLogRecordFromRow(l AuditLogRow) AuditLogRecord {
	return AuditLogRecord{
		ID:             int(l.ID),
		Timestamp:      l.Timestamp.Time,
		UserID:         l.UserID,
		OrganizationID: l.OrganizationID,
		Action:         l.Action,
		Resource:       l.Resource,
		ResourceID:     l.ResourceID,
		IPAddress:      l.IpAddress,
		UserAgent:      l.UserAgent,
		Details:        decodeAuditLogDetails(l.Details),
		Success:        l.Success,
		ErrorMessage:   l.ErrorMessage,
	}
}

func modelUsageEntryFromRow(row ModelUsageRow) ModelUsageEntry {
	return ModelUsageEntry{
		Model: row.Model,
		Count: int(row.Count),
	}
}

func slowConversationFromRow(row SlowConversationRow) SlowConversation {
	timestamp := time.Time{}
	if row.Timestamp.Valid {
		timestamp = row.Timestamp.Time
	}
	return SlowConversation{
		ID:            int(row.ID),
		ExecutionTime: row.ExecutionTime,
		UserID:        row.UserID,
		Timestamp:     timestamp,
	}
}

func planCountEntryFromRow(row PlanCountRow) PlanCountEntry {
	return PlanCountEntry{
		Plan:  row.Plan,
		Count: int(row.Count),
	}
}

func topUserEntryFromRow(row TopUserMessageCountRow) TopUserEntry {
	return TopUserEntry{
		ID:           int(row.ID),
		Email:        row.Email,
		Plan:         row.Plan,
		MessageCount: int(row.MessageCount),
	}
}

func tokenAggregateFromRow(promptTokens, completionTokens, totalTokens, costMicros int64) TokenAggregate {
	prompt := int(promptTokens)
	completion := int(completionTokens)
	total := int(totalTokens)
	cost := float64(costMicros)
	return TokenAggregate{
		PromptTokens:     &prompt,
		CompletionTokens: &completion,
		TotalTokens:      &total,
		CostMicros:       &cost,
	}
}

func tokensByModelEntryFromRow(row TokensByModelRow) TokensByModelEntry {
	totalTokens := int(row.TotalTokens)
	costMicros := float64(row.CostMicros)
	return TokensByModelEntry{
		Model:       row.Model,
		TotalTokens: &totalTokens,
		CostMicros:  &costMicros,
	}
}

func toolUsageEntryFromRow(row ToolUsageRow) ToolUsageEntry {
	sumDuration := float64(row.SumDurationMs)
	avgDuration := row.AvgDurationMs
	return ToolUsageEntry{
		ToolName:    row.ToolName,
		Count:       int(row.Count),
		SumDuration: &sumDuration,
		AvgDuration: &avgDuration,
	}
}

func toolSuccessEntryFromRow(row ToolSuccessRow) ToolSuccessEntry {
	return ToolSuccessEntry{
		ToolName: row.ToolName,
		Success:  row.Success,
		Count:    int(row.Count),
	}
}

func adminIncidentFromRow(incident ServiceIncidentRow) AdminIncident {
	return AdminIncident{
		ID:         int(incident.ID),
		ServiceID:  incident.ServiceID,
		Status:     incident.Status,
		Message:    incident.Message,
		StartedAt:  timestampPtrFromPG(incident.StartedAt),
		ResolvedAt: timestampPtrFromPG(incident.ResolvedAt),
	}
}

func adminOrgRecordFromRow(row OrganizationAdminRow) AdminOrgRecord {
	workosOrgID := ""
	if row.WorkosOrganizationID != nil {
		workosOrgID = *row.WorkosOrganizationID
	}
	// #nosec G115
	memberCount := int(row.MemberCount)
	// #nosec G115
	rpmQuota := int(row.RpmQuota)

	createdAt := ""
	if row.CreatedAt.Valid {
		createdAt = row.CreatedAt.Time.UTC().Format(time.RFC3339)
	}

	return AdminOrgRecord{
		ID:               row.ID,
		Name:             row.Name,
		Slug:             row.Slug,
		Plan:             row.Plan,
		WorkosOrgID:      workosOrgID,
		MemberCount:      memberCount,
		RPMQuota:         rpmQuota,
		TokensQuotaMonth: row.TokensQuotaMonth,
		CreatedAt:        createdAt,
	}
}

func decodeAuditLogDetails(raw []byte) any {
	if len(raw) == 0 {
		return nil
	}

	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return string(raw)
	}
	return decoded
}

func toPgTimestamp(t *time.Time) pgtype.Timestamp {
	if t == nil {
		return pgtype.Timestamp{}
	}
	return pgtype.Timestamp{Time: *t, Valid: true}
}

func timestampPtrFromPG(ts pgtype.Timestamp) *time.Time {
	if !ts.Valid {
		return nil
	}
	value := ts.Time
	return &value
}

//go:fix inline

func toInt32(value int, fieldName string) (int32, error) {
	if value > math.MaxInt32 || value < math.MinInt32 {
		return 0, fmt.Errorf("%s out of int32 range: %d", fieldName, value)
	}
	return int32(value), nil
}
