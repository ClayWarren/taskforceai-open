package db

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	coreusage "github.com/TaskForceAI/core/pkg/usage"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateDeveloperFileUploadReservation(t *testing.T) {
	mockPool := newRegexpTestMockPool(t)
	q := New(mockPool)
	expiresAt := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
	now := pgtype.Timestamp{Time: time.Unix(50, 0), Valid: true}

	mockPool.ExpectQuery(regexp.QuoteMeta(createDeveloperFileUploadReservation)).
		WithArgs("file-1", int32(42), "users/42/file-1", int64(2048), expiresAt).
		WillReturnRows(pgxmock.NewRows(developerFileUploadReservationColumns()).
			AddRow("file-1", int32(42), "users/42/file-1", int64(2048), expiresAt, pgtype.Timestamp{}, now, now))

	got, err := q.CreateDeveloperFileUploadReservation(context.Background(), CreateDeveloperFileUploadReservationParams{
		FileID:        "file-1",
		UserID:        42,
		BlobPath:      "users/42/file-1",
		ReservedBytes: 2048,
		ExpiresAt:     expiresAt,
	})

	require.NoError(t, err)
	assert.Equal(t, "file-1", got.FileID)
	assert.Equal(t, int32(42), got.UserID)
	assert.Equal(t, "users/42/file-1", got.BlobPath)
	assert.Equal(t, int64(2048), got.ReservedBytes)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestConsumeDeveloperFileUploadReservation(t *testing.T) {
	mockPool := newRegexpTestMockPool(t)
	q := New(mockPool)
	expiresAt := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
	completedAt := pgtype.Timestamp{Time: time.Unix(75, 0), Valid: true}
	createdAt := pgtype.Timestamp{Time: time.Unix(50, 0), Valid: true}

	mockPool.ExpectQuery(regexp.QuoteMeta(consumeDeveloperFileUploadReservation)).
		WithArgs("file-1", int32(42), "users/42/file-1").
		WillReturnRows(pgxmock.NewRows(developerFileUploadReservationColumns()).
			AddRow("file-1", int32(42), "users/42/file-1", int64(2048), expiresAt, completedAt, createdAt, completedAt))

	got, err := q.ConsumeDeveloperFileUploadReservation(context.Background(), ConsumeDeveloperFileUploadReservationParams{
		FileID:   "file-1",
		UserID:   42,
		BlobPath: "users/42/file-1",
	})

	require.NoError(t, err)
	assert.Equal(t, completedAt, got.CompletedAt)
	assert.Equal(t, int64(2048), got.ReservedBytes)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestReleaseExpiredDeveloperFileUploadReservationsForUser(t *testing.T) {
	mockPool := newRegexpTestMockPool(t)
	q := New(mockPool)

	mockPool.ExpectQuery(regexp.QuoteMeta(releaseExpiredDeveloperFileUploadReservationsForUser)).
		WithArgs(int32(42)).
		WillReturnRows(pgxmock.NewRows([]string{"reserved_bytes"}).
			AddRow(int64(1024)).
			AddRow(int64(2048)))

	got, err := q.ReleaseExpiredDeveloperFileUploadReservationsForUser(context.Background(), 42)

	require.NoError(t, err)
	assert.Equal(t, []int64{1024, 2048}, got)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestReleaseExpiredDeveloperFileUploadReservationsForUserQueryError(t *testing.T) {
	mockPool := newRegexpTestMockPool(t)
	q := New(mockPool)

	mockPool.ExpectQuery(regexp.QuoteMeta(releaseExpiredDeveloperFileUploadReservationsForUser)).
		WithArgs(int32(42)).
		WillReturnError(errors.New("query failed"))

	got, err := q.ReleaseExpiredDeveloperFileUploadReservationsForUser(context.Background(), 42)

	require.Error(t, err)
	assert.Nil(t, got)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestReleaseExpiredDeveloperFileUploadReservationsForUserScanAndRowsErrors(t *testing.T) {
	t.Run("scan error", func(t *testing.T) {
		mockPool := newRegexpTestMockPool(t)
		q := New(mockPool)
		mockPool.ExpectQuery(regexp.QuoteMeta(releaseExpiredDeveloperFileUploadReservationsForUser)).
			WithArgs(int32(42)).
			WillReturnRows(pgxmock.NewRows([]string{"reserved_bytes"}).AddRow("bad"))

		got, err := q.ReleaseExpiredDeveloperFileUploadReservationsForUser(context.Background(), 42)
		require.Error(t, err)
		assert.Nil(t, got)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("rows error", func(t *testing.T) {
		mockPool := newRegexpTestMockPool(t)
		q := New(mockPool)
		mockPool.ExpectQuery(regexp.QuoteMeta(releaseExpiredDeveloperFileUploadReservationsForUser)).
			WithArgs(int32(42)).
			WillReturnRows(pgxmock.NewRows([]string{"reserved_bytes"}).
				AddRow(int64(1024)).
				CloseError(errors.New("rows failed")))

		got, err := q.ReleaseExpiredDeveloperFileUploadReservationsForUser(context.Background(), 42)
		require.ErrorContains(t, err, "rows failed")
		assert.Nil(t, got)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})
}

func TestDeveloperFileStorageStatsByUser(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		mockPool := newRegexpTestMockPool(t)
		q := New(mockPool)
		mockPool.ExpectQuery(regexp.QuoteMeta(getDeveloperFileStorageStatsByUser)).
			WithArgs(int32(42)).
			WillReturnRows(pgxmock.NewRows([]string{"category", "bytes", "count"}).
				AddRow("files", int64(1024), int64(2)))

		got, err := q.GetDeveloperFileStorageStatsByUser(context.Background(), 42)
		require.NoError(t, err)
		require.Len(t, got, 1)
		assert.Equal(t, DeveloperFileStorageStats{Category: "files", Bytes: 1024, Count: 2}, got[0])
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("query error", func(t *testing.T) {
		mockPool := newRegexpTestMockPool(t)
		q := New(mockPool)
		mockPool.ExpectQuery(regexp.QuoteMeta(getDeveloperFileStorageStatsByUser)).
			WithArgs(int32(42)).
			WillReturnError(errors.New("query failed"))

		got, err := q.GetDeveloperFileStorageStatsByUser(context.Background(), 42)
		require.ErrorContains(t, err, "query failed")
		assert.Nil(t, got)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("scan error", func(t *testing.T) {
		mockPool := newRegexpTestMockPool(t)
		q := New(mockPool)
		mockPool.ExpectQuery(regexp.QuoteMeta(getDeveloperFileStorageStatsByUser)).
			WithArgs(int32(42)).
			WillReturnRows(pgxmock.NewRows([]string{"category", "bytes", "count"}).
				AddRow("files", "bad", int64(2)))

		got, err := q.GetDeveloperFileStorageStatsByUser(context.Background(), 42)
		require.Error(t, err)
		assert.Nil(t, got)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("rows error", func(t *testing.T) {
		mockPool := newRegexpTestMockPool(t)
		q := New(mockPool)
		mockPool.ExpectQuery(regexp.QuoteMeta(getDeveloperFileStorageStatsByUser)).
			WithArgs(int32(42)).
			WillReturnRows(pgxmock.NewRows([]string{"category", "bytes", "count"}).
				AddRow("files", int64(1024), int64(2)).
				CloseError(errors.New("rows failed")))

		got, err := q.GetDeveloperFileStorageStatsByUser(context.Background(), 42)
		require.ErrorContains(t, err, "rows failed")
		assert.Nil(t, got)
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})
}

func TestUsageExtensionQueries(t *testing.T) {
	t.Run("token usage success empty rows and exec error", func(t *testing.T) {
		mockPool := newRegexpTestMockPool(t)
		q := New(mockPool)
		require.NoError(t, q.CreateTokenUsage(context.Background(), nil))

		mockPool.ExpectExec("INSERT INTO token_usage").
			WithArgs(nil, (*int)(nil), (*string)(nil), (*string)(nil), nil, nil, 1, 2, 3, 4, nil).
			WillReturnResult(pgxmock.NewResult("INSERT", 1))
		err := q.CreateTokenUsage(context.Background(), []coreusage.TokenUsageRow{{
			PromptTokens: 1, CompletionTokens: 2, TotalTokens: 3, CostMicros: 4,
		}})
		require.NoError(t, err)

		mockPool.ExpectExec("INSERT INTO token_usage").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnError(errors.New("insert failed"))
		err = q.CreateTokenUsage(context.Background(), []coreusage.TokenUsageRow{{TaskID: "task"}})
		require.ErrorContains(t, err, "insert failed")
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("tool usage success empty rows and exec error", func(t *testing.T) {
		mockPool := newRegexpTestMockPool(t)
		q := New(mockPool)
		require.NoError(t, q.CreateToolUsage(context.Background(), nil))

		mockPool.ExpectExec("INSERT INTO tool_usage").
			WithArgs("task", (*int)(nil), (*string)(nil), (*string)(nil), "search", true, 12, (*string)(nil), `{"agentId":null,"agentLabel":null,"resultPreview":null}`).
			WillReturnResult(pgxmock.NewResult("INSERT", 1))
		err := q.CreateToolUsage(context.Background(), []coreusage.ToolUsageRow{{
			TaskID: "task", ToolName: "search", Success: true, DurationMs: 12,
		}})
		require.NoError(t, err)

		mockPool.ExpectExec("INSERT INTO tool_usage").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnError(errors.New("insert failed"))
		err = q.CreateToolUsage(context.Background(), []coreusage.ToolUsageRow{{ToolName: "search"}})
		require.ErrorContains(t, err, "insert failed")
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})

	t.Run("helpers and soft delete", func(t *testing.T) {
		assert.Nil(t, emptyStringToNil(""))
		assert.Equal(t, "value", emptyStringToNil("value"))
		assert.Nil(t, jsonBytesToNil(nil))
		assert.Equal(t, `{"ok":true}`, jsonBytesToNil([]byte(`{"ok":true}`)))

		mockPool := newRegexpTestMockPool(t)
		q := New(mockPool)
		require.NoError(t, q.SoftDeleteDeveloperFilesByIDsForUser(context.Background(), nil, 42, nil))

		orgID := int32(7)
		mockPool.ExpectExec("WITH updated AS").
			WithArgs([]string{"file-1"}, int32(42), &orgID).
			WillReturnResult(pgxmock.NewResult("UPDATE", 1))
		require.NoError(t, q.SoftDeleteDeveloperFilesByIDsForUser(context.Background(), []string{"file-1"}, 42, &orgID))

		mockPool.ExpectExec("WITH updated AS").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnError(errors.New("delete failed"))
		err := q.SoftDeleteDeveloperFilesByIDsForUser(context.Background(), []string{"file-2"}, 42, nil)
		require.ErrorContains(t, err, "delete failed")
		assert.NoError(t, mockPool.ExpectationsWereMet())
	})
}

func TestAdvanceSyncVersionSequence(t *testing.T) {
	mockPool := newRegexpTestMockPool(t)
	q := New(mockPool)

	mockPool.ExpectExec(regexp.QuoteMeta(advanceSyncVersionSequence)).
		WithArgs(int32(123)).
		WillReturnResult(pgxmock.NewResult("SELECT", 1))

	require.NoError(t, q.AdvanceSyncVersionSequence(context.Background(), 123))
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func TestNextSyncVersion(t *testing.T) {
	mockPool := newRegexpTestMockPool(t)
	q := New(mockPool)

	mockPool.ExpectQuery(regexp.QuoteMeta(nextSyncVersion)).
		WillReturnRows(pgxmock.NewRows([]string{"nextval"}).AddRow(int32(124)))

	version, err := q.NextSyncVersion(context.Background())
	require.NoError(t, err)
	assert.Equal(t, int32(124), version)
	assert.NoError(t, mockPool.ExpectationsWereMet())
}

func developerFileUploadReservationColumns() []string {
	return []string{
		"file_id", "user_id", "blob_path", "reserved_bytes",
		"expires_at", "completed_at", "created_at", "updated_at",
	}
}

func newRegexpTestMockPool(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	pool, err := pgxmock.NewPool(pgxmock.QueryMatcherOption(pgxmock.QueryMatcherRegexp))
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	return pool
}
