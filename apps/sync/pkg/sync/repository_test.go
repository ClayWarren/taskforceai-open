package sync

import (
	"context"
	"errors"
	"testing"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type repositoryErrorDB struct{ err error }

func (d repositoryErrorDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, d.err
}

func (d repositoryErrorDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, d.err
}

func (d repositoryErrorDB) QueryRow(context.Context, string, ...any) pgx.Row {
	return repositoryErrorRow(d)
}

type repositoryErrorRow struct{ err error }

func (r repositoryErrorRow) Scan(...any) error { return r.err }

func TestRepositoryPropagatesQueryErrors(t *testing.T) {
	dbErr := errors.New("database unavailable")
	repo := NewRepository(db.New(repositoryErrorDB{err: dbErr}))
	ctx := context.Background()
	userID := "user-1"
	orgID := int32(7)

	_, err := repo.GetConversationsAfterVersion(ctx, userID, 0, 10)
	require.Error(t, err)
	_, err = repo.GetConversationsByOrgAfterVersion(ctx, orgID, 0, 10)
	require.Error(t, err)
	_, err = repo.GetConversationVersion(ctx, 1, &userID)
	require.Error(t, err)
	_, err = repo.GetConversationVersionWithOrg(ctx, 1, &userID, orgID)
	require.Error(t, err)
	_, err = repo.GetConversation(ctx, 1)
	require.Error(t, err)
	_, err = repo.GetConversationWithOrg(ctx, 1, orgID)
	require.Error(t, err)
	_, err = repo.CreateConversationSync(ctx, CreateConversationInput{})
	require.Error(t, err)
	_, err = repo.GetMessageVersion(ctx, "message-1")
	require.Error(t, err)
	_, err = repo.GetMessageVersionScoped(ctx, "message-1", userID, &orgID)
	require.Error(t, err)
	_, err = repo.GetMessageByMessageID(ctx, "message-1")
	require.Error(t, err)
	_, err = repo.GetMessageByMessageIDScoped(ctx, "message-1", userID, &orgID)
	require.Error(t, err)
	_, err = repo.CreateMessageSync(ctx, CreateMessageInput{})
	require.Error(t, err)
	_, err = repo.NextSyncVersion(ctx, 1)
	require.Error(t, err)
	_, err = repo.CreateSyncAuditLog(ctx, SyncAuditInput{})
	require.Error(t, err)
	_, _, err = repo.GetSyncCounts(ctx, userID, &orgID)
	require.Error(t, err)
	_, _, err = repo.GetSyncCounts(ctx, userID, nil)
	require.Error(t, err)
	_, err = repo.UpsertSyncDevice(ctx, UpsertSyncDeviceInput{})
	require.Error(t, err)
	_, err = repo.GetSyncDevices(ctx, userID)
	require.Error(t, err)
}

func TestRepository_GetLatestSyncVersion(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewRepository(queries)

	userID := "user-123"

	mock.ExpectQuery("SELECT GREATEST").
		WithArgs(&userID).
		WillReturnRows(pgxmock.NewRows([]string{"latest_version"}).AddRow(int32(42)))

	version, err := repo.GetLatestSyncVersion(context.Background(), userID)

	require.NoError(t, err)
	assert.Equal(t, int32(42), version)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetConversationsAfterVersion(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewRepository(queries)

	userID := "user-123"

	mock.ExpectQuery("SELECT (.+) FROM conversations WHERE").
		WithArgs(&userID, int32(10), int32(50)).
		WillReturnRows(dbtest.ConversationRow(dbtest.Conversation{
			ID: 1, UserID: &userID, UserInput: "test input", AgentCount: 4, SyncVersion: 15,
		}))

	conversations, err := repo.GetConversationsAfterVersion(context.Background(), userID, 10, 50)

	require.NoError(t, err)
	if assert.Len(t, conversations, 1) {
		assert.Equal(t, int32(1), conversations[0].ID)
	}
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetMessagesAfterVersion(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewRepository(queries)

	userID := "user-123"

	mock.ExpectQuery(`(?s)SELECT.*FROM messages(?:\s+AS)?\s+m`).
		WithArgs(&userID, int32(5), int32(100)).
		WillReturnRows(afterVersionMessageRow(dbtest.Message{ID: 1, SyncVersion: 10}))

	messages, err := repo.GetMessagesAfterVersion(context.Background(), userID, 5, 100)

	require.NoError(t, err)
	if assert.Len(t, messages, 1) {
		assert.Equal(t, "msg-1", messages[0].MessageID)
	}
	assert.NoError(t, mock.ExpectationsWereMet())
}

func afterVersionMessageRow(message dbtest.Message) *pgxmock.Rows {
	columns := dbtest.MessageColumns()
	values := dbtest.MessageValues(message)
	return pgxmock.NewRows(columns[:len(columns)-1]).AddRow(values[:len(values)-1]...)
}

func TestRepository_GetConversationVersion(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewRepository(queries)

	userID := "user-123"

	mock.ExpectQuery("SELECT id, sync_version, vector_clock FROM conversations WHERE").
		WithArgs(int32(5), &userID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "sync_version", "vector_clock"}).
			AddRow(int32(5), int32(20), []byte("{}")))

	result, err := repo.GetConversationVersion(context.Background(), 5, &userID)

	require.NoError(t, err)
	assert.Equal(t, int32(5), result.ID)
	assert.Equal(t, int32(20), result.SyncVersion)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_UpdateConversationSync(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewRepository(queries)

	deviceID := "device-1"

	// Use AnyArg for flexibility - exact arg matching is brittle
	mock.ExpectExec("UPDATE conversations SET").
		WithArgs(
			pgxmock.AnyArg(), // id
			pgxmock.AnyArg(), // user_input
			pgxmock.AnyArg(), // organization_id
			pgxmock.AnyArg(), // result
			pgxmock.AnyArg(), // execution_time
			pgxmock.AnyArg(), // model
			pgxmock.AnyArg(), // agent_count
			pgxmock.AnyArg(), // sync_version
			pgxmock.AnyArg(), // device_id
			pgxmock.AnyArg(), // is_deleted
			pgxmock.AnyArg(), // vector_clock
			pgxmock.AnyArg(), // scope_organization_id
			pgxmock.AnyArg(), // user_id
		).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	userID := "user-1"
	err := repo.UpdateConversationSync(context.Background(), UpdateConversationInput{
		ID:          5,
		UserInput:   "updated input",
		AgentCount:  4,
		SyncVersion: 25,
		DeviceID:    &deviceID,
		IsDeleted:   false,
		UserID:      &userID,
	})

	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetMessageVersion(t *testing.T) {
	mock := dbtest.NewMockPool(t)

	queries := db.New(mock)
	repo := NewRepository(queries)

	mock.ExpectQuery("SELECT message_id, sync_version, vector_clock FROM messages WHERE").
		WithArgs("msg-123").
		WillReturnRows(pgxmock.NewRows([]string{"message_id", "sync_version", "vector_clock"}).
			AddRow("msg-123", int32(15), []byte("{}")))

	result, err := repo.GetMessageVersion(context.Background(), "msg-123")

	require.NoError(t, err)
	assert.Equal(t, "msg-123", result.MessageID)
	assert.Equal(t, int32(15), result.SyncVersion)
	assert.NoError(t, mock.ExpectationsWereMet())
}
