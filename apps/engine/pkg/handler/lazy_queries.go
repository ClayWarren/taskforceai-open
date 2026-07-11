package handler

import (
	"context"

	"github.com/TaskForceAI/adapters/pkg/account"
	"github.com/TaskForceAI/adapters/pkg/db"
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

func (LazyFilesQueries) EnsureUserStorageQuota(ctx context.Context, userID int32) error {
	_, err := withEngineQueries(ctx, func(q *db.Queries) (struct{}, error) {
		return struct{}{}, q.EnsureUserStorageQuota(ctx, userID)
	})
	return err
}

func (LazyFilesQueries) GetUserStorageQuota(ctx context.Context, userID int32) (developerfiles.StorageQuotaRecord, error) {
	quota, err := withEngineQueries(ctx, func(q *db.Queries) (db.UserStorageQuota, error) {
		return q.GetUserStorageQuota(ctx, userID)
	})
	if err != nil {
		return developerfiles.StorageQuotaRecord{}, err
	}
	return developerfiles.StorageQuotaRecord{
		UserID:     quota.UserID,
		QuotaBytes: quota.QuotaBytes,
		UsedBytes:  quota.UsedBytes,
	}, nil
}

func (LazyFilesQueries) ReserveUserStorageBytes(ctx context.Context, arg developerfiles.StorageQuotaUpdateInput) error {
	_, err := withEngineQueries(ctx, func(q *db.Queries) (struct{}, error) {
		_, err := q.ReserveUserStorageBytes(ctx, db.ReserveUserStorageBytesParams{
			UserID:    arg.UserID,
			UsedBytes: arg.UsedBytes,
		})
		return struct{}{}, err
	})
	return err
}

func (LazyFilesQueries) ReleaseUserStorageBytes(ctx context.Context, arg developerfiles.StorageQuotaUpdateInput) error {
	_, err := withEngineQueries(ctx, func(q *db.Queries) (struct{}, error) {
		_, err := q.ReleaseUserStorageBytes(ctx, db.ReleaseUserStorageBytesParams{
			UserID:    arg.UserID,
			UsedBytes: arg.UsedBytes,
		})
		return struct{}{}, err
	})
	return err
}

func (LazyFilesQueries) CreateDeveloperFileUploadReservation(ctx context.Context, arg developerfiles.CreateDeveloperFileUploadReservationInput) (developerfiles.DeveloperFileUploadReservationRecord, error) {
	return withEngineQueries(ctx, func(q *db.Queries) (developerfiles.DeveloperFileUploadReservationRecord, error) {
		reservation, err := q.CreateDeveloperFileUploadReservation(ctx, db.CreateDeveloperFileUploadReservationParams{
			FileID:        arg.FileID,
			UserID:        arg.UserID,
			BlobPath:      arg.BlobPath,
			ReservedBytes: arg.ReservedBytes,
			ExpiresAt:     arg.ExpiresAt,
		})
		if err != nil {
			return developerfiles.DeveloperFileUploadReservationRecord{}, err
		}
		return mapDeveloperFileUploadReservationRecord(reservation), nil
	})
}

func (LazyFilesQueries) ConsumeDeveloperFileUploadReservation(ctx context.Context, arg developerfiles.DeveloperFileUploadReservationLookupInput) (developerfiles.DeveloperFileUploadReservationRecord, error) {
	return withEngineQueries(ctx, func(q *db.Queries) (developerfiles.DeveloperFileUploadReservationRecord, error) {
		reservation, err := q.ConsumeDeveloperFileUploadReservation(ctx, db.ConsumeDeveloperFileUploadReservationParams{
			FileID:   arg.FileID,
			UserID:   arg.UserID,
			BlobPath: arg.BlobPath,
		})
		if err != nil {
			return developerfiles.DeveloperFileUploadReservationRecord{}, err
		}
		return mapDeveloperFileUploadReservationRecord(reservation), nil
	})
}

func (LazyFilesQueries) ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx context.Context, userID int32) ([]int64, error) {
	return withEngineQueries(ctx, func(q *db.Queries) ([]int64, error) {
		return q.ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx, userID)
	})
}

func (LazyFilesQueries) CreateDeveloperFile(ctx context.Context, arg developerfiles.CreateDeveloperFileInput) (developerfiles.DeveloperFileRecord, error) {
	return withEngineQueries(ctx, func(q *db.Queries) (developerfiles.DeveloperFileRecord, error) {
		file, err := q.CreateDeveloperFile(ctx, db.CreateDeveloperFileParams{
			ID:             arg.ID,
			UserID:         arg.UserID,
			OrganizationID: arg.OrganizationID,
			Filename:       arg.Filename,
			Purpose:        arg.Purpose,
			MimeType:       arg.MimeType,
			Bytes:          arg.Bytes,
			BlobUrl:        arg.BlobURL,
			BlobPath:       arg.BlobPath,
		})
		if err != nil {
			return developerfiles.DeveloperFileRecord{}, err
		}
		return mapDeveloperFileRecord(file), nil
	})
}

func (LazyFilesQueries) GetDeveloperFileByIDForUser(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) (developerfiles.DeveloperFileRecord, error) {
	return withEngineQueries(ctx, func(q *db.Queries) (developerfiles.DeveloperFileRecord, error) {
		file, err := q.GetDeveloperFileByIDForUser(ctx, db.GetDeveloperFileByIDForUserParams{
			ID:     arg.ID,
			UserID: arg.UserID,
		})
		if err != nil {
			return developerfiles.DeveloperFileRecord{}, err
		}
		return mapDeveloperFileRecord(file), nil
	})
}

func (LazyFilesQueries) ListDeveloperFilesByUser(ctx context.Context, arg developerfiles.ListDeveloperFilesInput) ([]developerfiles.DeveloperFileRecord, error) {
	return withEngineQueries(ctx, func(q *db.Queries) ([]developerfiles.DeveloperFileRecord, error) {
		files, err := q.ListDeveloperFilesByUser(ctx, db.ListDeveloperFilesByUserParams{
			UserID: arg.UserID,
			Limit:  arg.Limit,
			Offset: arg.Offset,
		})
		if err != nil {
			return nil, err
		}
		records := make([]developerfiles.DeveloperFileRecord, len(files))
		for i, file := range files {
			records[i] = mapDeveloperFileRecord(file)
		}
		return records, nil
	})
}

func (LazyFilesQueries) CountDeveloperFilesByUser(ctx context.Context, userID int32) (int64, error) {
	return withEngineQueries(ctx, func(q *db.Queries) (int64, error) {
		return q.CountDeveloperFilesByUser(ctx, userID)
	})
}

func (LazyFilesQueries) GetDeveloperFileStorageStatsByUser(ctx context.Context, userID int32) ([]developerfiles.DeveloperFileStorageStatsRecord, error) {
	stats, err := withEngineQueries(ctx, func(q *db.Queries) ([]db.DeveloperFileStorageStats, error) {
		return q.GetDeveloperFileStorageStatsByUser(ctx, userID)
	})
	if err != nil {
		return nil, err
	}
	records := make([]developerfiles.DeveloperFileStorageStatsRecord, len(stats))
	for i, stat := range stats {
		records[i] = developerfiles.DeveloperFileStorageStatsRecord{
			Category: stat.Category,
			Bytes:    stat.Bytes,
			Count:    stat.Count,
		}
	}
	return records, nil
}

func (LazyFilesQueries) MarkDeveloperFileDeleted(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) (developerfiles.DeveloperFileRecord, error) {
	return withEngineQueries(ctx, func(q *db.Queries) (developerfiles.DeveloperFileRecord, error) {
		file, err := q.MarkDeveloperFileDeleted(ctx, db.MarkDeveloperFileDeletedParams{
			ID:     arg.ID,
			UserID: arg.UserID,
		})
		if err != nil {
			return developerfiles.DeveloperFileRecord{}, err
		}
		return mapDeveloperFileRecord(file), nil
	})
}

func (LazyFilesQueries) RestoreDeveloperFileDeletion(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) error {
	_, err := withEngineQueries(ctx, func(q *db.Queries) (struct{}, error) {
		return struct{}{}, q.RestoreDeveloperFileDeletion(ctx, db.RestoreDeveloperFileDeletionParams{
			ID:     arg.ID,
			UserID: arg.UserID,
		})
	})
	return err
}

func mapDeveloperFileRecord(file db.DeveloperFile) developerfiles.DeveloperFileRecord {
	return developerfiles.DeveloperFileRecord{
		ID:        file.ID,
		UserID:    file.UserID,
		Filename:  file.Filename,
		Purpose:   file.Purpose,
		MimeType:  file.MimeType,
		Bytes:     file.Bytes,
		BlobURL:   file.BlobUrl,
		BlobPath:  file.BlobPath,
		CreatedAt: file.CreatedAt,
		UpdatedAt: file.UpdatedAt,
	}
}

func mapDeveloperFileUploadReservationRecord(reservation db.DeveloperFileUploadReservation) developerfiles.DeveloperFileUploadReservationRecord {
	return developerfiles.DeveloperFileUploadReservationRecord{
		FileID:        reservation.FileID,
		UserID:        reservation.UserID,
		BlobPath:      reservation.BlobPath,
		ReservedBytes: reservation.ReservedBytes,
		ExpiresAt:     reservation.ExpiresAt,
		CompletedAt:   reservation.CompletedAt,
		CreatedAt:     reservation.CreatedAt,
		UpdatedAt:     reservation.UpdatedAt,
	}
}
