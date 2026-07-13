package database

import (
	"context"

	"github.com/TaskForceAI/adapters/pkg/db"
	developerfiles "github.com/TaskForceAI/go-engine/pkg/handlers/developer/files"
)

// DeveloperFilesStore adapts shared sqlc queries to the developer-files gateway.
type DeveloperFilesStore struct {
	queries func(context.Context) (*db.Queries, error)
}

func NewDeveloperFilesStore(q *db.Queries) *DeveloperFilesStore {
	return NewLazyDeveloperFilesStore(func(context.Context) (*db.Queries, error) { return q, nil })
}

func NewLazyDeveloperFilesStore(queries func(context.Context) (*db.Queries, error)) *DeveloperFilesStore {
	return &DeveloperFilesStore{queries: queries}
}

func withDeveloperFileQueries[T any](ctx context.Context, store *DeveloperFilesStore, fn func(*db.Queries) (T, error)) (T, error) {
	q, err := store.queries(ctx)
	if err != nil {
		var zero T
		return zero, err
	}
	return fn(q)
}

func (s *DeveloperFilesStore) EnsureUserStorageQuota(ctx context.Context, userID int32) error {
	_, err := withDeveloperFileQueries(ctx, s, func(q *db.Queries) (struct{}, error) {
		return struct{}{}, q.EnsureUserStorageQuota(ctx, userID)
	})
	return err
}

func (s *DeveloperFilesStore) GetUserStorageQuota(ctx context.Context, userID int32) (developerfiles.StorageQuotaRecord, error) {
	quota, err := withDeveloperFileQueries(ctx, s, func(q *db.Queries) (db.UserStorageQuota, error) {
		return q.GetUserStorageQuota(ctx, userID)
	})
	if err != nil {
		return developerfiles.StorageQuotaRecord{}, err
	}
	return developerfiles.StorageQuotaRecord{UserID: quota.UserID, QuotaBytes: quota.QuotaBytes, UsedBytes: quota.UsedBytes}, nil
}

func (s *DeveloperFilesStore) ReserveUserStorageBytes(ctx context.Context, arg developerfiles.StorageQuotaUpdateInput) error {
	_, err := withDeveloperFileQueries(ctx, s, func(q *db.Queries) (db.UserStorageQuota, error) {
		return q.ReserveUserStorageBytes(ctx, db.ReserveUserStorageBytesParams(arg))
	})
	return err
}

func (s *DeveloperFilesStore) ReleaseUserStorageBytes(ctx context.Context, arg developerfiles.StorageQuotaUpdateInput) error {
	_, err := withDeveloperFileQueries(ctx, s, func(q *db.Queries) (db.UserStorageQuota, error) {
		return q.ReleaseUserStorageBytes(ctx, db.ReleaseUserStorageBytesParams(arg))
	})
	return err
}

func (s *DeveloperFilesStore) CreateDeveloperFileUploadReservation(ctx context.Context, arg developerfiles.CreateDeveloperFileUploadReservationInput) (developerfiles.DeveloperFileUploadReservationRecord, error) {
	return withDeveloperFileQueries(ctx, s, func(q *db.Queries) (developerfiles.DeveloperFileUploadReservationRecord, error) {
		row, err := q.CreateDeveloperFileUploadReservation(ctx, db.CreateDeveloperFileUploadReservationParams(arg))
		return mapDeveloperFileUploadReservation(row), err
	})
}

func (s *DeveloperFilesStore) ConsumeDeveloperFileUploadReservation(ctx context.Context, arg developerfiles.DeveloperFileUploadReservationLookupInput) (developerfiles.DeveloperFileUploadReservationRecord, error) {
	return withDeveloperFileQueries(ctx, s, func(q *db.Queries) (developerfiles.DeveloperFileUploadReservationRecord, error) {
		row, err := q.ConsumeDeveloperFileUploadReservation(ctx, db.ConsumeDeveloperFileUploadReservationParams(arg))
		return mapDeveloperFileUploadReservation(row), err
	})
}

func (s *DeveloperFilesStore) ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx context.Context, userID int32) ([]int64, error) {
	return withDeveloperFileQueries(ctx, s, func(q *db.Queries) ([]int64, error) {
		return q.ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx, userID)
	})
}

func (s *DeveloperFilesStore) CreateDeveloperFile(ctx context.Context, arg developerfiles.CreateDeveloperFileInput) (developerfiles.DeveloperFileRecord, error) {
	return withDeveloperFileQueries(ctx, s, func(q *db.Queries) (developerfiles.DeveloperFileRecord, error) {
		row, err := q.CreateDeveloperFile(ctx, db.CreateDeveloperFileParams{
			ID: arg.ID, UserID: arg.UserID, OrganizationID: arg.OrganizationID, Filename: arg.Filename,
			Purpose: arg.Purpose, MimeType: arg.MimeType, Bytes: arg.Bytes, BlobUrl: arg.BlobURL, BlobPath: arg.BlobPath,
		})
		return mapDeveloperFile(row), err
	})
}

func (s *DeveloperFilesStore) GetDeveloperFileByIDForUser(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) (developerfiles.DeveloperFileRecord, error) {
	return withDeveloperFileQueries(ctx, s, func(q *db.Queries) (developerfiles.DeveloperFileRecord, error) {
		row, err := q.GetDeveloperFileByIDForUser(ctx, db.GetDeveloperFileByIDForUserParams(arg))
		return mapDeveloperFile(row), err
	})
}

func (s *DeveloperFilesStore) ListDeveloperFilesByUser(ctx context.Context, arg developerfiles.ListDeveloperFilesInput) ([]developerfiles.DeveloperFileRecord, error) {
	return withDeveloperFileQueries(ctx, s, func(q *db.Queries) ([]developerfiles.DeveloperFileRecord, error) {
		rows, err := q.ListDeveloperFilesByUser(ctx, db.ListDeveloperFilesByUserParams(arg))
		if err != nil {
			return nil, err
		}
		records := make([]developerfiles.DeveloperFileRecord, len(rows))
		for i, row := range rows {
			records[i] = mapDeveloperFile(row)
		}
		return records, nil
	})
}

func (s *DeveloperFilesStore) CountDeveloperFilesByUser(ctx context.Context, userID int32) (int64, error) {
	return withDeveloperFileQueries(ctx, s, func(q *db.Queries) (int64, error) {
		return q.CountDeveloperFilesByUser(ctx, userID)
	})
}

func (s *DeveloperFilesStore) GetDeveloperFileStorageStatsByUser(ctx context.Context, userID int32) ([]developerfiles.DeveloperFileStorageStatsRecord, error) {
	return withDeveloperFileQueries(ctx, s, func(q *db.Queries) ([]developerfiles.DeveloperFileStorageStatsRecord, error) {
		rows, err := q.GetDeveloperFileStorageStatsByUser(ctx, userID)
		if err != nil {
			return nil, err
		}
		records := make([]developerfiles.DeveloperFileStorageStatsRecord, len(rows))
		for i, row := range rows {
			records[i] = developerfiles.DeveloperFileStorageStatsRecord{Category: row.Category, Bytes: row.Bytes, Count: row.Count}
		}
		return records, nil
	})
}

func (s *DeveloperFilesStore) MarkDeveloperFileDeleted(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) (developerfiles.DeveloperFileRecord, error) {
	return withDeveloperFileQueries(ctx, s, func(q *db.Queries) (developerfiles.DeveloperFileRecord, error) {
		row, err := q.MarkDeveloperFileDeleted(ctx, db.MarkDeveloperFileDeletedParams(arg))
		return mapDeveloperFile(row), err
	})
}

func (s *DeveloperFilesStore) RestoreDeveloperFileDeletion(ctx context.Context, arg developerfiles.DeveloperFileLookupInput) error {
	_, err := withDeveloperFileQueries(ctx, s, func(q *db.Queries) (struct{}, error) {
		return struct{}{}, q.RestoreDeveloperFileDeletion(ctx, db.RestoreDeveloperFileDeletionParams(arg))
	})
	return err
}

func mapDeveloperFile(row db.DeveloperFile) developerfiles.DeveloperFileRecord {
	return developerfiles.DeveloperFileRecord{
		ID: row.ID, UserID: row.UserID, Filename: row.Filename, Purpose: row.Purpose, MimeType: row.MimeType,
		Bytes: row.Bytes, BlobURL: row.BlobUrl, BlobPath: row.BlobPath, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func mapDeveloperFileUploadReservation(row db.DeveloperFileUploadReservation) developerfiles.DeveloperFileUploadReservationRecord {
	return developerfiles.DeveloperFileUploadReservationRecord{
		FileID: row.FileID, UserID: row.UserID, BlobPath: row.BlobPath, ReservedBytes: row.ReservedBytes,
		ExpiresAt: row.ExpiresAt, CompletedAt: row.CompletedAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}
