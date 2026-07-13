package handler

import (
	"context"

	"github.com/TaskForceAI/adapters/pkg/account"
	"github.com/TaskForceAI/adapters/pkg/db"
	appdatabase "github.com/TaskForceAI/go-engine/pkg/database"
	developerhandlers "github.com/TaskForceAI/go-engine/pkg/handlers/developer"
	developerfiles "github.com/TaskForceAI/go-engine/pkg/handlers/developer/files"
	runhandlers "github.com/TaskForceAI/go-engine/pkg/handlers/run"
)

func loadEngineQueries(ctx context.Context) (*db.Queries, error) {
	return GetQueries(ctx)
}

func withEngineQueries[T any](ctx context.Context, fn func(*db.Queries) (T, error)) (T, error) {
	q, err := loadEngineQueries(ctx)
	if err != nil {
		var zero T
		return zero, err
	}
	return fn(q)
}

type LazyRunQueries struct{}

func (LazyRunQueries) GetOrganizationByID(ctx context.Context, id int32) (runhandlers.OrganizationRow, error) {
	return withEngineQueries(ctx, func(q *db.Queries) (runhandlers.OrganizationRow, error) {
		org, err := account.NewOrganizationStore(q).GetOrganizationByID(ctx, id)
		if err != nil {
			return runhandlers.OrganizationRow{}, err
		}
		return runhandlers.OrganizationRow{
			ID:         org.ID,
			NoTraining: org.NoTraining,
		}, nil
	})
}

func (LazyRunQueries) GetMembership(ctx context.Context, arg runhandlers.MembershipLookupInput) (runhandlers.MembershipRow, error) {
	return withEngineQueries(ctx, func(q *db.Queries) (runhandlers.MembershipRow, error) {
		membership, err := account.NewOrganizationStore(q).GetMembership(ctx, arg.OrganizationID, arg.UserID)
		if err != nil {
			return runhandlers.MembershipRow{}, err
		}
		return runhandlers.MembershipRow{
			OrganizationID: membership.OrganizationID,
			UserID:         membership.UserID,
		}, nil
	})
}

func (LazyRunQueries) GetExecutionTrace(ctx context.Context, taskID string) (runhandlers.ExecutionTraceRow, error) {
	return withEngineQueries(ctx, func(q *db.Queries) (runhandlers.ExecutionTraceRow, error) {
		trace, err := q.GetExecutionTrace(ctx, taskID)
		if err != nil {
			return runhandlers.ExecutionTraceRow{}, err
		}
		return runhandlers.ExecutionTraceRow{
			ID:        trace.ID,
			TaskID:    trace.TaskID,
			UserID:    trace.UserID,
			Goal:      trace.Goal,
			Plan:      trace.Plan,
			Steps:     trace.Steps,
			SelfEval:  trace.SelfEval,
			Report:    trace.Report,
			Artifacts: trace.Artifacts,
			CreatedAt: trace.CreatedAt,
		}, nil
	})
}

func (LazyRunQueries) GetAgent(ctx context.Context, id string) (runhandlers.AgentRow, error) {
	return withEngineQueries(ctx, func(q *db.Queries) (runhandlers.AgentRow, error) {
		agent, err := q.GetAgent(ctx, id)
		if err != nil {
			return runhandlers.AgentRow{}, err
		}
		return runhandlers.AgentRow{
			ID:     agent.ID,
			UserID: agent.UserID,
		}, nil
	})
}

type LazyDeveloperQueries struct{}

func (LazyDeveloperQueries) GetOrganizationByID(ctx context.Context, id int32) (runhandlers.OrganizationRow, error) {
	return LazyRunQueries{}.GetOrganizationByID(ctx, id)
}

func (LazyDeveloperQueries) GetMembership(ctx context.Context, arg runhandlers.MembershipLookupInput) (runhandlers.MembershipRow, error) {
	return LazyRunQueries{}.GetMembership(ctx, arg)
}

func (LazyDeveloperQueries) GetMessagesByConversation(ctx context.Context, conversationID int32) ([]developerhandlers.ThreadMessage, error) {
	return withEngineQueries(ctx, func(q *db.Queries) ([]developerhandlers.ThreadMessage, error) {
		messages, err := q.GetMessagesByConversation(ctx, conversationID)
		if err != nil {
			return nil, err
		}

		records := make([]developerhandlers.ThreadMessage, len(messages))
		for i, message := range messages {
			records[i] = developerhandlers.ThreadMessage{
				ID:             message.ID,
				MessageID:      message.MessageID,
				ConversationID: message.ConversationID,
				Role:           message.Role,
				Content:        message.Content,
				IsStreaming:    message.IsStreaming,
				IsAgentStatus:  message.IsAgentStatus,
				ElapsedSeconds: message.ElapsedSeconds,
				CreatedAt:      message.CreatedAt,
				Error:          message.Error,
				Sources:        message.Sources,
				ToolEvents:     message.ToolEvents,
				AgentStatuses:  message.AgentStatuses,
				VectorClock:    message.VectorClock,
				SyncVersion:    message.SyncVersion,
				LastSyncedAt:   message.LastSyncedAt,
				DeviceID:       message.DeviceID,
				IsDeleted:      message.IsDeleted,
				UpdatedAt:      message.UpdatedAt,
				Rating:         message.Rating,
				Trace:          message.Trace,
			}
		}
		return records, nil
	})
}

type LazyFilesQueries struct{}

func lazyDeveloperFilesStore() *appdatabase.DeveloperFilesStore {
	return appdatabase.NewLazyDeveloperFilesStore(loadEngineQueries)
}

func (LazyFilesQueries) EnsureUserStorageQuota(ctx context.Context, userID int32) error {
	return lazyDeveloperFilesStore().EnsureUserStorageQuota(ctx, userID)
}

func (LazyFilesQueries) GetUserStorageQuota(ctx context.Context, userID int32) (developerfiles.StorageQuotaRecord, error) {
	return lazyDeveloperFilesStore().GetUserStorageQuota(ctx, userID)
}

func (LazyFilesQueries) ReserveUserStorageBytes(ctx context.Context, arg developerfiles.StorageQuotaUpdateInput) error {
	return lazyDeveloperFilesStore().ReserveUserStorageBytes(ctx, arg)
}

func (LazyFilesQueries) ReleaseUserStorageBytes(ctx context.Context, arg developerfiles.StorageQuotaUpdateInput) error {
	return lazyDeveloperFilesStore().ReleaseUserStorageBytes(ctx, arg)
}

func (LazyFilesQueries) CreateDeveloperFileUploadReservation(ctx context.Context, arg developerfiles.CreateDeveloperFileUploadReservationInput) (developerfiles.DeveloperFileUploadReservationRecord, error) {
	return lazyDeveloperFilesStore().CreateDeveloperFileUploadReservation(ctx, arg)
}

func (LazyFilesQueries) ConsumeDeveloperFileUploadReservation(ctx context.Context, arg developerfiles.DeveloperFileUploadReservationLookupInput) (developerfiles.DeveloperFileUploadReservationRecord, error) {
	return lazyDeveloperFilesStore().ConsumeDeveloperFileUploadReservation(ctx, arg)
}

func (LazyFilesQueries) ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx context.Context, userID int32) ([]int64, error) {
	return lazyDeveloperFilesStore().ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx, userID)
}

func (LazyFilesQueries) CreateDeveloperFile(ctx context.Context, arg developerfiles.CreateDeveloperFileInput) (developerfiles.DeveloperFileRecord, error) {
	return lazyDeveloperFilesStore().CreateDeveloperFile(ctx, arg)
}

func (LazyFilesQueries) GetDeveloperFileByIDForUser(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) (developerfiles.DeveloperFileRecord, error) {
	return lazyDeveloperFilesStore().GetDeveloperFileByIDForUser(ctx, arg)
}

func (LazyFilesQueries) ListDeveloperFilesByUser(ctx context.Context, arg developerfiles.ListDeveloperFilesInput) ([]developerfiles.DeveloperFileRecord, error) {
	return lazyDeveloperFilesStore().ListDeveloperFilesByUser(ctx, arg)
}

func (LazyFilesQueries) CountDeveloperFilesByUser(ctx context.Context, userID int32) (int64, error) {
	return lazyDeveloperFilesStore().CountDeveloperFilesByUser(ctx, userID)
}

func (LazyFilesQueries) GetDeveloperFileStorageStatsByUser(ctx context.Context, userID int32) ([]developerfiles.DeveloperFileStorageStatsRecord, error) {
	return lazyDeveloperFilesStore().GetDeveloperFileStorageStatsByUser(ctx, userID)
}

func (LazyFilesQueries) MarkDeveloperFileDeleted(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) (developerfiles.DeveloperFileRecord, error) {
	return lazyDeveloperFilesStore().MarkDeveloperFileDeleted(ctx, arg)
}

func (LazyFilesQueries) RestoreDeveloperFileDeletion(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) error {
	return lazyDeveloperFilesStore().RestoreDeveloperFileDeletion(ctx, arg)
}
