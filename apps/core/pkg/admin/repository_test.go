package admin

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var ErrNotImplemented = errors.New("not implemented")

type mockAdminQueries struct {
	getUserStatsFunc                      func(ctx context.Context) (UserStatsRow, error)
	countAllConversationsFunc             func(ctx context.Context) (int64, error)
	listUsersFunc                         func(ctx context.Context, arg ListUsersInput) ([]AdminUserRecord, error)
	countUsersFunc                        func(ctx context.Context) (int64, error)
	listUsersForAdminFunc                 func(ctx context.Context, arg ListUsersForAdminInput) ([]AdminUserRecord, error)
	countUsersForAdminFunc                func(ctx context.Context, arg CountUsersForAdminInput) (int64, error)
	getAuditLogsFilteredFunc              func(ctx context.Context, arg AuditLogQueryInput) ([]AuditLogRow, error)
	countAuditLogsFilteredFunc            func(ctx context.Context, arg CountAuditLogsInput) (int64, error)
	getUserByEmailFunc                    func(ctx context.Context, email string) (AdminUserRecord, error)
	updateUserPlanByEmailFunc             func(ctx context.Context, arg UpdateUserPlanByEmailInput) (AdminUserRecord, error)
	getUserByIDFunc                       func(ctx context.Context, id int32) (AdminUserRecord, error)
	updateUserAdminByIDFunc               func(ctx context.Context, arg UpdateUserAdminByIDInput) (AdminUserRecord, error)
	updateAdminUserFieldsFunc             func(ctx context.Context, arg UpdateAdminUserFieldsInput) error
	countMessagesSinceFunc                func(ctx context.Context, createdAt pgtype.Timestamp) (int64, error)
	getConversationAggregateSinceFunc     func(ctx context.Context, timestamp pgtype.Timestamp) (ConversationAggregateRow, error)
	getModelUsageSinceFunc                func(ctx context.Context, arg TimestampLimitInput) ([]ModelUsageRow, error)
	getSlowestConversationsSinceFunc      func(ctx context.Context, arg TimestampLimitInput) ([]SlowConversationRow, error)
	countInProgressConversationsSinceFunc func(ctx context.Context, createdAt pgtype.Timestamp) (int64, error)
	getPlanCountsFunc                     func(ctx context.Context) ([]PlanCountRow, error)
	getTopUsersByMessageCountFunc         func(ctx context.Context, limit int32) ([]TopUserMessageCountRow, error)
	getTokenAggregateSinceFunc            func(ctx context.Context, createdAt pgtype.Timestamp) (TokenAggregateRow, error)
	getTokenAggregateAllTimeFunc          func(ctx context.Context) (TokenAggregateAllTimeRow, error)
	getTokensByModelSinceFunc             func(ctx context.Context, arg CreatedAtLimitInput) ([]TokensByModelRow, error)
	getToolUsageSinceFunc                 func(ctx context.Context, createdAt pgtype.Timestamp) ([]ToolUsageRow, error)
	getToolSuccessSinceFunc               func(ctx context.Context, createdAt pgtype.Timestamp) ([]ToolSuccessRow, error)
	createServiceIncidentFunc             func(ctx context.Context, arg CreateIncidentInput) (ServiceIncidentRow, error)
	listServiceIncidentsFunc              func(ctx context.Context, limit int32) ([]ServiceIncidentRow, error)
	listOrganizationsForAdminFunc         func(ctx context.Context) ([]OrganizationAdminRow, error)
	updateOrganizationAdminFunc           func(ctx context.Context, arg UpdateOrganizationInput) error
}

func (m *mockAdminQueries) GetUserStats(ctx context.Context) (UserStatsRow, error) {
	if m.getUserStatsFunc == nil {
		return UserStatsRow{}, ErrNotImplemented
	}
	return m.getUserStatsFunc(ctx)
}

func (m *mockAdminQueries) CountAllConversations(ctx context.Context) (int64, error) {
	if m.countAllConversationsFunc == nil {
		return 0, ErrNotImplemented
	}
	return m.countAllConversationsFunc(ctx)
}

func (m *mockAdminQueries) ListUsers(ctx context.Context, arg ListUsersInput) ([]AdminUserRecord, error) {
	if m.listUsersFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.listUsersFunc(ctx, arg)
}

func (m *mockAdminQueries) CountUsers(ctx context.Context) (int64, error) {
	if m.countUsersFunc == nil {
		return 0, ErrNotImplemented
	}
	return m.countUsersFunc(ctx)
}

func (m *mockAdminQueries) ListUsersForAdmin(ctx context.Context, arg ListUsersForAdminInput) ([]AdminUserRecord, error) {
	if m.listUsersForAdminFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.listUsersForAdminFunc(ctx, arg)
}

func (m *mockAdminQueries) CountUsersForAdmin(ctx context.Context, arg CountUsersForAdminInput) (int64, error) {
	if m.countUsersForAdminFunc == nil {
		return 0, ErrNotImplemented
	}
	return m.countUsersForAdminFunc(ctx, arg)
}

func (m *mockAdminQueries) GetAuditLogsFiltered(ctx context.Context, arg AuditLogQueryInput) ([]AuditLogRow, error) {
	if m.getAuditLogsFilteredFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.getAuditLogsFilteredFunc(ctx, arg)
}

func (m *mockAdminQueries) CountAuditLogsFiltered(ctx context.Context, arg CountAuditLogsInput) (int64, error) {
	if m.countAuditLogsFilteredFunc == nil {
		return 0, ErrNotImplemented
	}
	return m.countAuditLogsFilteredFunc(ctx, arg)
}

func (m *mockAdminQueries) GetUserByEmail(ctx context.Context, email string) (AdminUserRecord, error) {
	if m.getUserByEmailFunc == nil {
		return AdminUserRecord{}, ErrNotImplemented
	}
	return m.getUserByEmailFunc(ctx, email)
}

func (m *mockAdminQueries) UpdateUserPlanByEmail(ctx context.Context, arg UpdateUserPlanByEmailInput) (AdminUserRecord, error) {
	if m.updateUserPlanByEmailFunc == nil {
		return AdminUserRecord{}, ErrNotImplemented
	}
	return m.updateUserPlanByEmailFunc(ctx, arg)
}

func (m *mockAdminQueries) GetUserByID(ctx context.Context, id int32) (AdminUserRecord, error) {
	if m.getUserByIDFunc == nil {
		return AdminUserRecord{}, ErrNotImplemented
	}
	return m.getUserByIDFunc(ctx, id)
}

func (m *mockAdminQueries) UpdateUserAdminByID(ctx context.Context, arg UpdateUserAdminByIDInput) (AdminUserRecord, error) {
	if m.updateUserAdminByIDFunc == nil {
		return AdminUserRecord{}, ErrNotImplemented
	}
	return m.updateUserAdminByIDFunc(ctx, arg)
}

func (m *mockAdminQueries) UpdateAdminUserFields(ctx context.Context, arg UpdateAdminUserFieldsInput) error {
	if m.updateAdminUserFieldsFunc != nil {
		return m.updateAdminUserFieldsFunc(ctx, arg)
	}
	return nil
}

func (m *mockAdminQueries) CountMessagesSince(ctx context.Context, createdAt pgtype.Timestamp) (int64, error) {
	if m.countMessagesSinceFunc == nil {
		return 0, ErrNotImplemented
	}
	return m.countMessagesSinceFunc(ctx, createdAt)
}

func (m *mockAdminQueries) GetConversationAggregateSince(ctx context.Context, timestamp pgtype.Timestamp) (ConversationAggregateRow, error) {
	if m.getConversationAggregateSinceFunc == nil {
		return ConversationAggregateRow{}, ErrNotImplemented
	}
	return m.getConversationAggregateSinceFunc(ctx, timestamp)
}

func (m *mockAdminQueries) GetModelUsageSince(ctx context.Context, arg TimestampLimitInput) ([]ModelUsageRow, error) {
	if m.getModelUsageSinceFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.getModelUsageSinceFunc(ctx, arg)
}

func (m *mockAdminQueries) GetSlowestConversationsSince(ctx context.Context, arg TimestampLimitInput) ([]SlowConversationRow, error) {
	if m.getSlowestConversationsSinceFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.getSlowestConversationsSinceFunc(ctx, arg)
}

func (m *mockAdminQueries) CountInProgressConversationsSince(ctx context.Context, createdAt pgtype.Timestamp) (int64, error) {
	if m.countInProgressConversationsSinceFunc == nil {
		return 0, ErrNotImplemented
	}
	return m.countInProgressConversationsSinceFunc(ctx, createdAt)
}

func (m *mockAdminQueries) GetPlanCounts(ctx context.Context) ([]PlanCountRow, error) {
	if m.getPlanCountsFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.getPlanCountsFunc(ctx)
}

func (m *mockAdminQueries) GetTopUsersByMessageCount(ctx context.Context, limit int32) ([]TopUserMessageCountRow, error) {
	if m.getTopUsersByMessageCountFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.getTopUsersByMessageCountFunc(ctx, limit)
}

func (m *mockAdminQueries) GetTokenAggregateSince(ctx context.Context, createdAt pgtype.Timestamp) (TokenAggregateRow, error) {
	if m.getTokenAggregateSinceFunc == nil {
		return TokenAggregateRow{}, ErrNotImplemented
	}
	return m.getTokenAggregateSinceFunc(ctx, createdAt)
}

func (m *mockAdminQueries) GetTokenAggregateAllTime(ctx context.Context) (TokenAggregateAllTimeRow, error) {
	if m.getTokenAggregateAllTimeFunc == nil {
		return TokenAggregateAllTimeRow{}, ErrNotImplemented
	}
	return m.getTokenAggregateAllTimeFunc(ctx)
}

func (m *mockAdminQueries) GetTokensByModelSince(ctx context.Context, arg CreatedAtLimitInput) ([]TokensByModelRow, error) {
	if m.getTokensByModelSinceFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.getTokensByModelSinceFunc(ctx, arg)
}

func (m *mockAdminQueries) GetToolUsageSince(ctx context.Context, createdAt pgtype.Timestamp) ([]ToolUsageRow, error) {
	if m.getToolUsageSinceFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.getToolUsageSinceFunc(ctx, createdAt)
}

func (m *mockAdminQueries) GetToolSuccessSince(ctx context.Context, createdAt pgtype.Timestamp) ([]ToolSuccessRow, error) {
	if m.getToolSuccessSinceFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.getToolSuccessSinceFunc(ctx, createdAt)
}

func (m *mockAdminQueries) CreateServiceIncident(ctx context.Context, arg CreateIncidentInput) (ServiceIncidentRow, error) {
	if m.createServiceIncidentFunc == nil {
		return ServiceIncidentRow{}, ErrNotImplemented
	}
	return m.createServiceIncidentFunc(ctx, arg)
}

func (m *mockAdminQueries) ListServiceIncidents(ctx context.Context, limit int32) ([]ServiceIncidentRow, error) {
	if m.listServiceIncidentsFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.listServiceIncidentsFunc(ctx, limit)
}

func (m *mockAdminQueries) ListOrganizationsForAdmin(ctx context.Context) ([]OrganizationAdminRow, error) {
	if m.listOrganizationsForAdminFunc == nil {
		return nil, ErrNotImplemented
	}
	return m.listOrganizationsForAdminFunc(ctx)
}

func (m *mockAdminQueries) UpdateOrganizationAdmin(ctx context.Context, arg UpdateOrganizationInput) error {
	if m.updateOrganizationAdminFunc == nil {
		return ErrNotImplemented
	}
	return m.updateOrganizationAdminFunc(ctx, arg)
}

func TestRepository_GetDashboardCounts(t *testing.T) {
	q := &mockAdminQueries{
		getUserStatsFunc: func(ctx context.Context) (UserStatsRow, error) {
			return UserStatsRow{TotalUsers: 10, FreeUsers: 4}, nil
		},
		countAllConversationsFunc: func(ctx context.Context) (int64, error) {
			return 25, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	counts, err := repo.GetDashboardCounts(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 10, counts.TotalUsers)
	assert.Equal(t, 25, counts.TotalConversations)
	assert.Equal(t, 4, counts.FreeUsers)
}

func TestRepository_NewRepository(t *testing.T) {
	repo, ok := NewRepository(&mockAdminQueries{}).(*RepositoryImpl)
	require.True(t, ok)
	assert.NotNil(t, repo)
}

func TestRepository_ListUsers(t *testing.T) {
	now := time.Now()
	q := &mockAdminQueries{
		listUsersFunc: func(ctx context.Context, arg ListUsersInput) ([]AdminUserRecord, error) {
			return []AdminUserRecord{{
				ID:                   1,
				Email:                "user@example.com",
				Plan:                 "pro",
				IsAdmin:              true,
				MessageCount:         3,
				LastMessageTimestamp: pgtype.Timestamp{Time: now, Valid: true},
			}}, nil
		},
		countUsersFunc: func(ctx context.Context) (int64, error) {
			return 1, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	page, err := repo.ListUsers(context.Background(), 10, 0)
	require.NoError(t, err)
	require.Len(t, page.Users, 1)
	assert.Equal(t, 1, page.Total)
	assert.Equal(t, "user@example.com", page.Users[0].Email)
	require.NotNil(t, page.Users[0].LastMessageTimestamp)
}

func TestRepository_ListUsersRejectsOutOfRangePagination(t *testing.T) {
	repo := &RepositoryImpl{q: &mockAdminQueries{}}

	_, err := repo.ListUsers(context.Background(), math.MaxInt64, 0)
	require.Error(t, err)

	_, err = repo.ListUsers(context.Background(), 10, math.MaxInt64)
	require.Error(t, err)
}

func TestRepository_ListUsersFiltered(t *testing.T) {
	q := &mockAdminQueries{
		listUsersForAdminFunc: func(_ context.Context, arg ListUsersForAdminInput) ([]AdminUserRecord, error) {
			assert.Equal(t, "clay", arg.Search)
			assert.Equal(t, "pro", arg.Plan)
			assert.Equal(t, int32(25), arg.PageLimit)
			assert.Equal(t, int32(50), arg.PageOffset)
			return []AdminUserRecord{{ID: 3, Email: "clay@example.com", Plan: "pro"}}, nil
		},
		countUsersForAdminFunc: func(_ context.Context, arg CountUsersForAdminInput) (int64, error) {
			assert.Equal(t, "clay", arg.Search)
			assert.Equal(t, "pro", arg.Plan)
			return 1, nil
		},
	}

	page, err := (&RepositoryImpl{q: q}).ListUsersFiltered(
		context.Background(),
		AdminUserFilters{Search: " clay ", Plan: " pro "},
		25,
		50,
	)

	require.NoError(t, err)
	require.Len(t, page.Users, 1)
	assert.Equal(t, 1, page.Total)
}

func TestRepository_ListUsersFilteredRejectsInvalidPaginationAndDatabaseErrors(t *testing.T) {
	repo := &RepositoryImpl{q: &mockAdminQueries{}}

	_, err := repo.ListUsersFiltered(context.Background(), AdminUserFilters{}, math.MaxInt64, 0)
	require.Error(t, err)
	_, err = repo.ListUsersFiltered(context.Background(), AdminUserFilters{}, 10, math.MaxInt64)
	require.Error(t, err)

	queryErr := errors.New("list filtered users")
	repo.q = &mockAdminQueries{
		listUsersForAdminFunc: func(context.Context, ListUsersForAdminInput) ([]AdminUserRecord, error) {
			return nil, queryErr
		},
	}
	_, err = repo.ListUsersFiltered(context.Background(), AdminUserFilters{}, 10, 0)
	require.ErrorIs(t, err, queryErr)

	countErr := errors.New("count filtered users")
	repo.q = &mockAdminQueries{
		listUsersForAdminFunc: func(context.Context, ListUsersForAdminInput) ([]AdminUserRecord, error) {
			return nil, nil
		},
		countUsersForAdminFunc: func(context.Context, CountUsersForAdminInput) (int64, error) {
			return 0, countErr
		},
	}
	_, err = repo.ListUsersFiltered(context.Background(), AdminUserFilters{}, 10, 0)
	require.ErrorIs(t, err, countErr)
}

func TestRepository_ListAuditLogs(t *testing.T) {
	timestamp := pgtype.Timestamp{Time: time.Now(), Valid: true}
	q := &mockAdminQueries{
		getAuditLogsFilteredFunc: func(ctx context.Context, arg AuditLogQueryInput) ([]AuditLogRow, error) {
			return []AuditLogRow{{ID: 7, Timestamp: timestamp, Action: "login", Resource: "auth", Success: true}}, nil
		},
		countAuditLogsFilteredFunc: func(ctx context.Context, arg CountAuditLogsInput) (int64, error) {
			return 1, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	page, err := repo.ListAuditLogs(context.Background(), AuditLogFilters{}, 10, 0)
	require.NoError(t, err)
	require.Len(t, page.Logs, 1)
	assert.Equal(t, 1, page.Total)
	assert.Equal(t, "login", page.Logs[0].Action)
}

func TestRepository_ListAuditLogsRejectsOutOfRangePagination(t *testing.T) {
	repo := &RepositoryImpl{q: &mockAdminQueries{}}

	_, err := repo.ListAuditLogs(context.Background(), AuditLogFilters{}, math.MaxInt64, 0)
	require.Error(t, err)

	_, err = repo.ListAuditLogs(context.Background(), AuditLogFilters{}, 10, math.MaxInt64)
	require.Error(t, err)
}

func TestRepository_ListAuditLogs_FilterNotImplemented(t *testing.T) {
	repo := &RepositoryImpl{q: &mockAdminQueries{}}
	userID := "1"

	_, err := repo.ListAuditLogs(context.Background(), AuditLogFilters{UserID: &userID}, 10, 0)
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNotImplemented)
}

func TestRepository_FindUserByEmail(t *testing.T) {
	q := &mockAdminQueries{
		getUserByEmailFunc: func(ctx context.Context, email string) (AdminUserRecord, error) {
			return AdminUserRecord{ID: 9, Email: email, IsAdmin: true}, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	user, err := repo.FindUserByEmail(context.Background(), "a@example.com")
	require.NoError(t, err)
	assert.Equal(t, 9, user.ID)
	assert.True(t, user.IsAdmin)
}

func TestRepository_UpdateUserPlan(t *testing.T) {
	q := &mockAdminQueries{
		updateUserPlanByEmailFunc: func(ctx context.Context, arg UpdateUserPlanByEmailInput) (AdminUserRecord, error) {
			return AdminUserRecord{ID: 2, Email: arg.Email, Plan: arg.Plan, IsAdmin: false}, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	user, err := repo.UpdateUserPlan(context.Background(), "a@example.com", "pro")
	require.NoError(t, err)
	assert.Equal(t, "a@example.com", user.Email)
	require.NotNil(t, user.Plan)
	assert.Equal(t, "pro", *user.Plan)
}

func TestRepository_UpdateUserAdmin_Error(t *testing.T) {
	q := &mockAdminQueries{
		getUserByEmailFunc: func(ctx context.Context, email string) (AdminUserRecord, error) {
			return AdminUserRecord{}, errors.New("not found")
		},
		getUserByIDFunc: func(ctx context.Context, id int32) (AdminUserRecord, error) {
			return AdminUserRecord{}, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	_, err := repo.UpdateUserAdmin(context.Background(), "a@example.com", true)
	require.Error(t, err)
}

func TestRepository_UpdateUserAdmin_Success(t *testing.T) {
	q := &mockAdminQueries{
		getUserByEmailFunc: func(ctx context.Context, email string) (AdminUserRecord, error) {
			return AdminUserRecord{ID: 4, Email: email}, nil
		},
		updateUserAdminByIDFunc: func(ctx context.Context, arg UpdateUserAdminByIDInput) (AdminUserRecord, error) {
			return AdminUserRecord{ID: arg.ID, Email: "a@example.com", Plan: "pro", IsAdmin: arg.IsAdmin}, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	user, err := repo.UpdateUserAdmin(context.Background(), "a@example.com", true)
	require.NoError(t, err)
	assert.Equal(t, 4, user.ID)
	assert.True(t, user.IsAdmin)
}

func TestRepository_StubbedMethods(t *testing.T) {
	repo := &RepositoryImpl{q: &mockAdminQueries{}}

	err := repo.CreateIncident(context.Background(), "api", "degraded", "message")
	require.ErrorIs(t, err, ErrNotImplemented)

	incidents, err := repo.ListIncidents(context.Background(), 10)
	require.Error(t, err)
	assert.Nil(t, incidents)
	require.ErrorIs(t, err, ErrNotImplemented)

	orgs, err := repo.ListOrganizations(context.Background())
	require.Error(t, err)
	assert.Nil(t, orgs)
	require.ErrorIs(t, err, ErrNotImplemented)

	err = repo.UpdateOrganization(context.Background(), 1, "pro", 10, 1000, "workos")
	assert.ErrorIs(t, err, ErrNotImplemented)
}

func TestRepository_IncidentAndOrganizationSuccess(t *testing.T) {
	now := time.Now().UTC()
	q := &mockAdminQueries{
		createServiceIncidentFunc: func(ctx context.Context, arg CreateIncidentInput) (ServiceIncidentRow, error) {
			return ServiceIncidentRow{ID: 1, ServiceID: arg.ServiceID, Status: arg.Status, Message: arg.Message}, nil
		},
		listServiceIncidentsFunc: func(ctx context.Context, limit int32) ([]ServiceIncidentRow, error) {
			return []ServiceIncidentRow{{
				ID:         2,
				ServiceID:  "core",
				Status:     "resolved",
				Message:    "done",
				StartedAt:  pgtype.Timestamp{Time: now, Valid: true},
				ResolvedAt: pgtype.Timestamp{Time: now.Add(time.Hour), Valid: true},
			}}, nil
		},
		listOrganizationsForAdminFunc: func(ctx context.Context) ([]OrganizationAdminRow, error) {
			return []OrganizationAdminRow{{
				ID:                   30,
				Name:                 "TaskForceAI",
				Slug:                 "taskforceai",
				Plan:                 "pro",
				WorkosOrganizationID: new("workos"),
				MemberCount:          2,
				CreatedAt:            pgtype.Timestamp{Time: now, Valid: true},
				RpmQuota:             120,
				TokensQuotaMonth:     1000,
			}}, nil
		},
		updateOrganizationAdminFunc: func(ctx context.Context, arg UpdateOrganizationInput) error {
			assert.Equal(t, int32(30), arg.ID)
			assert.Equal(t, int32(120), arg.RpmQuota)
			return nil
		},
	}
	repo := &RepositoryImpl{q: q}

	require.NoError(t, repo.CreateIncident(context.Background(), "core", "open", "message"))

	incidents, err := repo.ListIncidents(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, incidents, 1)
	assert.Equal(t, "resolved", incidents[0].Status)
	require.NotNil(t, incidents[0].ResolvedAt)

	orgs, err := repo.ListOrganizations(context.Background())
	require.NoError(t, err)
	require.Len(t, orgs, 1)
	assert.Equal(t, "workos", orgs[0].WorkosOrgID)
	assert.NotEmpty(t, orgs[0].CreatedAt)

	require.NoError(t, repo.UpdateOrganization(context.Background(), 30, "pro", 120, 1000, "workos"))
}

func TestRepository_Helpers(t *testing.T) {
	now := time.Now().UTC()

	assert.Nil(t, decodeAuditLogDetails(nil))
	assert.Equal(t, "not-json", decodeAuditLogDetails([]byte("not-json")))
	assert.Equal(t, map[string]any{"ok": true}, decodeAuditLogDetails([]byte(`{"ok":true}`)))

	assert.False(t, toPgTimestamp(nil).Valid)
	assert.True(t, toPgTimestamp(&now).Valid)
	assert.Nil(t, timestampPtrFromPG(pgtype.Timestamp{}))
	require.NotNil(t, timestampPtrFromPG(pgtype.Timestamp{Time: now, Valid: true}))
}

func TestRepository_FetchInsightsData(t *testing.T) {
	repo := &RepositoryImpl{q: &mockAdminQueries{}}

	data, err := repo.FetchInsightsData(context.Background(), time.Now(), time.Now())
	require.Error(t, err)
	assert.Nil(t, data)
	assert.ErrorIs(t, err, ErrNotImplemented)
}

func TestRepository_FetchInsightsData_Success(t *testing.T) {
	now := time.Now().UTC()
	q := &mockAdminQueries{
		getUserStatsFunc: func(ctx context.Context) (UserStatsRow, error) {
			return UserStatsRow{ActiveUsers24h: 3}, nil
		},
		countMessagesSinceFunc: func(ctx context.Context, createdAt pgtype.Timestamp) (int64, error) {
			return 12, nil
		},
		getConversationAggregateSinceFunc: func(ctx context.Context, timestamp pgtype.Timestamp) (ConversationAggregateRow, error) {
			return ConversationAggregateRow{Count: 4, AvgExecutionTime: 1.25, MaxExecutionTime: 3.5, SumExecutionTime: 8}, nil
		},
		getModelUsageSinceFunc: func(ctx context.Context, arg TimestampLimitInput) ([]ModelUsageRow, error) {
			return []ModelUsageRow{{Model: "gpt-5", Count: 4}}, nil
		},
		getSlowestConversationsSinceFunc: func(ctx context.Context, arg TimestampLimitInput) ([]SlowConversationRow, error) {
			return []SlowConversationRow{{ID: 9, ExecutionTime: new(3.5), UserID: new("user_1"), Timestamp: pgtype.Timestamp{Time: now, Valid: true}}}, nil
		},
		countInProgressConversationsSinceFunc: func(ctx context.Context, createdAt pgtype.Timestamp) (int64, error) {
			return 2, nil
		},
		getPlanCountsFunc: func(ctx context.Context) ([]PlanCountRow, error) {
			return []PlanCountRow{{Plan: "pro", Count: 2}}, nil
		},
		getTopUsersByMessageCountFunc: func(ctx context.Context, limit int32) ([]TopUserMessageCountRow, error) {
			return []TopUserMessageCountRow{{ID: 1, Email: "clay@example.com", Plan: "pro", MessageCount: 5}}, nil
		},
		getTokenAggregateSinceFunc: func(ctx context.Context, createdAt pgtype.Timestamp) (TokenAggregateRow, error) {
			return TokenAggregateRow{PromptTokens: 10, CompletionTokens: 8, TotalTokens: 18, CostMicros: 2500}, nil
		},
		getTokenAggregateAllTimeFunc: func(ctx context.Context) (TokenAggregateAllTimeRow, error) {
			return TokenAggregateAllTimeRow{PromptTokens: 100, CompletionTokens: 80, TotalTokens: 180, CostMicros: 25000}, nil
		},
		getTokensByModelSinceFunc: func(ctx context.Context, arg CreatedAtLimitInput) ([]TokensByModelRow, error) {
			return []TokensByModelRow{{Model: "gpt-5", TotalTokens: 18, CostMicros: 2500}}, nil
		},
		getToolUsageSinceFunc: func(ctx context.Context, createdAt pgtype.Timestamp) ([]ToolUsageRow, error) {
			return []ToolUsageRow{{ToolName: "search", Count: 3, SumDurationMs: 90, AvgDurationMs: 30}}, nil
		},
		getToolSuccessSinceFunc: func(ctx context.Context, createdAt pgtype.Timestamp) ([]ToolSuccessRow, error) {
			return []ToolSuccessRow{{ToolName: "search", Success: true, Count: 3}}, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	data, err := repo.FetchInsightsData(context.Background(), now.Add(-24*time.Hour), now.Add(-5*time.Minute))
	require.NoError(t, err)
	assert.Equal(t, 3, data.ActiveUsers24h)
	assert.Equal(t, 12, data.Messages24h)
	assert.Equal(t, 4, data.ConversationAggregate.Count)
	require.Len(t, data.ModelUsage, 1)
	require.Len(t, data.SlowestConversations, 1)
	require.Len(t, data.ToolSuccess, 1)
	require.NotNil(t, data.Tokens24h.PromptTokens)
	require.NotNil(t, data.Tokens24h.CompletionTokens)
	require.NotNil(t, data.Tokens24h.TotalTokens)
	require.NotNil(t, data.Tokens24h.CostMicros)
	assert.Equal(t, 10, *data.Tokens24h.PromptTokens)
	assert.Equal(t, 8, *data.Tokens24h.CompletionTokens)
	assert.Equal(t, 18, *data.Tokens24h.TotalTokens)
	assert.Equal(t, float64(2500), *data.Tokens24h.CostMicros)
	require.NotNil(t, data.TokensAllTime.PromptTokens)
	require.NotNil(t, data.TokensAllTime.CompletionTokens)
	require.NotNil(t, data.TokensAllTime.TotalTokens)
	require.NotNil(t, data.TokensAllTime.CostMicros)
	assert.Equal(t, 100, *data.TokensAllTime.PromptTokens)
	assert.Equal(t, 80, *data.TokensAllTime.CompletionTokens)
	assert.Equal(t, 180, *data.TokensAllTime.TotalTokens)
	assert.Equal(t, float64(25000), *data.TokensAllTime.CostMicros)
}

func TestRepository_ListIncidentsRejectsOutOfRangeLimit(t *testing.T) {
	repo := &RepositoryImpl{q: &mockAdminQueries{}}

	_, err := repo.ListIncidents(context.Background(), math.MaxInt64)

	require.Error(t, err)
}

func TestRepository_UpdateUserPlanByID(t *testing.T) {
	q := &mockAdminQueries{
		getUserByIDFunc: func(ctx context.Context, id int32) (AdminUserRecord, error) {
			return AdminUserRecord{ID: id, Email: "user@example.com"}, nil
		},
		updateUserPlanByEmailFunc: func(ctx context.Context, arg UpdateUserPlanByEmailInput) (AdminUserRecord, error) {
			return AdminUserRecord{ID: 1, Email: arg.Email, Plan: arg.Plan}, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	user, err := repo.UpdateUserPlanByID(context.Background(), 1, "pro")
	require.NoError(t, err)
	assert.Equal(t, "user@example.com", user.Email)
	assert.Equal(t, "pro", *user.Plan)

	// Error case
	q.getUserByIDFunc = func(ctx context.Context, id int32) (AdminUserRecord, error) {
		return AdminUserRecord{}, errors.New("not found")
	}
	_, err = repo.UpdateUserPlanByID(context.Background(), 2, "pro")
	require.Error(t, err)
}

func TestRepository_UpdateUserAdminByID(t *testing.T) {
	q := &mockAdminQueries{
		updateUserAdminByIDFunc: func(ctx context.Context, arg UpdateUserAdminByIDInput) (AdminUserRecord, error) {
			return AdminUserRecord{ID: arg.ID, IsAdmin: arg.IsAdmin}, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	user, err := repo.UpdateUserAdminByID(context.Background(), 1, true)
	require.NoError(t, err)
	assert.True(t, user.IsAdmin)

	q.updateUserAdminByIDFunc = func(ctx context.Context, arg UpdateUserAdminByIDInput) (AdminUserRecord, error) {
		return AdminUserRecord{}, errors.New("db error")
	}
	_, err = repo.UpdateUserAdminByID(context.Background(), 1, false)
	require.Error(t, err)
}

func TestRepository_UpdateUser_UsesSingleAtomicQuery(t *testing.T) {
	plan := "pro"
	isAdmin := true
	calls := 0
	q := &mockAdminQueries{
		updateAdminUserFieldsFunc: func(ctx context.Context, arg UpdateAdminUserFieldsInput) error {
			calls++
			assert.Nil(t, arg.UserID)
			assert.Equal(t, "user@example.com", arg.Email)
			assert.Equal(t, &plan, arg.Plan)
			assert.Equal(t, &isAdmin, arg.IsAdmin)
			return nil
		},
	}
	repo := NewRepository(q)

	err := repo.UpdateUser(context.Background(), AdminUserUpdate{
		Email: "user@example.com", Plan: &plan, IsAdmin: &isAdmin,
	})
	require.NoError(t, err)
	assert.Equal(t, 1, calls)
}

func TestRepository_GetUserByID(t *testing.T) {
	q := &mockAdminQueries{
		getUserByIDFunc: func(ctx context.Context, id int32) (AdminUserRecord, error) {
			return AdminUserRecord{ID: id, Email: "id@example.com"}, nil
		},
	}
	repo := &RepositoryImpl{q: q}

	user, err := repo.GetUserByID(context.Background(), 123)
	require.NoError(t, err)
	assert.Equal(t, 123, user.ID)
	assert.Equal(t, "id@example.com", user.Email)

	// Error case
	q.getUserByIDFunc = func(ctx context.Context, id int32) (AdminUserRecord, error) {
		return AdminUserRecord{}, errors.New("db error")
	}
	_, err = repo.GetUserByID(context.Background(), 456)
	require.Error(t, err)
}

func TestRepository_GetDashboardCounts_Error(t *testing.T) {
	q := &mockAdminQueries{
		getUserStatsFunc: func(ctx context.Context) (UserStatsRow, error) {
			return UserStatsRow{}, errors.New("db error")
		},
	}
	repo := &RepositoryImpl{q: q}
	_, err := repo.GetDashboardCounts(context.Background())
	require.Error(t, err)

	q.getUserStatsFunc = func(ctx context.Context) (UserStatsRow, error) {
		return UserStatsRow{}, nil
	}
	q.countAllConversationsFunc = func(ctx context.Context) (int64, error) {
		return 0, errors.New("db error")
	}
	_, err = repo.GetDashboardCounts(context.Background())
	require.Error(t, err)
}

func TestRepository_ListUsers_Error(t *testing.T) {
	q := &mockAdminQueries{
		listUsersFunc: func(ctx context.Context, arg ListUsersInput) ([]AdminUserRecord, error) {
			return nil, errors.New("db error")
		},
	}
	repo := &RepositoryImpl{q: q}
	_, err := repo.ListUsers(context.Background(), 10, 0)
	require.Error(t, err)

	q.listUsersFunc = func(ctx context.Context, arg ListUsersInput) ([]AdminUserRecord, error) {
		return []AdminUserRecord{}, nil
	}
	q.countUsersFunc = func(ctx context.Context) (int64, error) {
		return 0, errors.New("db error")
	}
	_, err = repo.ListUsers(context.Background(), 10, 0)
	require.Error(t, err)
}

func TestRepository_ListAuditLogs_Error(t *testing.T) {
	q := &mockAdminQueries{
		getAuditLogsFilteredFunc: func(ctx context.Context, arg AuditLogQueryInput) ([]AuditLogRow, error) {
			return nil, errors.New("db error")
		},
	}
	repo := &RepositoryImpl{q: q}
	_, err := repo.ListAuditLogs(context.Background(), AuditLogFilters{}, 10, 0)
	require.Error(t, err)

	q.getAuditLogsFilteredFunc = func(ctx context.Context, arg AuditLogQueryInput) ([]AuditLogRow, error) {
		return []AuditLogRow{}, nil
	}
	q.countAuditLogsFilteredFunc = func(ctx context.Context, arg CountAuditLogsInput) (int64, error) {
		return 0, errors.New("db error")
	}
	_, err = repo.ListAuditLogs(context.Background(), AuditLogFilters{}, 10, 0)
	require.Error(t, err)
}

func TestRepository_FindUserByEmail_Error(t *testing.T) {
	q := &mockAdminQueries{
		getUserByEmailFunc: func(ctx context.Context, email string) (AdminUserRecord, error) {
			return AdminUserRecord{}, errors.New("db error")
		},
	}
	repo := &RepositoryImpl{q: q}
	_, err := repo.FindUserByEmail(context.Background(), "a@b.com")
	require.Error(t, err)
}

func TestRepository_UpdateUserPlan_Error(t *testing.T) {
	q := &mockAdminQueries{
		updateUserPlanByEmailFunc: func(ctx context.Context, arg UpdateUserPlanByEmailInput) (AdminUserRecord, error) {
			return AdminUserRecord{}, errors.New("db error")
		},
	}
	repo := &RepositoryImpl{q: q}
	_, err := repo.UpdateUserPlan(context.Background(), "a@b.com", "pro")
	require.Error(t, err)
}

func TestRepository_UpdateOrganization_RPMQuotaOutOfRange(t *testing.T) {
	called := false
	q := &mockAdminQueries{
		updateOrganizationAdminFunc: func(ctx context.Context, arg UpdateOrganizationInput) error {
			called = true
			return nil
		},
	}
	repo := &RepositoryImpl{q: q}

	err := repo.UpdateOrganization(context.Background(), 1, "pro", math.MaxInt32+1, 1000, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "rpmQuota out of int32 range")
	assert.False(t, called)
}
