package handler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	conversationadapters "github.com/TaskForceAI/adapters/pkg/conversations"
	sharednotifications "github.com/TaskForceAI/adapters/pkg/notifications"
	conversationspkg "github.com/TaskForceAI/core/pkg/conversations"
	"github.com/TaskForceAI/core/pkg/identity"
	notificationspkg "github.com/TaskForceAI/core/pkg/notifications"
	"github.com/TaskForceAI/core/pkg/platform"
	projectspkg "github.com/TaskForceAI/core/pkg/projects"
	adminpkg "github.com/TaskForceAI/go-core/pkg/admin"
	handleradmin "github.com/TaskForceAI/go-core/pkg/handlers/admin"
	"github.com/TaskForceAI/go-core/pkg/handlers/agents"
	handlerconversations "github.com/TaskForceAI/go-core/pkg/handlers/conversations"
	publicshare "github.com/TaskForceAI/go-core/pkg/handlers/public-share"
	"github.com/TaskForceAI/go-core/pkg/pulsebridge"
)

func TestAdminAndTraceAdapters_CoverQueriesAndMapping(t *testing.T) {
	q, backing := newQueuedQueries(
		[]any{int64(3), int64(2), int64(1), int64(1), int64(1)},
		userValues(),
		userValues(),
		userValues(),
		userValues(),
		[]any{int64(4)},
		serviceIncidentValues(),
		organizationValues(),
		[]any{int64(5), 1.25, 3.5, int64(9)},
		[]any{int64(10), int64(8), int64(18), int64(2500)},
		[]any{int64(100), int64(80), int64(180), int64(25000)},
	)
	backing.rows = [][][]any{
		{userValues()},
		{auditLogValues()},
		{serviceIncidentValues()},
		{{int32(30), "TaskForceAI", "taskforceai", "pro", new("workos"), testTimestamp(), int64(2), int32(120), int64(100000)}},
		{{int64(7), "gpt-5"}},
		{{int32(12), new(1.5), new("user_1"), testTimestamp()}},
		{{"pro", int64(2)}},
		{{int32(20), "clay@example.com", "pro", int32(5)}},
		{{int64(18), int64(2500), "gpt-5"}},
		{{"search", int64(3), int64(90), 30.0}},
		{{"search", true, int64(3)}},
		{messageValues()},
	}
	adapter := adminQueriesAdapter{Queries: q}

	stats, err := adapter.GetUserStats(context.Background())
	require.NoError(t, err)
	assert.Equal(t, int64(3), stats.TotalUsers)

	users, err := adapter.ListUsers(context.Background(), adminpkg.ListUsersInput{Limit: 10})
	require.NoError(t, err)
	require.Len(t, users, 1)

	user, err := adapter.GetUserByEmail(context.Background(), "clay@example.com")
	require.NoError(t, err)
	assert.Equal(t, "clay@example.com", user.Email)

	user, err = adapter.UpdateUserPlanByEmail(context.Background(), adminpkg.UpdateUserPlanByEmailInput{Email: "clay@example.com", Plan: "pro"})
	require.NoError(t, err)
	assert.Equal(t, "pro", user.Plan)

	user, err = adapter.GetUserByID(context.Background(), 20)
	require.NoError(t, err)
	assert.Equal(t, int32(20), user.ID)

	user, err = adapter.UpdateUserAdminByID(context.Background(), adminpkg.UpdateUserAdminByIDInput{ID: 20, IsAdmin: true})
	require.NoError(t, err)
	assert.True(t, user.IsAdmin)

	auditRows, err := adapter.GetAuditLogsFiltered(context.Background(), adminpkg.AuditLogQueryInput{Limit: 10, UserID: new("user_1")})
	require.NoError(t, err)
	require.Len(t, auditRows, 1)

	count, err := adapter.CountAuditLogsFiltered(context.Background(), adminpkg.CountAuditLogsInput{UserID: new("user_1")})
	require.NoError(t, err)
	assert.Equal(t, int64(4), count)

	incident, err := adapter.CreateServiceIncident(context.Background(), adminpkg.CreateIncidentInput{ServiceID: "core", Status: "investigating", Message: "message"})
	require.NoError(t, err)
	assert.Equal(t, "core", incident.ServiceID)

	incidents, err := adapter.ListServiceIncidents(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, incidents, 1)

	orgs, err := adapter.ListOrganizationsForAdmin(context.Background())
	require.NoError(t, err)
	require.Len(t, orgs, 1)

	require.NoError(t, adapter.UpdateOrganizationAdmin(context.Background(), adminpkg.UpdateOrganizationInput{ID: 30, Plan: "pro", WorkosOrgID: "workos", RpmQuota: 120, TokensQuotaMonth: 100000}))

	aggregate, err := adapter.GetConversationAggregateSince(context.Background(), testTimestamp())
	require.NoError(t, err)
	assert.Equal(t, int64(5), aggregate.Count)

	models, err := adapter.GetModelUsageSince(context.Background(), adminpkg.TimestampLimitInput{Timestamp: testTimestamp(), Limit: 10})
	require.NoError(t, err)
	require.Len(t, models, 1)

	slowest, err := adapter.GetSlowestConversationsSince(context.Background(), adminpkg.TimestampLimitInput{Timestamp: testTimestamp(), Limit: 10})
	require.NoError(t, err)
	require.Len(t, slowest, 1)

	plans, err := adapter.GetPlanCounts(context.Background())
	require.NoError(t, err)
	require.Len(t, plans, 1)

	topUsers, err := adapter.GetTopUsersByMessageCount(context.Background(), 10)
	require.NoError(t, err)
	require.Len(t, topUsers, 1)

	tokenAggregate, err := adapter.GetTokenAggregateSince(context.Background(), testTimestamp())
	require.NoError(t, err)
	assert.Equal(t, int64(18), tokenAggregate.TotalTokens)

	tokenAggregateAllTime, err := adapter.GetTokenAggregateAllTime(context.Background())
	require.NoError(t, err)
	assert.Equal(t, int64(180), tokenAggregateAllTime.TotalTokens)

	tokensByModel, err := adapter.GetTokensByModelSince(context.Background(), adminpkg.CreatedAtLimitInput{CreatedAt: testTimestamp(), Limit: 10})
	require.NoError(t, err)
	require.Len(t, tokensByModel, 1)

	toolUsage, err := adapter.GetToolUsageSince(context.Background(), testTimestamp())
	require.NoError(t, err)
	require.Len(t, toolUsage, 1)

	toolSuccess, err := adapter.GetToolSuccessSince(context.Background(), testTimestamp())
	require.NoError(t, err)
	require.Len(t, toolSuccess, 1)

	tracesAdapter := tracesQueriesAdapter{q: q}
	traces, err := tracesAdapter.GetMessagesWithTraces(context.Background(), handleradmin.GetMessagesWithTracesInput{Rating: 1, Limit: 10})
	require.NoError(t, err)
	require.Len(t, traces, 1)
}

func TestAdapters_ReturnDatabaseErrors(t *testing.T) {
	ctx := context.Background()
	q, backing := newQueuedQueries()
	backing.queryErr = errors.New("query failed")
	backing.execErr = errors.New("exec failed")

	projectAdapter := projectStoreAdapter{q: q}
	_, err := projectAdapter.GetProjectsByUser(ctx, 20)
	require.Error(t, err)
	_, err = projectAdapter.GetProjectsByUserAndOrg(ctx, projectspkg.GetProjectsByUserAndOrgInput{UserID: 20, OrganizationID: int32Ptr(30)})
	require.Error(t, err)
	_, err = projectAdapter.CreateProject(ctx, projectspkg.CreateProjectStoreInput{UserID: 20, Name: "Project"})
	require.Error(t, err)
	require.Error(t, projectAdapter.DeleteProject(ctx, projectspkg.DeleteProjectInput{ID: 1, UserID: 20}))
	require.Error(t, projectAdapter.DeleteProjectWithOrg(ctx, projectspkg.DeleteProjectWithOrgInput{ID: 1, UserID: 20, OrganizationID: int32Ptr(30)}))

	conversationAdapter := conversationadapters.NewStore(q)
	_, err = conversationAdapter.GetConversationsByUser(ctx, conversationspkg.GetConversationsByUserInput{UserID: new("user_1")})
	require.Error(t, err)
	_, err = conversationAdapter.GetConversationsByUserAndOrg(ctx, conversationspkg.GetConversationsByUserAndOrgInput{UserID: new("user_1"), OrganizationID: int32Ptr(30)})
	require.Error(t, err)
	_, err = conversationAdapter.GetMessagesByConversation(ctx, 1)
	require.Error(t, err)
	_, err = conversationAdapter.GetConversationByUserAndID(ctx, conversationspkg.GetConversationByUserAndIDInput{ID: 1, UserID: new("user_1")})
	require.Error(t, err)
	_, err = conversationAdapter.GetConversationByUserOrgAndID(ctx, conversationspkg.GetConversationByUserOrgAndIDInput{ID: 1, UserID: new("user_1"), OrganizationID: int32Ptr(30)})
	require.Error(t, err)
	_, err = conversationAdapter.CreateConversation(ctx, conversationspkg.CreateConversationStoreInput{UserID: new("user_1"), UserInput: "prompt"})
	require.Error(t, err)
	require.Error(t, conversationAdapter.UpdateConversation(ctx, conversationspkg.UpdateConversationStoreInput{ID: 1, UserID: new("user_1")}))
	require.Error(t, conversationAdapter.UpdateConversationWithOrg(ctx, conversationspkg.UpdateConversationWithOrgInput{ID: 1, UserID: new("user_1"), OrganizationID: int32Ptr(30)}))
	require.Error(t, conversationAdapter.SoftDeleteConversation(ctx, conversationspkg.SoftDeleteConversationInput{ID: 1, UserID: new("user_1")}))
	require.Error(t, conversationAdapter.SoftDeleteConversationWithOrg(ctx, conversationspkg.SoftDeleteConversationWithOrgInput{ID: 1, UserID: new("user_1"), OrganizationID: int32Ptr(30)}))

	adminAdapter := adminQueriesAdapter{Queries: q}
	_, err = adminAdapter.GetUserStats(ctx)
	require.Error(t, err)
	_, err = adminAdapter.ListUsers(ctx, adminpkg.ListUsersInput{Limit: 10})
	require.Error(t, err)
	_, err = adminAdapter.ListUsersForAdmin(ctx, adminpkg.ListUsersForAdminInput{PageLimit: 10})
	require.Error(t, err)
	_, err = adminAdapter.GetUserByEmail(ctx, "clay@example.com")
	require.Error(t, err)
	_, err = adminAdapter.UpdateUserPlanByEmail(ctx, adminpkg.UpdateUserPlanByEmailInput{Email: "clay@example.com", Plan: "pro"})
	require.Error(t, err)
	_, err = adminAdapter.GetUserByID(ctx, 20)
	require.Error(t, err)
	_, err = adminAdapter.UpdateUserAdminByID(ctx, adminpkg.UpdateUserAdminByIDInput{ID: 20, IsAdmin: true})
	require.Error(t, err)
	_, err = adminAdapter.GetAuditLogsFiltered(ctx, adminpkg.AuditLogQueryInput{Limit: 10, UserID: new("user_1")})
	require.Error(t, err)
	_, err = adminAdapter.CountAuditLogsFiltered(ctx, adminpkg.CountAuditLogsInput{UserID: new("user_1")})
	require.Error(t, err)
	_, err = adminAdapter.CreateServiceIncident(ctx, adminpkg.CreateIncidentInput{ServiceID: "core"})
	require.Error(t, err)
	_, err = adminAdapter.ListServiceIncidents(ctx, 10)
	require.Error(t, err)
	_, err = adminAdapter.ListOrganizationsForAdmin(ctx)
	require.Error(t, err)
	require.Error(t, adminAdapter.UpdateOrganizationAdmin(ctx, adminpkg.UpdateOrganizationInput{ID: 30}))
	_, err = adminAdapter.GetConversationAggregateSince(ctx, testTimestamp())
	require.Error(t, err)
	_, err = adminAdapter.GetModelUsageSince(ctx, adminpkg.TimestampLimitInput{Timestamp: testTimestamp(), Limit: 10})
	require.Error(t, err)
	_, err = adminAdapter.GetSlowestConversationsSince(ctx, adminpkg.TimestampLimitInput{Timestamp: testTimestamp(), Limit: 10})
	require.Error(t, err)
	_, err = adminAdapter.GetPlanCounts(ctx)
	require.Error(t, err)
	_, err = adminAdapter.GetTopUsersByMessageCount(ctx, 10)
	require.Error(t, err)
	_, err = adminAdapter.GetTokenAggregateSince(ctx, testTimestamp())
	require.Error(t, err)
	_, err = adminAdapter.GetTokenAggregateAllTime(ctx)
	require.Error(t, err)
	_, err = adminAdapter.GetTokensByModelSince(ctx, adminpkg.CreatedAtLimitInput{CreatedAt: testTimestamp(), Limit: 10})
	require.Error(t, err)
	_, err = adminAdapter.GetToolUsageSince(ctx, testTimestamp())
	require.Error(t, err)
	_, err = adminAdapter.GetToolSuccessSince(ctx, testTimestamp())
	require.Error(t, err)

	agentAdapter := agentStoreAdapter{q: q}
	_, err = agentAdapter.ListAgentsByUserID(ctx, 20)
	require.Error(t, err)
	_, err = agentAdapter.GetAgent(ctx, "agent_1")
	require.Error(t, err)
	_, err = agentAdapter.UpsertAgent(ctx, agents.UpsertAgentInput{ID: "agent_1", UserID: 20, Name: "Agent"})
	require.Error(t, err)

	pulseStore := pulseBridgeStoreAdapter{q: q}
	_, err = pulseStore.ListEnabledAgents(ctx)
	require.Error(t, err)
	_, err = pulseStore.ListAgentsDueForPulse(ctx)
	require.Error(t, err)
	_, err = pulseStore.ClaimAgentPulse(ctx, pulsebridge.ClaimAgentPulseInput{ID: "agent_1"})
	require.Error(t, err)
	require.Error(t, pulseStore.UpdateAgentPulseState(ctx, pulsebridge.UpdateAgentPulseStateInput{ID: "agent_1"}))
	require.Error(t, pulseStore.UpdateAgentStatus(ctx, pulsebridge.UpdateAgentStatusInput{ID: "agent_1"}))

	shareAdapter := conversationShareQueriesAdapter{q: q}
	_, err = shareAdapter.UpdateConversationSharing(ctx, handlerconversations.UpdateConversationSharingInput{ID: 1, UserID: new("user_1")})
	require.Error(t, err)
	_, err = shareAdapter.UpdateConversationSharingWithOrg(ctx, handlerconversations.UpdateConversationSharingWithOrgInput{ID: 1, UserID: new("user_1"), OrganizationID: int32Ptr(30)})
	require.Error(t, err)

	publicAdapter := publicShareQueriesAdapter{q: q}
	_, err = publicAdapter.GetConversationByShareID(ctx, new("share_1"))
	require.Error(t, err)
	_, err = publicAdapter.GetPublicMessagesByConversationID(ctx, publicshare.PublicMessagesInput{
		ConversationID: 1,
		PublicSharedAt: time.Now(),
	})
	require.Error(t, err)

	tracesAdapter := tracesQueriesAdapter{q: q}
	_, err = tracesAdapter.GetMessagesWithTraces(ctx, handleradmin.GetMessagesWithTracesInput{Rating: 1, Limit: 10})
	require.Error(t, err)

	feedbackAdapter := feedbackQueriesAdapter{q: q}
	_, err = feedbackAdapter.UpdateMessageRating(ctx, handlerconversations.UpdateMessageRatingInput{MessageID: "msg_1"})
	require.Error(t, err)

	gdprAdapter := gdprStoreAdapter{q: q}
	_, err = gdprAdapter.GetUserByEmail(ctx, "clay@example.com")
	require.Error(t, err)
	_, err = gdprAdapter.GetConversationsByUser(ctx, platform.GetConversationsByUserInput{UserID: "user_1"})
	require.Error(t, err)
	require.Error(t, gdprAdapter.DeleteUser(ctx, 20))

	downloadAdapter := downloadStoreAdapter{q: q}
	require.Error(t, downloadAdapter.RecordDownload(ctx, platform.RecordDownloadInput{Product: "desktop"}))

	pushAdapter := sharednotifications.NewPushTokenStore(q)
	require.Error(t, pushAdapter.UpsertPushToken(ctx, notificationspkg.UpsertPushTokenInput{Token: "token"}))
	_, err = pushAdapter.DeletePushToken(ctx, notificationspkg.DeletePushTokenInput{Token: "token"})
	require.Error(t, err)

	identityAdapter := identityStoreAdapter{q: q}
	_, err = identityAdapter.GetMembership(ctx, identity.GetMembershipInput{OrganizationID: 30, UserID: 20})
	require.Error(t, err)
	_, err = identityAdapter.GetOrganizationMembers(ctx, 30)
	require.Error(t, err)
	_, err = identityAdapter.GetOrganizationSettings(ctx, 30)
	require.Error(t, err)
	require.Error(t, identityAdapter.UpdateOrganizationSettings(ctx, identity.UpdateOrganizationSettingsInput{ID: 30}))
}
