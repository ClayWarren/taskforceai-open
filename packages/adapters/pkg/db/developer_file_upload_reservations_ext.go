package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

type CreateDeveloperFileUploadReservationParams struct {
	FileID        string           `json:"file_id"`
	UserID        int32            `json:"user_id"`
	BlobPath      string           `json:"blob_path"`
	ReservedBytes int64            `json:"reserved_bytes"`
	ExpiresAt     pgtype.Timestamp `json:"expires_at"`
}

const createDeveloperFileUploadReservation = `
INSERT INTO developer_file_upload_reservations (
    file_id,
    user_id,
    blob_path,
    reserved_bytes,
    expires_at,
    updated_at
)
VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
RETURNING file_id, user_id, blob_path, reserved_bytes, expires_at, completed_at, created_at, updated_at
`

func (q *Queries) CreateDeveloperFileUploadReservation(ctx context.Context, arg CreateDeveloperFileUploadReservationParams) (DeveloperFileUploadReservation, error) {
	row := q.db.QueryRow(ctx, createDeveloperFileUploadReservation,
		arg.FileID,
		arg.UserID,
		arg.BlobPath,
		arg.ReservedBytes,
		arg.ExpiresAt,
	)
	var i DeveloperFileUploadReservation
	err := row.Scan(
		&i.FileID,
		&i.UserID,
		&i.BlobPath,
		&i.ReservedBytes,
		&i.ExpiresAt,
		&i.CompletedAt,
		&i.CreatedAt,
		&i.UpdatedAt,
	)
	return i, err
}

type ConsumeDeveloperFileUploadReservationParams struct {
	FileID   string `json:"file_id"`
	UserID   int32  `json:"user_id"`
	BlobPath string `json:"blob_path"`
}

const consumeDeveloperFileUploadReservation = `
UPDATE developer_file_upload_reservations
SET completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
WHERE
    file_id = $1
    AND user_id = $2
    AND blob_path = $3
    AND completed_at IS NULL
    AND expires_at > CURRENT_TIMESTAMP
RETURNING file_id, user_id, blob_path, reserved_bytes, expires_at, completed_at, created_at, updated_at
`

func (q *Queries) ConsumeDeveloperFileUploadReservation(ctx context.Context, arg ConsumeDeveloperFileUploadReservationParams) (DeveloperFileUploadReservation, error) {
	row := q.db.QueryRow(ctx, consumeDeveloperFileUploadReservation, arg.FileID, arg.UserID, arg.BlobPath)
	var i DeveloperFileUploadReservation
	err := row.Scan(
		&i.FileID,
		&i.UserID,
		&i.BlobPath,
		&i.ReservedBytes,
		&i.ExpiresAt,
		&i.CompletedAt,
		&i.CreatedAt,
		&i.UpdatedAt,
	)
	return i, err
}

const releaseExpiredDeveloperFileUploadReservationsForUser = `
DELETE FROM developer_file_upload_reservations
WHERE
    user_id = $1
    AND completed_at IS NULL
    AND expires_at <= CURRENT_TIMESTAMP
RETURNING reserved_bytes
`

func (q *Queries) ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx context.Context, userID int32) ([]int64, error) {
	rows, err := q.db.Query(ctx, releaseExpiredDeveloperFileUploadReservationsForUser, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []int64{}
	for rows.Next() {
		var reservedBytes int64
		if err := rows.Scan(&reservedBytes); err != nil {
			return nil, err
		}
		items = append(items, reservedBytes)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
