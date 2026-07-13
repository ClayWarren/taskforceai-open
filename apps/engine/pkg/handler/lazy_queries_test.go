package handler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	developerhandlers "github.com/TaskForceAI/go-engine/pkg/handlers/developer"
	developerfiles "github.com/TaskForceAI/go-engine/pkg/handlers/developer/files"
	runhandlers "github.com/TaskForceAI/go-engine/pkg/handlers/run"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withQueryLoaderError(t *testing.T) {
	t.Helper()
	originalGetQueries := GetQueries
	GetQueries = func(context.Context) (*db.Queries, error) {
		return nil, errors.New("loader failed")
	}
	t.Cleanup(func() {
		GetQueries = originalGetQueries
	})
}

func developerFileColumns() []string {
	return []string{
		"id", "user_id", "organization_id", "filename", "purpose", "mime_type", "bytes",
		"blob_url", "blob_path", "created_at", "updated_at", "deleted_at",
	}
}

func developerFileRow(now pgtype.Timestamp) *pgxmock.Rows {
	orgID := int32(7)
	return pgxmock.NewRows(developerFileColumns()).AddRow(
		"file-1", int32(42), &orgID, "notes.txt", "assistants", "text/plain", int64(512),
		"https://blob.example/file", "users/42/file", now, now, pgtype.Timestamp{},
	)
}

func quotaRow(now pgtype.Timestamp) *pgxmock.Rows {
	return pgxmock.NewRows([]string{"user_id", "quota_bytes", "used_bytes", "created_at", "updated_at"}).
		AddRow(int32(42), int64(1_000_000), int64(128), now, now)
}

func uploadReservationRow(now, expiresAt pgtype.Timestamp) *pgxmock.Rows {
	return pgxmock.NewRows([]string{"file_id", "user_id", "blob_path", "reserved_bytes", "expires_at", "completed_at", "created_at", "updated_at"}).
		AddRow("file-1", int32(42), "users/42/file", int64(512), expiresAt, pgtype.Timestamp{}, now, now)
}

func withMockQueries(t *testing.T, mock pgxmock.PgxPoolIface) {
	t.Helper()
	originalGetQueries := GetQueries
	GetQueries = func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	}
	t.Cleanup(func() {
		GetQueries = originalGetQueries
	})
}

func TestLazyDeveloperQueriesDatabaseError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withMockQueries(t, mock)

	dbErr := errors.New("messages query failed")
	mock.ExpectQuery("GetMessagesByConversation").WithArgs(int32(1)).WillReturnError(dbErr)

	_, err := (LazyDeveloperQueries{}).GetMessagesByConversation(context.Background(), 1)
	require.ErrorIs(t, err, dbErr)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyDeveloperQueriesMapRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withMockQueries(t, mock)

	ctx := context.Background()
	now := pgtype.Timestamp{Time: time.Unix(200, 0), Valid: true}
	columns := []string{
		"id", "message_id", "conversation_id", "role", "content", "is_streaming", "is_agent_status",
		"elapsed_seconds", "created_at", "error", "sources", "tool_events", "agent_statuses",
		"vector_clock", "sync_version", "last_synced_at", "device_id", "is_deleted", "updated_at",
		"rating", "trace",
	}
	mock.ExpectQuery("GetMessagesByConversation").WithArgs(int32(9)).WillReturnRows(
		pgxmock.NewRows(columns).AddRow(
			int32(1), "msg-1", int32(9), "assistant", "hello", false, false, (*float64)(nil), now,
			(*string)(nil), []byte("[]"), []byte("[]"), []byte("[]"), []byte("{}"), int32(1), now,
			(*string)(nil), false, now, int32(5), []byte(`{"ok":true}`),
		),
	)

	messages, err := (LazyDeveloperQueries{}).GetMessagesByConversation(ctx, 9)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	assert.Equal(t, "assistant", messages[0].Role)
	assert.Equal(t, []byte(`{"ok":true}`), messages[0].Trace)
	assert.Equal(t, int32(5), messages[0].Rating)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyDeveloperQueriesMappedFields(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withMockQueries(t, mock)

	now := pgtype.Timestamp{Time: time.Unix(200, 0), Valid: true}
	mock.ExpectQuery("GetMessagesByConversation").WithArgs(int32(2)).WillReturnRows(
		pgxmock.NewRows([]string{
			"id", "message_id", "conversation_id", "role", "content", "is_streaming", "is_agent_status",
			"elapsed_seconds", "created_at", "error", "sources", "tool_events", "agent_statuses",
			"vector_clock", "sync_version", "last_synced_at", "device_id", "is_deleted", "updated_at",
			"rating", "trace",
		}).AddRow(
			int32(2), "msg-2", int32(2), "user", "prompt", true, true, (*float64)(nil), now,
			(*string)(nil), []byte("[]"), []byte("[]"), []byte("[]"), []byte("{}"), int32(2), now,
			(*string)(nil), true, now, int32(0), []byte(`{}`),
		),
	)

	messages, err := (LazyDeveloperQueries{}).GetMessagesByConversation(context.Background(), 2)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	assert.Equal(t, developerhandlers.ThreadMessage{
		ID:             2,
		MessageID:      "msg-2",
		ConversationID: 2,
		Role:           "user",
		Content:        "prompt",
		IsStreaming:    true,
		IsAgentStatus:  true,
		CreatedAt:      now,
		IsDeleted:      true,
		UpdatedAt:      now,
		SyncVersion:    2,
		LastSyncedAt:   now,
		Sources:        []byte("[]"),
		ToolEvents:     []byte("[]"),
		AgentStatuses:  []byte("[]"),
		VectorClock:    []byte("{}"),
		Trace:          []byte(`{}`),
	}, messages[0])
}

func TestLazyDeveloperQueriesDelegateOrgAccess(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withMockQueries(t, mock)

	now := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
	queries := LazyDeveloperQueries{}

	mock.ExpectQuery("GetOrganizationByID").WithArgs(int32(7)).WillReturnRows(
		pgxmock.NewRows([]string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}).
			AddRow(int32(7), "Org", "org", nil, now, now, "free", nil, nil, nil, nil, true, []byte("{}")),
	)
	org, err := queries.GetOrganizationByID(context.Background(), 7)
	require.NoError(t, err)
	assert.True(t, org.NoTraining)

	mock.ExpectQuery("GetMembership").WithArgs(int32(7), int32(42)).WillReturnRows(
		pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(1), int32(7), int32(42), db.OrganizationRoleMEMBER, now, now),
	)
	membership, err := queries.GetMembership(context.Background(), runhandlers.MembershipLookupInput{OrganizationID: 7, UserID: 42})
	require.NoError(t, err)
	assert.Equal(t, int32(42), membership.UserID)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyDeveloperQueriesReturnLoaderErrors(t *testing.T) {
	withQueryLoaderError(t)

	_, err := (LazyDeveloperQueries{}).GetMessagesByConversation(context.Background(), 1)

	assert.EqualError(t, err, "loader failed")
}

func TestLazyFilesQueriesCreateDeveloperFileError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withMockQueries(t, mock)

	dbErr := errors.New("create failed")
	mock.ExpectQuery("CreateDeveloperFile").WithArgs(
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
	).WillReturnError(dbErr)
	_, err := (LazyFilesQueries{}).CreateDeveloperFile(context.Background(), developerfiles.CreateDeveloperFileInput{ID: "file-1"})
	require.ErrorIs(t, err, dbErr)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyFilesQueriesGetDeveloperFileNoRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withMockQueries(t, mock)

	mock.ExpectQuery("GetDeveloperFileByIDForUser").WithArgs("file-1", int32(1)).WillReturnError(pgx.ErrNoRows)
	_, err := (LazyFilesQueries{}).GetDeveloperFileByIDForUser(context.Background(), developerfiles.DeveloperFileLookupInput{ID: "file-1", UserID: 1})
	require.ErrorIs(t, err, pgx.ErrNoRows)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyFilesQueriesListDeveloperFilesError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withMockQueries(t, mock)

	dbErr := errors.New("list failed")
	mock.ExpectQuery("ListDeveloperFilesByUser").WithArgs(int32(1), pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnError(dbErr)
	_, err := (LazyFilesQueries{}).ListDeveloperFilesByUser(context.Background(), developerfiles.ListDeveloperFilesInput{UserID: 1})
	require.ErrorIs(t, err, dbErr)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyFilesQueriesMapRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withMockQueries(t, mock)

	ctx := context.Background()
	queries := LazyFilesQueries{}
	now := pgtype.Timestamp{Time: time.Unix(10, 0), Valid: true}

	mock.ExpectExec("EnsureUserStorageQuota").WithArgs(int32(42)).WillReturnResult(pgxmock.NewResult("INSERT", 1))
	require.NoError(t, queries.EnsureUserStorageQuota(ctx, 42))

	mock.ExpectQuery("GetUserStorageQuota").WithArgs(int32(42)).WillReturnRows(quotaRow(now))
	quota, err := queries.GetUserStorageQuota(ctx, 42)
	require.NoError(t, err)
	assert.Equal(t, int64(128), quota.UsedBytes)

	mock.ExpectQuery("ReserveUserStorageBytes").WithArgs(int32(42), int64(128)).WillReturnRows(quotaRow(now))
	require.NoError(t, queries.ReserveUserStorageBytes(ctx, developerfiles.StorageQuotaUpdateInput{UserID: 42, UsedBytes: 128}))

	mock.ExpectQuery("ReleaseUserStorageBytes").WithArgs(int32(42), int64(128)).WillReturnRows(quotaRow(now))
	require.NoError(t, queries.ReleaseUserStorageBytes(ctx, developerfiles.StorageQuotaUpdateInput{UserID: 42, UsedBytes: 128}))

	mock.ExpectQuery("CreateDeveloperFile").WithArgs(
		"file-1", int32(42), pgxmock.AnyArg(), "notes.txt", "assistants", "text/plain", int64(512),
		"https://blob.example/file", "users/42/file",
	).WillReturnRows(developerFileRow(now))
	created, err := queries.CreateDeveloperFile(ctx, developerfiles.CreateDeveloperFileInput{
		ID: "file-1", UserID: 42, Filename: "notes.txt", Purpose: "assistants", MimeType: "text/plain",
		Bytes: 512, BlobURL: "https://blob.example/file", BlobPath: "users/42/file",
	})
	require.NoError(t, err)
	assert.Equal(t, "file-1", created.ID)

	expiresAt := pgtype.Timestamp{Time: time.Unix(600, 0), Valid: true}
	mock.ExpectQuery("INSERT INTO developer_file_upload_reservations").
		WithArgs("file-1", int32(42), "users/42/file", int64(512), expiresAt).
		WillReturnRows(uploadReservationRow(now, expiresAt))
	reservation, err := queries.CreateDeveloperFileUploadReservation(ctx, developerfiles.CreateDeveloperFileUploadReservationInput{
		FileID:        "file-1",
		UserID:        42,
		BlobPath:      "users/42/file",
		ReservedBytes: 512,
		ExpiresAt:     expiresAt,
	})
	require.NoError(t, err)
	assert.Equal(t, int64(512), reservation.ReservedBytes)

	mock.ExpectQuery("UPDATE developer_file_upload_reservations").
		WithArgs("file-1", int32(42), "users/42/file").
		WillReturnRows(uploadReservationRow(now, expiresAt))
	consumed, err := queries.ConsumeDeveloperFileUploadReservation(ctx, developerfiles.DeveloperFileUploadReservationLookupInput{
		FileID:   "file-1",
		UserID:   42,
		BlobPath: "users/42/file",
	})
	require.NoError(t, err)
	assert.Equal(t, "file-1", consumed.FileID)

	mock.ExpectQuery("DELETE FROM developer_file_upload_reservations").
		WithArgs(int32(42)).
		WillReturnRows(pgxmock.NewRows([]string{"reserved_bytes"}).AddRow(int64(64)))
	expired, err := queries.ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx, 42)
	require.NoError(t, err)
	assert.Equal(t, []int64{64}, expired)

	mock.ExpectQuery("GetDeveloperFileByIDForUser").WithArgs("file-1", int32(42)).WillReturnRows(developerFileRow(now))
	found, err := queries.GetDeveloperFileByIDForUser(ctx, developerfiles.DeveloperFileLookupInput{ID: "file-1", UserID: 42})
	require.NoError(t, err)
	assert.Equal(t, int32(42), found.UserID)

	mock.ExpectQuery("ListDeveloperFilesByUser").WithArgs(int32(42), int32(20), int32(0)).WillReturnRows(developerFileRow(now))
	files, err := queries.ListDeveloperFilesByUser(ctx, developerfiles.ListDeveloperFilesInput{UserID: 42, Limit: 20, Offset: 0})
	require.NoError(t, err)
	require.Len(t, files, 1)

	mock.ExpectQuery("CountDeveloperFilesByUser").WithArgs(int32(42)).WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(1)))
	count, err := queries.CountDeveloperFilesByUser(ctx, 42)
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)

	mock.ExpectQuery("WITH categorized_files").
		WithArgs(int32(42)).
		WillReturnRows(pgxmock.NewRows([]string{"category", "bytes", "count"}).AddRow("files", int64(512), int64(1)))
	stats, err := queries.GetDeveloperFileStorageStatsByUser(ctx, 42)
	require.NoError(t, err)
	require.Len(t, stats, 1)
	assert.Equal(t, "files", stats[0].Category)

	mock.ExpectQuery("MarkDeveloperFileDeleted").WithArgs("file-1", int32(42)).WillReturnRows(developerFileRow(now))
	deleted, err := queries.MarkDeveloperFileDeleted(ctx, developerfiles.DeveloperFileLookupInput{ID: "file-1", UserID: 42})
	require.NoError(t, err)
	assert.Equal(t, "file-1", deleted.ID)

	mock.ExpectExec("RestoreDeveloperFileDeletion").WithArgs("file-1", int32(42)).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	require.NoError(t, queries.RestoreDeveloperFileDeletion(ctx, developerfiles.DeveloperFileLookupInput{ID: "file-1", UserID: 42}))

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyFilesQueriesStorageAndReservationErrors(t *testing.T) {
	mock := dbtest.NewMockPoolRegexp(t)
	withMockQueries(t, mock)

	ctx := context.Background()
	queries := LazyFilesQueries{}
	dbErr := errors.New("db failed")

	mock.ExpectQuery("GetUserStorageQuota").WithArgs(int32(42)).WillReturnError(dbErr)
	_, err := queries.GetUserStorageQuota(ctx, 42)
	require.ErrorIs(t, err, dbErr)

	mock.ExpectQuery("INSERT INTO developer_file_upload_reservations").
		WithArgs("", int32(0), "", int64(0), pgxmock.AnyArg()).
		WillReturnError(dbErr)
	_, err = queries.CreateDeveloperFileUploadReservation(ctx, developerfiles.CreateDeveloperFileUploadReservationInput{})
	require.ErrorIs(t, err, dbErr)

	mock.ExpectQuery("UPDATE developer_file_upload_reservations").
		WithArgs("", int32(0), "").
		WillReturnError(dbErr)
	_, err = queries.ConsumeDeveloperFileUploadReservation(ctx, developerfiles.DeveloperFileUploadReservationLookupInput{})
	require.ErrorIs(t, err, dbErr)

	mock.ExpectQuery("DELETE FROM developer_file_upload_reservations").WithArgs(int32(42)).WillReturnError(dbErr)
	_, err = queries.ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx, 42)
	require.ErrorIs(t, err, dbErr)

	mock.ExpectQuery("WITH categorized_files").WithArgs(int32(42)).WillReturnError(dbErr)
	_, err = queries.GetDeveloperFileStorageStatsByUser(ctx, 42)
	require.ErrorIs(t, err, dbErr)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyFilesQueriesMarkDeveloperFileDeletedError(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withMockQueries(t, mock)

	dbErr := errors.New("delete failed")
	mock.ExpectQuery("MarkDeveloperFileDeleted").WithArgs("file-1", int32(42)).WillReturnError(dbErr)
	_, err := (LazyFilesQueries{}).MarkDeveloperFileDeleted(context.Background(), developerfiles.DeveloperFileLookupInput{ID: "file-1", UserID: 42})
	require.ErrorIs(t, err, dbErr)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyFilesQueriesReturnLoaderErrors(t *testing.T) {
	withQueryLoaderError(t)
	queries := LazyFilesQueries{}
	ctx := context.Background()

	require.EqualError(t, queries.EnsureUserStorageQuota(ctx, 1), "loader failed")
	require.EqualError(t, queries.ReserveUserStorageBytes(ctx, developerfiles.StorageQuotaUpdateInput{}), "loader failed")
	require.EqualError(t, queries.ReleaseUserStorageBytes(ctx, developerfiles.StorageQuotaUpdateInput{}), "loader failed")
	require.EqualError(t, queries.RestoreDeveloperFileDeletion(ctx, developerfiles.DeveloperFileLookupInput{}), "loader failed")

	_, err := queries.GetUserStorageQuota(ctx, 1)
	require.EqualError(t, err, "loader failed")

	_, err = queries.CreateDeveloperFile(ctx, developerfiles.CreateDeveloperFileInput{})
	require.EqualError(t, err, "loader failed")

	_, err = queries.CreateDeveloperFileUploadReservation(ctx, developerfiles.CreateDeveloperFileUploadReservationInput{})
	require.EqualError(t, err, "loader failed")

	_, err = queries.ConsumeDeveloperFileUploadReservation(ctx, developerfiles.DeveloperFileUploadReservationLookupInput{})
	require.EqualError(t, err, "loader failed")

	_, err = queries.ReleaseExpiredDeveloperFileUploadReservationsForUser(ctx, 1)
	require.EqualError(t, err, "loader failed")

	_, err = queries.GetDeveloperFileByIDForUser(ctx, developerfiles.DeveloperFileLookupInput{})
	require.EqualError(t, err, "loader failed")

	_, err = queries.ListDeveloperFilesByUser(ctx, developerfiles.ListDeveloperFilesInput{})
	require.EqualError(t, err, "loader failed")

	_, err = queries.CountDeveloperFilesByUser(ctx, 1)
	require.EqualError(t, err, "loader failed")

	_, err = queries.GetDeveloperFileStorageStatsByUser(ctx, 1)
	require.EqualError(t, err, "loader failed")

	_, err = queries.MarkDeveloperFileDeleted(ctx, developerfiles.DeveloperFileLookupInput{})
	assert.EqualError(t, err, "loader failed")
}

func TestLazyRunQueriesDatabaseErrors(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	withMockQueries(t, mock)

	ctx := context.Background()
	queries := LazyRunQueries{}
	dbErr := errors.New("db read failed")

	mock.ExpectQuery("GetOrganizationByID").WithArgs(int32(1)).WillReturnError(dbErr)
	_, err := queries.GetOrganizationByID(ctx, 1)
	require.ErrorIs(t, err, dbErr)

	mock.ExpectQuery("GetMembership").WithArgs(int32(1), int32(2)).WillReturnError(dbErr)
	_, err = queries.GetMembership(ctx, runhandlers.MembershipLookupInput{OrganizationID: 1, UserID: 2})
	require.ErrorIs(t, err, dbErr)

	mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnError(dbErr)
	_, err = queries.GetExecutionTrace(ctx, "task-1")
	require.ErrorIs(t, err, dbErr)

	mock.ExpectQuery("GetAgent").WithArgs("agent-1").WillReturnError(dbErr)
	_, err = queries.GetAgent(ctx, "agent-1")
	require.ErrorIs(t, err, dbErr)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyRunQueriesMapRows(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	originalGetQueries := GetQueries
	GetQueries = func(context.Context) (*db.Queries, error) {
		return db.New(mock), nil
	}
	t.Cleanup(func() { GetQueries = originalGetQueries })

	ctx := context.Background()
	now := pgtype.Timestamp{Time: time.Unix(100, 0), Valid: true}
	queries := LazyRunQueries{}

	mock.ExpectQuery("GetOrganizationByID").WithArgs(int32(7)).WillReturnRows(
		pgxmock.NewRows([]string{"id", "name", "slug", "domain", "created_at", "updated_at", "plan", "subscription_id", "subscription_status", "customer_id", "workos_organization_id", "no_training", "settings"}).
			AddRow(int32(7), "Org", "org", nil, now, now, "free", nil, nil, nil, nil, true, []byte("{}")),
	)
	org, err := queries.GetOrganizationByID(ctx, 7)
	require.NoError(t, err)
	assert.Equal(t, runhandlers.OrganizationRow{ID: 7, NoTraining: true}, org)

	mock.ExpectQuery("GetMembership").WithArgs(int32(7), int32(42)).WillReturnRows(
		pgxmock.NewRows([]string{"id", "organization_id", "user_id", "role", "created_at", "updated_at"}).
			AddRow(int32(1), int32(7), int32(42), db.OrganizationRoleMEMBER, now, now),
	)
	membership, err := queries.GetMembership(ctx, runhandlers.MembershipLookupInput{OrganizationID: 7, UserID: 42})
	require.NoError(t, err)
	assert.Equal(t, runhandlers.MembershipRow{OrganizationID: 7, UserID: 42}, membership)

	traceUserID := int32(42)
	mock.ExpectQuery("GetExecutionTrace").WithArgs("task-1").WillReturnRows(
		pgxmock.NewRows([]string{"id", "task_id", "user_id", "goal", "plan", "steps", "self_eval", "report", "artifacts", "created_at"}).
			AddRow("trace-1", "task-1", &traceUserID, "goal", []byte(`{"plan":true}`), []byte(`[]`), []byte(`{}`), []byte(`{}`), []byte(`[]`), now),
	)
	trace, err := queries.GetExecutionTrace(ctx, "task-1")
	require.NoError(t, err)
	assert.Equal(t, "trace-1", trace.ID)
	assert.Equal(t, &traceUserID, trace.UserID)
	assert.Equal(t, []byte(`{"plan":true}`), trace.Plan)

	modelID := "openai/gpt-5.6-sol"
	mock.ExpectQuery("GetAgent").WithArgs("agent-1").WillReturnRows(
		pgxmock.NewRows([]string{"id", "user_id", "name", "description", "avatar", "model_id", "autonomy_enabled", "timezone", "active_start", "active_end", "active_days", "check_interval", "last_run_at", "next_run_at", "status", "created_at", "updated_at"}).
			AddRow("agent-1", int32(42), "Agent", nil, nil, &modelID, false, "UTC", "09:00", "17:00", []int32{1, 2}, int32(60), now, now, "IDLE", now, now),
	)
	agent, err := queries.GetAgent(ctx, "agent-1")
	require.NoError(t, err)
	assert.Equal(t, runhandlers.AgentRow{ID: "agent-1", UserID: 42}, agent)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLazyRunQueriesReturnLoaderErrors(t *testing.T) {
	withQueryLoaderError(t)
	queries := LazyRunQueries{}
	ctx := context.Background()

	_, err := queries.GetOrganizationByID(ctx, 1)
	require.EqualError(t, err, "loader failed")

	_, err = queries.GetMembership(ctx, runhandlers.MembershipLookupInput{})
	require.EqualError(t, err, "loader failed")

	_, err = queries.GetExecutionTrace(ctx, "task-1")
	require.EqualError(t, err, "loader failed")

	_, err = queries.GetAgent(ctx, "agent-1")
	assert.EqualError(t, err, "loader failed")
}

func TestServiceConstructorsReturnServices(t *testing.T) {
	q := db.New(nil)
	assert.NotNil(t, NewConversationServiceFromQueries(q))
	assert.NotNil(t, NewIntegrationsServiceFromQueries(q))
}
