package sync

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newMockRepo(t *testing.T) (pgxmock.PgxPoolIface, *Repository) {
	t.Helper()
	mock, err := pgxmock.NewPool(pgxmock.QueryMatcherOption(pgxmock.QueryMatcherRegexp))
	require.NoError(t, err)
	queries := db.New(mock)
	return mock, NewRepository(queries)
}

func TestRepository_GetLatestOrgSyncVersion(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	orgID := int32(5)
	mock.ExpectQuery("SELECT GREATEST").WithArgs(&orgID).WillReturnRows(pgxmock.NewRows([]string{"latest_version"}).AddRow(int32(7)))

	version, err := repo.GetLatestOrgSyncVersion(context.Background(), orgID)
	require.NoError(t, err)
	assert.Equal(t, int32(7), version)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetConversationsByOrgAfterVersion(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	orgID := int32(2)
	mock.ExpectQuery("SELECT (.+) FROM conversations WHERE").WithArgs(&orgID, int32(10), int32(50)).WillReturnRows(
		dbtest.ConversationRow(dbtest.Conversation{ID: 1, OrganizationID: &orgID, SyncVersion: 15}),
	)

	rows, err := repo.GetConversationsByOrgAfterVersion(context.Background(), orgID, 10, 50)
	require.NoError(t, err)
	assert.Len(t, rows, 1)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetMessagesByOrgAfterVersion(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	orgID := int32(2)
	mock.ExpectQuery(`(?s)SELECT.*FROM messages(?:\s+AS)?\s+m`).WithArgs(&orgID, int32(0), int32(25)).WillReturnRows(
		afterVersionMessageRow(dbtest.Message{ID: 1, SyncVersion: 10}),
	)

	rows, err := repo.GetMessagesByOrgAfterVersion(context.Background(), orgID, 0, 25)
	require.NoError(t, err)
	assert.Len(t, rows, 1)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetConversationVersionWithOrg(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	orgID := int32(3)
	userID := "user"
	mock.ExpectQuery("SELECT id, sync_version, vector_clock FROM conversations").WithArgs(int32(1), &orgID, &userID).WillReturnRows(
		pgxmock.NewRows([]string{"id", "sync_version", "vector_clock"}).AddRow(int32(1), int32(2), []byte("{}")),
	)

	row, err := repo.GetConversationVersionWithOrg(context.Background(), 1, &userID, orgID)
	require.NoError(t, err)
	assert.Equal(t, int32(1), row.ID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetConversationAndWithOrg(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	mock.ExpectQuery("SELECT (.+) FROM conversations WHERE id =").WithArgs(int32(1)).WillReturnRows(
		dbtest.ConversationRow(dbtest.Conversation{ID: 1, SyncVersion: 1}),
	)
	mock.ExpectQuery("SELECT (.+) FROM conversations WHERE id =").WithArgs(int32(2), pgxmock.AnyArg()).WillReturnRows(
		dbtest.ConversationRow(dbtest.Conversation{ID: 2, SyncVersion: 1}),
	)

	_, err := repo.GetConversation(context.Background(), 1)
	require.NoError(t, err)
	_, err = repo.GetConversationWithOrg(context.Background(), 2, 5)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_CreateConversationSync(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	mock.ExpectQuery("INSERT INTO conversations").WithArgs(
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		pgxmock.AnyArg(), pgxmock.AnyArg(),
	).WillReturnRows(dbtest.ConversationRow(dbtest.Conversation{ID: 1, SyncVersion: 1}))

	_, err := repo.CreateConversationSync(context.Background(), CreateConversationInput{UserInput: "input", AgentCount: 1})
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_MessageOps(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	syncMsg := dbtest.Message{ID: 1, SyncVersion: 10}
	mock.ExpectQuery("SELECT (.+) FROM messages WHERE message_id =").WithArgs("msg-1").WillReturnRows(
		dbtest.MessageRow(syncMsg),
	)
	mock.ExpectExec("UPDATE messages SET").WithArgs(
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		pgxmock.AnyArg(),
	).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectQuery("INSERT INTO messages").WithArgs(
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
	).WillReturnRows(dbtest.MessageRow(syncMsg))

	_, err := repo.GetMessageByMessageID(context.Background(), "msg-1")
	assert.NoError(t, err)
	assert.NoError(t, repo.UpdateMessageSync(context.Background(), UpdateMessageInput{MessageID: "msg-1"}))
	_, err = repo.CreateMessageSync(context.Background(), CreateMessageInput{MessageID: "msg-1", ConversationID: 1, Role: "user", Content: "hello"})
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_AdvanceSyncVersionSequence(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	mock.ExpectExec("SELECT setval").WithArgs(int32(42)).WillReturnResult(pgxmock.NewResult("SELECT", 1))

	err := repo.AdvanceSyncVersionSequence(context.Background(), 42)

	require.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_NextSyncVersion(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	mock.ExpectQuery("SELECT nextval").WillReturnRows(pgxmock.NewRows([]string{"nextval"}).AddRow(int32(43)))

	version, err := repo.NextSyncVersion(context.Background(), 42)

	require.NoError(t, err)
	assert.Equal(t, int32(43), version)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_NextSyncVersionRejectsNonAdvancingAllocation(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	mock.ExpectQuery("SELECT nextval").WillReturnRows(pgxmock.NewRows([]string{"nextval"}).AddRow(int32(42)))

	_, err := repo.NextSyncVersion(context.Background(), 42)

	require.ErrorContains(t, err, "does not advance")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_CreateSyncAuditLog(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	columns := []string{"id", "timestamp", "user_id", "device_id", "action", "version_start", "version_end", "items_count", "conflicts_count", "duration_ms", "success", "error_message", "details"}
	mock.ExpectQuery("INSERT INTO sync_audit_logs").WithArgs(
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
	).WillReturnRows(pgxmock.NewRows(columns).AddRow(1, pgtype.Timestamp{Time: time.Now(), Valid: true}, "user", "device", "PULL", int32(0), int32(0), int32(0), int32(0), int32(1), true, nil, []byte("{}")))

	_, err := repo.CreateSyncAuditLog(context.Background(), SyncAuditInput{UserID: "user", Action: "PULL"})
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_Counts(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	userID := "user"
	orgID := int32(3)
	mock.ExpectQuery(`(?s).*GetConversationsCount.*`).WithArgs(&userID).WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery(`(?s).*GetMessagesCount.*`).WithArgs(&userID).WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(2)))
	mock.ExpectQuery(`(?s).*CountConversationsByOrg.*`).WithArgs(&orgID).WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(3)))
	mock.ExpectQuery(`(?s).*CountMessagesByOrg.*`).WithArgs(&orgID).WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(4)))

	_, err := repo.GetConversationsCount(context.Background(), userID)
	require.NoError(t, err)
	_, err = repo.GetMessagesCount(context.Background(), userID)
	require.NoError(t, err)
	_, err = repo.CountConversationsByOrg(context.Background(), orgID)
	require.NoError(t, err)
	_, err = repo.CountMessagesByOrg(context.Background(), orgID)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetSyncCounts(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	userID := "user"
	orgID := int32(3)
	mock.ExpectQuery("GetOrgSyncCounts").WithArgs(&orgID).WillReturnRows(
		pgxmock.NewRows([]string{"conversation_count", "message_count"}).AddRow(int64(3), int64(4)),
	)
	mock.ExpectQuery("GetUserSyncCounts").WithArgs(&userID).WillReturnRows(
		pgxmock.NewRows([]string{"conversation_count", "message_count"}).AddRow(int64(1), int64(2)),
	)

	convs, messages, err := repo.GetSyncCounts(context.Background(), userID, &orgID)
	require.NoError(t, err)
	assert.Equal(t, int64(3), convs)
	assert.Equal(t, int64(4), messages)

	convs, messages, err = repo.GetSyncCounts(context.Background(), userID, nil)
	require.NoError(t, err)
	assert.Equal(t, int64(1), convs)
	assert.Equal(t, int64(2), messages)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_GetSyncCountsErrors(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	userID := "user"
	orgID := int32(3)
	mock.ExpectQuery("GetOrgSyncCounts").WithArgs(&orgID).WillReturnError(errors.New("org counts failed"))
	mock.ExpectQuery("GetUserSyncCounts").WithArgs(&userID).WillReturnError(errors.New("user counts failed"))

	_, _, err := repo.GetSyncCounts(context.Background(), userID, &orgID)
	require.ErrorContains(t, err, "org counts failed")

	_, _, err = repo.GetSyncCounts(context.Background(), userID, nil)
	require.ErrorContains(t, err, "user counts failed")
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_DeviceOps(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	now := time.Now()
	columns := []string{"id", "user_id", "device_id", "device_name", "user_agent", "last_seen_at", "created_at", "is_revoked"}
	mock.ExpectQuery(`(?s)INSERT INTO sync_devices`).WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnRows(
		pgxmock.NewRows(columns).AddRow(int32(1), "user", "dev", nil, nil, pgtype.Timestamp{Time: now, Valid: true}, pgtype.Timestamp{Time: now, Valid: true}, false),
	)
	mock.ExpectQuery("SELECT (.+) FROM sync_devices").WithArgs("user").WillReturnRows(
		pgxmock.NewRows(columns).AddRow(int32(1), "user", "dev", nil, nil, pgtype.Timestamp{Time: now, Valid: true}, pgtype.Timestamp{Time: now, Valid: true}, false),
	)
	mock.ExpectExec("UPDATE sync_devices SET is_revoked").WithArgs("user", "dev").WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	_, err := repo.UpsertSyncDevice(context.Background(), UpsertSyncDeviceInput{UserID: "user", DeviceID: "dev"})
	require.NoError(t, err)
	_, err = repo.GetSyncDevices(context.Background(), "user")
	assert.NoError(t, err)
	assert.NoError(t, repo.RevokeSyncDevice(context.Background(), "user", "dev"))
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_IsSyncDeviceRevoked(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	mock.ExpectQuery("IsSyncDeviceRevoked").
		WithArgs("user", "dev").
		WillReturnRows(pgxmock.NewRows([]string{"is_revoked"}).AddRow(true))

	revoked, err := repo.IsSyncDeviceRevoked(context.Background(), "user", "dev")

	require.NoError(t, err)
	assert.True(t, revoked)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_ScopedMessageOps(t *testing.T) {
	mock, repo := newMockRepo(t)
	defer mock.Close()

	userID := "user"
	orgID := int32(3)
	msgID := "msg-1"
	mock.ExpectQuery("GetMessageVersionScoped").WithArgs(msgID, &orgID, &userID).WillReturnRows(
		pgxmock.NewRows([]string{"message_id", "sync_version", "vector_clock"}).AddRow(msgID, int32(1), []byte("{}")),
	)

	mock.ExpectQuery("GetMessageByMessageIDScoped").WithArgs(msgID, &orgID, &userID).WillReturnRows(
		dbtest.MessageRow(dbtest.Message{ID: 1, MessageID: msgID, SyncVersion: 1}),
	)

	_, err := repo.GetMessageVersionScoped(context.Background(), msgID, userID, &orgID)
	require.NoError(t, err)
	_, err = repo.GetMessageByMessageIDScoped(context.Background(), msgID, userID, &orgID)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRepository_WithTransaction(t *testing.T) {
	t.Run("commit", func(t *testing.T) {
		mock, repo := newMockRepo(t)
		defer mock.Close()
		repo.beginTx = mock.Begin
		mock.ExpectBegin()
		mock.ExpectCommit()

		err := repo.WithTransaction(context.Background(), func(txRepo SyncRepository) error {
			assert.NotNil(t, txRepo)
			return nil
		})
		assert.NoError(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("callback error rolls back", func(t *testing.T) {
		mock, repo := newMockRepo(t)
		defer mock.Close()
		repo.beginTx = mock.Begin
		mock.ExpectBegin()
		mock.ExpectRollback()

		err := repo.WithTransaction(context.Background(), func(txRepo SyncRepository) error {
			return errors.New("callback failed")
		})
		require.ErrorContains(t, err, "callback failed")
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("commit error rolls back", func(t *testing.T) {
		mock, repo := newMockRepo(t)
		defer mock.Close()
		repo.beginTx = mock.Begin
		mock.ExpectBegin()
		mock.ExpectCommit().WillReturnError(errors.New("commit failed"))
		mock.ExpectRollback()

		err := repo.WithTransaction(context.Background(), func(txRepo SyncRepository) error {
			return nil
		})
		require.ErrorContains(t, err, "commit failed")
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("begin error", func(t *testing.T) {
		_, repo := newMockRepo(t)
		repo.beginTx = func(context.Context) (pgx.Tx, error) {
			return nil, errors.New("begin failed")
		}

		err := repo.WithTransaction(context.Background(), func(txRepo SyncRepository) error {
			return nil
		})
		assert.ErrorContains(t, err, "begin failed")
	})

	t.Run("default begin uses pool provider", func(t *testing.T) {
		mock, repo := newMockRepo(t)
		defer mock.Close()
		originalGetPool := getRepositoryPool
		getRepositoryPool = func(context.Context) (repositoryTxPool, error) {
			return mock, nil
		}
		t.Cleanup(func() { getRepositoryPool = originalGetPool })

		mock.ExpectBegin()
		mock.ExpectCommit()

		err := repo.WithTransaction(context.Background(), func(txRepo SyncRepository) error {
			return nil
		})
		require.NoError(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})
}

func TestRepository_Mappers(t *testing.T) {
	// Test ratingFromInterface
	assert.Equal(t, int32(5), ratingFromInterface(int32(5)))
	assert.Equal(t, int32(10), ratingFromInterface(int64(10)))
	assert.Equal(t, int32(15), ratingFromInterface(15))
	assert.Equal(t, int32(20), ratingFromInterface(float64(20)))
	assert.Equal(t, int32(0), ratingFromInterface(math.NaN()))
	assert.Equal(t, int32(25), ratingFromInterface("25"))
	assert.Equal(t, int32(30), ratingFromInterface([]byte("30")))
	assert.Equal(t, int32(0), ratingFromInterface("not-a-number"))
	assert.Equal(t, int32(0), ratingFromInterface(nil))
	// Edge cases
	assert.Equal(t, int32(0), ratingFromInterface(int64(math.MaxInt64)))
	assert.Equal(t, int32(0), ratingFromInterface(float64(math.MaxFloat64)))
	assert.Equal(t, int32(0), ratingFromInterface(int(math.MaxInt64)))

	// Test traceFromInterface
	assert.Nil(t, traceFromInterface(nil))
	assert.Equal(t, []byte("trace"), traceFromInterface([]byte("trace")))
	assert.Equal(t, []byte("trace-str"), traceFromInterface("trace-str"))
	assert.NotNil(t, traceFromInterface(map[string]string{"a": "b"}))
	// Unmarshalable - hard to trigger without custom type that fails marshal
}

func TestRepository_MessageMappers(t *testing.T) {
	now := time.Now()
	row := db.CreateMessageSyncRow{
		ID:             1,
		MessageID:      "m1",
		ConversationID: 1,
		Role:           "user",
		Content:        "hi",
		CreatedAt:      pgtype.Timestamp{Time: now, Valid: true},
		UpdatedAt:      pgtype.Timestamp{Time: now, Valid: true},
		LastSyncedAt:   pgtype.Timestamp{Time: now, Valid: true},
		Rating:         int32(5),
	}
	m := mapMessageFromCreateSyncRow(row)
	assert.Equal(t, "m1", m.MessageID)
	assert.Equal(t, int32(5), m.Rating)

	row2 := db.GetMessageByMessageIDScopedRow{
		ID:             2,
		MessageID:      "m2",
		ConversationID: 1,
		Role:           "user",
		Content:        "hi",
		CreatedAt:      pgtype.Timestamp{Time: now, Valid: true},
		UpdatedAt:      pgtype.Timestamp{Time: now, Valid: true},
		LastSyncedAt:   pgtype.Timestamp{Time: now, Valid: true},
		Rating:         int32(4),
	}
	m2 := mapMessageFromScopedRow(row2)
	assert.Equal(t, "m2", m2.MessageID)
	assert.Equal(t, int32(4), m2.Rating)
}

func TestRepository_ErrorBranches(t *testing.T) {
	ctx := context.Background()

	t.Run("message list errors", func(t *testing.T) {
		mock, repo := newMockRepo(t)
		defer mock.Close()
		userID := "user"
		orgID := int32(7)
		mock.ExpectQuery(`(?s)SELECT.*FROM messages(?:\s+AS)?\s+m`).WithArgs(&userID, int32(1), int32(2)).WillReturnError(errors.New("messages failed"))
		_, err := repo.GetMessagesAfterVersion(ctx, userID, 1, 2)
		require.Error(t, err)
		mock.ExpectQuery(`(?s)SELECT.*FROM messages(?:\s+AS)?\s+m`).WithArgs(&orgID, int32(1), int32(2)).WillReturnError(errors.New("org messages failed"))
		_, err = repo.GetMessagesByOrgAfterVersion(ctx, orgID, 1, 2)
		require.Error(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("org version and scoped message errors", func(t *testing.T) {
		mock, repo := newMockRepo(t)
		defer mock.Close()
		userID := "user"
		orgID := int32(7)
		mock.ExpectQuery("SELECT id, sync_version, vector_clock FROM conversations").WithArgs(int32(1), &orgID, &userID).WillReturnError(errors.New("version failed"))
		_, err := repo.GetConversationVersionWithOrg(ctx, 1, &userID, orgID)
		require.Error(t, err)
		mock.ExpectQuery("GetMessageByMessageIDScoped").WithArgs("msg-1", &orgID, &userID).WillReturnError(errors.New("message failed"))
		_, err = repo.GetMessageByMessageIDScoped(ctx, "msg-1", userID, &orgID)
		require.Error(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("create message error", func(t *testing.T) {
		mock, repo := newMockRepo(t)
		defer mock.Close()
		mock.ExpectQuery("INSERT INTO messages").WithArgs(
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
		).WillReturnError(errors.New("insert failed"))
		_, err := repo.CreateMessageSync(ctx, CreateMessageInput{MessageID: "msg-1"})
		require.Error(t, err)
		assert.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("trace marshal error", func(t *testing.T) {
		assert.Nil(t, traceFromInterface(math.Inf(1)))
	})

	t.Run("default begin tx reports pool error", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "")
		repo := NewRepository(nil)
		assert.Nil(t, repo.q)
		_, err := repo.beginTx(ctx)
		assert.Error(t, err)
	})
}

func TestRepository_WithTransaction_Mock(t *testing.T) {
	mock, _ := newMockRepo(t)
	defer mock.Close()
}
