package conversations

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/db/dbtest"
	conversationspkg "github.com/TaskForceAI/core/pkg/conversations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStoreQueriesAndMappings(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	store := NewStore(db.New(mock))
	ctx := context.Background()
	userID := "user-1"
	orgID := int32(7)
	model := "gpt-5.6-sol"

	mock.ExpectQuery("CountConversationsByUser").WithArgs(&userID).WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(2)))
	count, err := store.CountConversationsByUser(ctx, &userID)
	require.NoError(t, err)
	assert.Equal(t, int64(2), count)

	mock.ExpectQuery("CountConversationsByUserAndOrg").WithArgs(&userID, &orgID).WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(1)))
	count, err = store.CountConversationsByUserAndOrg(ctx, conversationspkg.CountConversationsByUserAndOrgInput{UserID: &userID, OrganizationID: &orgID})
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)

	mock.ExpectQuery("GetConversationsByUser").WithArgs(&userID, int32(10), int32(0)).WillReturnRows(dbtest.ConversationRow(dbtest.EngineConversation()))
	rows, err := store.GetConversationsByUser(ctx, conversationspkg.GetConversationsByUserInput{UserID: &userID, Limit: 10})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, "prompt", rows[0].UserInput)
	assert.Equal(t, dbtest.EngineConversation().ProjectID, rows[0].ProjectID)

	mock.ExpectQuery("GetConversationsByUserAndOrg").WithArgs(&userID, &orgID, int32(5), int32(1)).WillReturnRows(dbtest.ConversationRow(dbtest.EngineConversation()))
	rows, err = store.GetConversationsByUserAndOrg(ctx, conversationspkg.GetConversationsByUserAndOrgInput{
		UserID: &userID, OrganizationID: &orgID, Limit: 5, Offset: 1,
	})
	require.NoError(t, err)
	require.Len(t, rows, 1)

	messageTime := pgtype.Timestamp{Time: time.Unix(200, 0), Valid: true}
	mock.ExpectQuery("GetMessagesByConversation").WithArgs(int32(1)).WillReturnRows(dbtest.MessageRow(dbtest.Message{
		ID: 1, Role: "assistant", Content: "content", SyncVersion: 1,
		CreatedAt: messageTime, LastSyncedAt: messageTime, UpdatedAt: messageTime,
		Trace: []byte(`{"ok":true}`),
	}))
	messages, err := store.GetMessagesByConversation(ctx, 1)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	assert.Equal(t, "assistant", messages[0].Role)
	assert.Equal(t, []byte(`{"ok":true}`), messages[0].Trace)

	mock.ExpectQuery("GetLatestAssistantMessagesWithMetadataByConversations").WithArgs([]int32{1, 2}).WillReturnRows(dbtest.MessageRow(dbtest.Message{
		ID: 2, Role: "assistant", Content: "latest", SyncVersion: 2,
		CreatedAt: messageTime, LastSyncedAt: messageTime, UpdatedAt: messageTime,
		Sources: []byte(`[{"url":"https://example.com"}]`),
	}))
	latest, err := store.GetLatestAssistantMessagesWithMetadataByConversations(ctx, []int32{1, 2})
	require.NoError(t, err)
	require.Len(t, latest, 1)
	assert.JSONEq(t, `[{"url":"https://example.com"}]`, string(latest[0].Sources))

	mock.ExpectQuery("GetConversationByUserAndID").WithArgs(int32(1), &userID).WillReturnRows(dbtest.ConversationRow(dbtest.EngineConversation()))
	conversation, err := store.GetConversationByUserAndID(ctx, conversationspkg.GetConversationByUserAndIDInput{ID: 1, UserID: &userID})
	require.NoError(t, err)
	assert.Equal(t, int32(1), conversation.ID)

	mock.ExpectQuery("GetConversationByUserOrgAndID").WithArgs(int32(1), &userID, &orgID).WillReturnRows(dbtest.ConversationRow(dbtest.EngineConversation()))
	conversation, err = store.GetConversationByUserOrgAndID(ctx, conversationspkg.GetConversationByUserOrgAndIDInput{ID: 1, UserID: &userID, OrganizationID: &orgID})
	require.NoError(t, err)
	assert.Equal(t, int32(1), conversation.ID)

	mock.ExpectQuery("CreateConversation").WithArgs(&userID, &orgID, "prompt", &model, int32(3), pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnRows(dbtest.ConversationRow(dbtest.EngineConversation()))
	conversation, err = store.CreateConversation(ctx, conversationspkg.CreateConversationStoreInput{
		UserID: &userID, OrganizationID: &orgID, UserInput: "prompt", Model: &model, AgentCount: 3,
	})
	require.NoError(t, err)
	assert.Equal(t, int32(1), conversation.ID)

	mock.ExpectExec("UpdateConversation").WithArgs(
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), int32(1), &userID,
	).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	require.NoError(t, store.UpdateConversation(ctx, conversationspkg.UpdateConversationStoreInput{ID: 1, UserID: &userID}))

	mock.ExpectExec("UpdateConversationWithOrg").WithArgs(
		pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), int32(1), &userID, &orgID,
	).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	require.NoError(t, store.UpdateConversationWithOrg(ctx, conversationspkg.UpdateConversationWithOrgInput{ID: 1, UserID: &userID, OrganizationID: &orgID}))

	mock.ExpectExec("SoftDeleteConversation").WithArgs(int32(1), &userID).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	require.NoError(t, store.SoftDeleteConversation(ctx, conversationspkg.SoftDeleteConversationInput{ID: 1, UserID: &userID}))

	mock.ExpectExec("SoftDeleteConversationWithOrg").WithArgs(int32(1), &userID, &orgID).WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	require.NoError(t, store.SoftDeleteConversationWithOrg(ctx, conversationspkg.SoftDeleteConversationWithOrgInput{ID: 1, UserID: &userID, OrganizationID: &orgID}))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestStoreErrors(t *testing.T) {
	mock := dbtest.NewMockPool(t)
	store := NewStore(db.New(mock))
	ctx := context.Background()
	userID := "user-1"
	orgID := int32(7)
	dbErr := errors.New("db failed")

	mock.ExpectQuery("GetConversationsByUser").WithArgs(&userID, int32(0), int32(0)).WillReturnError(dbErr)
	_, err := store.GetConversationsByUser(ctx, conversationspkg.GetConversationsByUserInput{UserID: &userID})
	require.ErrorIs(t, err, dbErr)
	mock.ExpectQuery("GetConversationsByUserAndOrg").WithArgs(&userID, &orgID, int32(0), int32(0)).WillReturnError(dbErr)
	_, err = store.GetConversationsByUserAndOrg(ctx, conversationspkg.GetConversationsByUserAndOrgInput{UserID: &userID, OrganizationID: &orgID})
	require.ErrorIs(t, err, dbErr)
	mock.ExpectQuery("GetMessagesByConversation").WithArgs(int32(1)).WillReturnError(dbErr)
	_, err = store.GetMessagesByConversation(ctx, 1)
	require.ErrorIs(t, err, dbErr)
	mock.ExpectQuery("GetLatestAssistantMessagesWithMetadataByConversations").WithArgs([]int32{1}).WillReturnError(dbErr)
	_, err = store.GetLatestAssistantMessagesWithMetadataByConversations(ctx, []int32{1})
	require.ErrorIs(t, err, dbErr)
	mock.ExpectQuery("GetConversationByUserAndID").WithArgs(int32(1), &userID).WillReturnError(pgx.ErrNoRows)
	_, err = store.GetConversationByUserAndID(ctx, conversationspkg.GetConversationByUserAndIDInput{ID: 1, UserID: &userID})
	require.ErrorIs(t, err, conversationspkg.ErrConversationRecordNotFound)
	mock.ExpectQuery("GetConversationByUserOrgAndID").WithArgs(int32(1), &userID, &orgID).WillReturnError(dbErr)
	_, err = store.GetConversationByUserOrgAndID(ctx, conversationspkg.GetConversationByUserOrgAndIDInput{ID: 1, UserID: &userID, OrganizationID: &orgID})
	require.ErrorIs(t, err, dbErr)
	mock.ExpectQuery("CreateConversation").WithArgs(&userID, pgxmock.AnyArg(), "", pgxmock.AnyArg(), int32(0), pgxmock.AnyArg(), pgxmock.AnyArg()).WillReturnError(dbErr)
	_, err = store.CreateConversation(ctx, conversationspkg.CreateConversationStoreInput{UserID: &userID})
	require.ErrorIs(t, err, dbErr)
	require.NoError(t, mock.ExpectationsWereMet())
}
