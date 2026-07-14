package handler

import (
	"context"
	"encoding/json"
	"time"

	"github.com/TaskForceAI/adapters/pkg/account"
	auditpkg "github.com/TaskForceAI/adapters/pkg/audit"
	"github.com/TaskForceAI/adapters/pkg/collections"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/core/pkg/identity"
	"github.com/TaskForceAI/core/pkg/platform"
	projectspkg "github.com/TaskForceAI/core/pkg/projects"
	adminpkg "github.com/TaskForceAI/go-core/pkg/admin"
	"github.com/TaskForceAI/go-core/pkg/handlers/admin"
	"github.com/TaskForceAI/go-core/pkg/handlers/agents"
	"github.com/TaskForceAI/go-core/pkg/handlers/conversations"
	publicshare "github.com/TaskForceAI/go-core/pkg/handlers/public-share"
	"github.com/TaskForceAI/go-core/pkg/pulsebridge"
)

type projectAuditAdapter struct {
	logger *auditpkg.AuditLogger
}

type projectStoreAdapter struct {
	q *db.Queries
}

type gdprStoreAdapter struct {
	q *db.Queries
}

type adminQueriesAdapter struct {
	*db.Queries
}

type identityStoreAdapter struct {
	q *db.Queries
}

type pulseBridgeAdapter struct {
	bridge *pulsebridge.Bridge
}

type pulseBridgeStoreAdapter struct {
	q *db.Queries
}

type conversationShareQueriesAdapter struct {
	q *db.Queries
}

type publicShareQueriesAdapter struct {
	q *db.Queries
}

type tracesQueriesAdapter struct {
	q *db.Queries
}

type feedbackQueriesAdapter struct {
	q *db.Queries
}

func (a projectAuditAdapter) CreateAuditLog(entry projectspkg.AuditEntry) {
	if a.logger == nil {
		return
	}
	a.logger.CreateAuditLog(auditpkg.AuditLogEntry{
		UserID:         entry.UserID,
		OrganizationID: entry.OrganizationID,
		Action:         auditpkg.AuditAction(entry.Action),
		Resource:       entry.Resource,
		ResourceID:     entry.ResourceID,
		Success:        entry.Success,
		ErrorMessage:   entry.ErrorMessage,
	})
}

func (a projectStoreAdapter) GetProjectsByUser(ctx context.Context, userID int32) ([]projectspkg.ProjectRecord, error) {
	projects, err := a.q.GetProjectsByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	return mapProjectRecords(projects), nil
}

func (a projectStoreAdapter) GetProjectsByUserAndOrg(ctx context.Context, input projectspkg.GetProjectsByUserAndOrgInput) ([]projectspkg.ProjectRecord, error) {
	projects, err := a.q.GetProjectsByUserAndOrg(ctx, db.GetProjectsByUserAndOrgParams{
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
	if err != nil {
		return nil, err
	}
	return mapProjectRecords(projects), nil
}

func (a projectStoreAdapter) CreateProject(ctx context.Context, input projectspkg.CreateProjectStoreInput) (projectspkg.ProjectRecord, error) {
	project, err := a.q.CreateProject(ctx, db.CreateProjectParams{
		UserID:             input.UserID,
		OrganizationID:     input.OrganizationID,
		Name:               input.Name,
		Description:        input.Description,
		CustomInstructions: input.CustomInstructions,
	})
	if err != nil {
		return projectspkg.ProjectRecord{}, err
	}
	return projectRecord(project), nil
}

func (a projectStoreAdapter) UpdateProjectName(ctx context.Context, input projectspkg.UpdateProjectInput) (projectspkg.ProjectRecord, error) {
	project, err := a.q.UpdateProjectName(ctx, db.UpdateProjectNameParams{
		ID:             input.ID,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
		Name:           input.Name,
	})
	if err != nil {
		return projectspkg.ProjectRecord{}, err
	}
	return projectRecord(project), nil
}

func (a projectStoreAdapter) DeleteProject(ctx context.Context, input projectspkg.DeleteProjectInput) error {
	return a.q.DeleteProject(ctx, db.DeleteProjectParams{
		ID:     input.ID,
		UserID: input.UserID,
	})
}

func (a projectStoreAdapter) DeleteProjectWithOrg(ctx context.Context, input projectspkg.DeleteProjectWithOrgInput) error {
	return a.q.DeleteProjectWithOrg(ctx, db.DeleteProjectWithOrgParams{
		ID:             input.ID,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
}

func (a adminQueriesAdapter) ListUsers(ctx context.Context, input adminpkg.ListUsersInput) ([]adminpkg.AdminUserRecord, error) {
	rows, err := a.Queries.ListUsers(ctx, input)
	if err != nil {
		return nil, err
	}
	return collections.Map(rows, adminUserRecord), nil
}

func (a adminQueriesAdapter) ListUsersForAdmin(ctx context.Context, input adminpkg.ListUsersForAdminInput) ([]adminpkg.AdminUserRecord, error) {
	rows, err := a.Queries.ListUsersForAdmin(ctx, input)
	if err != nil {
		return nil, err
	}
	return collections.Map(rows, adminUserRecord), nil
}

func (a adminQueriesAdapter) GetUserByEmail(ctx context.Context, email string) (adminpkg.AdminUserRecord, error) {
	row, err := a.Queries.GetUserByEmail(ctx, email)
	if err != nil {
		return adminpkg.AdminUserRecord{}, err
	}
	return adminUserRecord(row), nil
}

func (a adminQueriesAdapter) UpdateUserPlanByEmail(ctx context.Context, input adminpkg.UpdateUserPlanByEmailInput) (adminpkg.AdminUserRecord, error) {
	row, err := a.Queries.UpdateUserPlanByEmail(ctx, input)
	if err != nil {
		return adminpkg.AdminUserRecord{}, err
	}
	return adminUserRecord(row), nil
}

func (a adminQueriesAdapter) GetUserByID(ctx context.Context, id int32) (adminpkg.AdminUserRecord, error) {
	row, err := a.Queries.GetUserByID(ctx, id)
	if err != nil {
		return adminpkg.AdminUserRecord{}, err
	}
	return adminUserRecord(row), nil
}

func (a adminQueriesAdapter) UpdateUserAdminByID(ctx context.Context, input adminpkg.UpdateUserAdminByIDInput) (adminpkg.AdminUserRecord, error) {
	row, err := a.Queries.UpdateUserAdminByID(ctx, input)
	if err != nil {
		return adminpkg.AdminUserRecord{}, err
	}
	return adminUserRecord(row), nil
}

func adminUserRecord(row db.User) adminpkg.AdminUserRecord {
	user := account.FromDBUser(row)
	return adminpkg.AdminUserRecord{
		ID:                   user.ID,
		Email:                user.Email,
		FullName:             user.FullName,
		Plan:                 user.Plan,
		IsAdmin:              user.IsAdmin,
		MessageCount:         user.MessageCount,
		LastMessageTimestamp: row.LastMessageTimestamp,
		Disabled:             user.Disabled,
	}
}

func (a adminQueriesAdapter) UpdateOrganizationAdmin(ctx context.Context, input adminpkg.UpdateOrganizationInput) error {
	_, err := a.Queries.UpdateOrganizationAdmin(ctx, input)
	return err
}

func (a adminQueriesAdapter) GetSlowestConversationsSince(ctx context.Context, input adminpkg.TimestampLimitInput) ([]adminpkg.SlowConversationRow, error) {
	return a.Queries.GetSlowestConversationsSince(ctx, db.GetSlowestConversationsSinceParams(input))
}

func mapProjectRecords(projects []db.Project) []projectspkg.ProjectRecord {
	return collections.Map(projects, projectRecord)
}

func projectRecord(project db.Project) projectspkg.ProjectRecord {
	return projectspkg.ProjectRecord{
		ID:                 project.ID,
		UserID:             project.UserID,
		OrganizationID:     project.OrganizationID,
		Name:               project.Name,
		Description:        project.Description,
		CustomInstructions: project.CustomInstructions,
		CreatedAt:          project.CreatedAt.Time,
		UpdatedAt:          project.UpdatedAt.Time,
	}
}

func (a tracesQueriesAdapter) GetMessagesWithTraces(ctx context.Context, input admin.GetMessagesWithTracesInput) ([]admin.TraceMessage, error) {
	messages, err := a.q.GetMessagesWithTraces(ctx, db.GetMessagesWithTracesParams{
		Rating: input.Rating,
		Limit:  input.Limit,
	})
	if err != nil {
		return nil, err
	}

	return collections.Map(messages, func(message db.Message) admin.TraceMessage {
		return admin.TraceMessage{
			ID:      message.ID,
			Role:    message.Role,
			Content: message.Content,
			Trace:   message.Trace,
			Rating:  message.Rating,
		}
	}), nil
}

func (a feedbackQueriesAdapter) UpdateMessageRating(ctx context.Context, input conversations.UpdateMessageRatingInput) (int64, error) {
	return a.q.UpdateMessageRating(ctx, db.UpdateMessageRatingParams{
		MessageID:      input.MessageID,
		Rating:         input.Rating,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
}

func (a conversationShareQueriesAdapter) UpdateConversationSharing(ctx context.Context, input conversations.UpdateConversationSharingInput) (conversations.SharedConversation, error) {
	conversation, err := a.q.UpdateConversationSharingSnapshot(ctx, db.UpdateConversationSharingSnapshotParams{
		ID:       input.ID,
		IsPublic: input.IsPublic,
		ShareID:  input.ShareID,
		UserID:   input.UserID,
	})
	if err != nil {
		return conversations.SharedConversation{}, err
	}
	return conversations.SharedConversation{
		ID:       conversation.ID,
		IsPublic: conversation.IsPublic,
		ShareID:  conversation.ShareID,
	}, nil
}

func (a conversationShareQueriesAdapter) UpdateConversationSharingWithOrg(ctx context.Context, input conversations.UpdateConversationSharingWithOrgInput) (conversations.SharedConversation, error) {
	conversation, err := a.q.UpdateConversationSharingSnapshotWithOrg(ctx, db.UpdateConversationSharingSnapshotWithOrgParams{
		ID:             input.ID,
		IsPublic:       input.IsPublic,
		ShareID:        input.ShareID,
		UserID:         input.UserID,
		OrganizationID: input.OrganizationID,
	})
	if err != nil {
		return conversations.SharedConversation{}, err
	}
	return conversations.SharedConversation{
		ID:       conversation.ID,
		IsPublic: conversation.IsPublic,
		ShareID:  conversation.ShareID,
	}, nil
}

func (a publicShareQueriesAdapter) GetConversationByShareID(ctx context.Context, shareID *string) (publicshare.SharedConversation, error) {
	conversation, err := a.q.GetPublicConversationSnapshotByShareID(ctx, shareID)
	if err != nil {
		return publicshare.SharedConversation{}, err
	}
	return publicshare.SharedConversation{
		ID:                conversation.ID,
		UserInput:         conversation.Title,
		IsPublic:          conversation.IsPublic,
		IsDeleted:         conversation.IsDeleted,
		PublicSharedAt:    conversation.SnapshotAt.Time,
		HasPublicSharedAt: conversation.SnapshotAt.Valid,
	}, nil
}

func (a publicShareQueriesAdapter) GetPublicMessagesByConversationID(ctx context.Context, input publicshare.PublicMessagesInput) ([]publicshare.PublicMessageRow, error) {
	messages, err := a.q.GetPublicConversationSnapshotMessages(ctx, input.ConversationID)
	if err != nil {
		return nil, err
	}

	return collections.Map(messages, func(message db.PublicConversationSnapshotMessage) publicshare.PublicMessageRow {
		return publicshare.PublicMessageRow{
			MessageID:     message.MessageID,
			Role:          message.Role,
			Content:       message.Content,
			IsAgentStatus: message.IsAgentStatus,
			CreatedAt:     message.CreatedAt.Time,
			HasCreatedAt:  message.CreatedAt.Valid,
		}
	}), nil
}

func (a pulseBridgeAdapter) RegisterAgent(agent agents.AgentRecord) {
	if a.bridge == nil {
		return
	}
	a.bridge.RegisterAgent(pulsebridge.AgentRecord{
		ID:            agent.ID,
		Timezone:      agent.Timezone,
		ActiveStart:   agent.ActiveStart,
		ActiveEnd:     agent.ActiveEnd,
		ActiveDays:    agent.ActiveDays,
		CheckInterval: agent.CheckInterval,
	})
}

func (a pulseBridgeAdapter) UnregisterAgent(agentID string) {
	if a.bridge == nil {
		return
	}
	a.bridge.UnregisterAgent(agentID)
}

func (a pulseBridgeStoreAdapter) ListEnabledAgents(ctx context.Context) ([]pulsebridge.AgentRecord, error) {
	records, err := a.q.ListEnabledAgents(ctx)
	if err != nil {
		return nil, err
	}
	return collections.Map(records, pulseBridgeAgentRecord), nil
}

func (a pulseBridgeStoreAdapter) ListAgentsDueForPulse(ctx context.Context) ([]pulsebridge.AgentRecord, error) {
	records, err := a.q.ListAgentsDueForPulse(ctx)
	if err != nil {
		return nil, err
	}
	return collections.Map(records, pulseBridgeAgentRecord), nil
}

func (a pulseBridgeStoreAdapter) ClaimAgentPulse(ctx context.Context, input pulsebridge.ClaimAgentPulseInput) (bool, error) {
	rows, err := a.q.ClaimAgentPulse(ctx, db.ClaimAgentPulseParams{
		ID:        input.ID,
		NextRunAt: input.NextRunAt,
		DueBefore: input.DueBefore,
	})
	return rows > 0, err
}

func (a pulseBridgeStoreAdapter) UpdateAgentPulseState(ctx context.Context, input pulsebridge.UpdateAgentPulseStateInput) error {
	return a.q.UpdateAgentPulseState(ctx, db.UpdateAgentPulseStateParams{
		ID:        input.ID,
		LastRunAt: input.LastRunAt,
		NextRunAt: input.NextRunAt,
	})
}

func (a pulseBridgeStoreAdapter) UpdateAgentStatus(ctx context.Context, input pulsebridge.UpdateAgentStatusInput) error {
	return a.q.UpdateAgentStatus(ctx, db.UpdateAgentStatusParams{
		ID:     input.ID,
		Status: input.Status,
	})
}

func pulseBridgeAgentRecord(agent db.Agent) pulsebridge.AgentRecord {
	return pulsebridge.AgentRecord{
		ID:            agent.ID,
		Timezone:      agent.Timezone,
		ActiveStart:   agent.ActiveStart,
		ActiveEnd:     agent.ActiveEnd,
		ActiveDays:    agent.ActiveDays,
		CheckInterval: agent.CheckInterval,
		LastRunAt:     agent.LastRunAt,
		NextRunAt:     agent.NextRunAt,
	}
}

func (a gdprStoreAdapter) GetUserByEmail(ctx context.Context, email string) (platform.GdprUser, error) {
	row, err := a.q.GetUserByEmail(ctx, email)
	if err != nil {
		return platform.GdprUser{}, err
	}
	user := account.FromDBUser(row)
	return platform.GdprUser{
		ID:       user.ID,
		Email:    user.Email,
		FullName: user.FullName,
	}, nil
}

func (a gdprStoreAdapter) GetConversationsByUser(ctx context.Context, input platform.GetConversationsByUserInput) ([]platform.GdprConversation, error) {
	conversations, err := a.q.GetConversationsByUser(ctx, db.GetConversationsByUserParams{
		UserID: &input.UserID,
		Limit:  input.Limit,
		Offset: input.Offset,
	})
	if err != nil {
		return nil, err
	}

	return collections.Map(conversations, func(conversation db.Conversation) platform.GdprConversation {
		return platform.GdprConversation{
			ID:        conversation.ID,
			UserInput: conversation.UserInput,
		}
	}), nil
}

func (a gdprStoreAdapter) ExportUserData(ctx context.Context, userID int32) (platform.GdprExport, error) {
	payload, err := a.q.GetGDPRExport(ctx, userID)
	if err != nil {
		return nil, err
	}
	var export platform.GdprExport
	if err := json.Unmarshal(payload, &export); err != nil {
		return nil, err
	}
	return export, nil
}

func (a gdprStoreAdapter) DeleteUser(ctx context.Context, userID int32) error {
	return a.q.DeleteGDPRUserData(ctx, userID)
}

func (a identityStoreAdapter) GetMembership(ctx context.Context, input identity.GetMembershipInput) (identity.MembershipRecord, error) {
	record, err := account.NewOrganizationStore(a.q).GetMembership(ctx, input.OrganizationID, input.UserID)
	if err != nil {
		return identity.MembershipRecord{}, err
	}
	return identity.MembershipRecord{
		OrganizationID: record.OrganizationID,
		UserID:         record.UserID,
		Role:           record.Role,
	}, nil
}

func (a identityStoreAdapter) GetOrganizationMembers(ctx context.Context, orgID int32) ([]identity.OrganizationMemberRecord, error) {
	rows, err := account.NewOrganizationStore(a.q).GetOrganizationMembers(ctx, orgID)
	if err != nil {
		return nil, err
	}

	return collections.Map(rows, func(row account.OrganizationMember) identity.OrganizationMemberRecord {
		var joinedAt time.Time
		if row.JoinedAt != nil {
			joinedAt = *row.JoinedAt
		}
		return identity.OrganizationMemberRecord{
			UserID:         row.UserID,
			Email:          row.Email,
			FullName:       row.FullName,
			Role:           row.Role,
			JoinedAt:       joinedAt,
			OrganizationID: row.OrganizationID,
		}
	}), nil
}

func (a identityStoreAdapter) GetOrganizationSettings(ctx context.Context, orgID int32) ([]byte, error) {
	return a.q.GetOrganizationSettings(ctx, orgID)
}

func (a identityStoreAdapter) UpdateOrganizationSettings(ctx context.Context, input identity.UpdateOrganizationSettingsInput) error {
	return a.q.UpdateOrganizationSettings(ctx, db.UpdateOrganizationSettingsParams{
		ID:       input.ID,
		Settings: input.Settings,
	})
}

func (a identityStoreAdapter) UpdateMembershipRole(ctx context.Context, input identity.UpdateMembershipRoleInput) error {
	_, err := a.q.UpdateMembershipRole(ctx, db.UpdateMembershipRoleParams{
		OrganizationID: input.OrganizationID,
		UserID:         input.UserID,
		Role:           db.OrganizationRole(input.Role),
	})
	return err
}

func (a identityStoreAdapter) DeleteMembership(ctx context.Context, input identity.DeleteMembershipInput) error {
	return a.q.DeleteMembership(ctx, db.DeleteMembershipParams{
		OrganizationID: input.OrganizationID,
		UserID:         input.UserID,
	})
}

func (a identityStoreAdapter) UpdateMembershipRolePreservingOwners(ctx context.Context, input identity.UpdateMembershipRoleInput) (bool, error) {
	return a.q.UpdateMembershipRolePreservingOwners(ctx, input.OrganizationID, input.UserID, input.Role)
}

func (a identityStoreAdapter) DeleteMembershipPreservingOwners(ctx context.Context, input identity.DeleteMembershipInput) (bool, error) {
	return a.q.DeleteMembershipPreservingOwners(ctx, input.OrganizationID, input.UserID)
}
