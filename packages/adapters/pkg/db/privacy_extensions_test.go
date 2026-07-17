package db

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCorePrivacyExtensions(t *testing.T) {
	mock := newRegexpTestMockPool(t)
	q := New(mock)
	ctx := context.Background()
	userID := "7"
	shareID := "share_1"
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(regexp.QuoteMeta(updateConversationSharingSnapshot)).
		WithArgs(int32(10), true, &shareID, &userID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "is_public", "share_id"}).AddRow(int32(10), true, &shareID))
	shared, err := q.UpdateConversationSharingSnapshot(ctx, UpdateConversationSharingSnapshotParams{
		ID: 10, IsPublic: true, ShareID: &shareID, UserID: &userID,
	})
	require.NoError(t, err)
	assert.Equal(t, int32(10), shared.ID)
	assert.Equal(t, shareID, *shared.ShareID)

	orgID := int32(4)
	mock.ExpectQuery(regexp.QuoteMeta(updateConversationSharingSnapshotWithOrg)).
		WithArgs(int32(10), false, (*string)(nil), &userID, &orgID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "is_public", "share_id"}).AddRow(int32(10), false, nil))
	shared, err = q.UpdateConversationSharingSnapshotWithOrg(ctx, UpdateConversationSharingSnapshotWithOrgParams{
		ID: 10, IsPublic: false, UserID: &userID, OrganizationID: &orgID,
	})
	require.NoError(t, err)
	assert.False(t, shared.IsPublic)

	mock.ExpectQuery(regexp.QuoteMeta(getPublicConversationSnapshotByShareID)).
		WithArgs(&shareID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "title", "is_public", "is_deleted", "snapshot_at"}).
			AddRow(int32(10), "Snapshot", true, false, now))
	snapshot, err := q.GetPublicConversationSnapshotByShareID(ctx, &shareID)
	require.NoError(t, err)
	assert.Equal(t, "Snapshot", snapshot.Title)
	assert.True(t, snapshot.SnapshotAt.Valid)

	mock.ExpectQuery(regexp.QuoteMeta(getPublicConversationSnapshotMessages)).
		WithArgs(int32(10)).
		WillReturnRows(pgxmock.NewRows([]string{"message_id", "role", "content", "is_agent_status", "created_at"}).
			AddRow("msg_1", "assistant", "frozen", false, now))
	messages, err := q.GetPublicConversationSnapshotMessages(ctx, 10)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	assert.Equal(t, "frozen", messages[0].Content)

	mock.ExpectQuery(regexp.QuoteMeta(getGDPRExport)).WithArgs(int32(7)).
		WillReturnRows(pgxmock.NewRows([]string{"jsonb_build_object"}).AddRow([]byte(`{"user":{"id":7},"conversations":[]}`)))
	export, err := q.GetGDPRExport(ctx, 7)
	require.NoError(t, err)
	assert.JSONEq(t, `{"user":{"id":7},"conversations":[]}`, string(export))

	mock.ExpectExec(regexp.QuoteMeta(deleteGDPRUserData)).WithArgs(int32(7)).WillReturnResult(pgxmock.NewResult("DELETE", 1))
	require.NoError(t, q.DeleteGDPRUserData(ctx, 7))

	plan := "pro"
	isAdmin := true
	mock.ExpectExec(regexp.QuoteMeta(updateAdminUserFields)).WithArgs((*int32)(nil), "user@example.com", &plan, &isAdmin).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	require.NoError(t, q.UpdateAdminUserFields(ctx, UpdateAdminUserFieldsParams{
		Email: "user@example.com", Plan: &plan, IsAdmin: &isAdmin,
	}))

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestUpdateAdminUserFieldsNotFound(t *testing.T) {
	mock := newRegexpTestMockPool(t)
	q := New(mock)
	mock.ExpectExec(regexp.QuoteMeta(updateAdminUserFields)).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	err := q.UpdateAdminUserFields(context.Background(), UpdateAdminUserFieldsParams{UserID: new(int32)})
	require.ErrorIs(t, err, pgx.ErrNoRows)
}

func TestCorePrivacyExtensionErrors(t *testing.T) {
	mock := newRegexpTestMockPool(t)
	q := New(mock)
	mock.ExpectExec(regexp.QuoteMeta(updateAdminUserFields)).
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(assert.AnError)
	require.ErrorIs(t, q.UpdateAdminUserFields(context.Background(), UpdateAdminUserFieldsParams{}), assert.AnError)

	mock.ExpectQuery(regexp.QuoteMeta(getPublicConversationSnapshotMessages)).WithArgs(int32(1)).WillReturnError(assert.AnError)
	_, err := q.GetPublicConversationSnapshotMessages(context.Background(), 1)
	require.ErrorIs(t, err, assert.AnError)

	mock.ExpectQuery(regexp.QuoteMeta(getPublicConversationSnapshotMessages)).WithArgs(int32(2)).WillReturnRows(
		pgxmock.NewRows([]string{"message_id", "role", "content", "is_agent_status"}).AddRow("msg", "assistant", "content", false),
	)
	_, err = q.GetPublicConversationSnapshotMessages(context.Background(), 2)
	require.Error(t, err)
}

func TestPrivacyExtensionsIntegration(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not configured")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, databaseURL)
	require.NoError(t, err)
	t.Cleanup(func() { _ = conn.Close(ctx) })
	tx, err := conn.Begin(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	q := New(tx)

	var userID int32
	err = tx.QueryRow(ctx, `INSERT INTO users (email) VALUES ($1) RETURNING id`, "gdpr-integration@example.com").Scan(&userID)
	require.NoError(t, err)
	userIDText := strconv.FormatInt(int64(userID), 10)

	var conversationID int32
	err = tx.QueryRow(ctx, `INSERT INTO conversations (user_id, user_input) VALUES ($1, $2) RETURNING id`, userIDText, "Original title").Scan(&conversationID)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO messages (message_id, conversation_id, role, content) VALUES ($1, $2, $3, $4)`, "msg_snapshot", conversationID, "assistant", "Original content")
	require.NoError(t, err)

	shareID := "integration_share"
	_, err = q.UpdateConversationSharingSnapshot(ctx, UpdateConversationSharingSnapshotParams{
		ID: conversationID, IsPublic: true, ShareID: &shareID, UserID: &userIDText,
	})
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `UPDATE conversations SET user_input = 'Private edit' WHERE id = $1`, conversationID)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `UPDATE messages SET content = 'Private edit' WHERE conversation_id = $1`, conversationID)
	require.NoError(t, err)

	snapshot, err := q.GetPublicConversationSnapshotByShareID(ctx, &shareID)
	require.NoError(t, err)
	assert.Equal(t, "Original title", snapshot.Title)
	messages, err := q.GetPublicConversationSnapshotMessages(ctx, conversationID)
	require.NoError(t, err)
	require.Len(t, messages, 1)
	assert.Equal(t, "Original content", messages[0].Content)

	var organizationID int32
	err = tx.QueryRow(ctx, `INSERT INTO organizations (name, slug, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id`, "GDPR integration", "gdpr-integration").Scan(&organizationID)
	require.NoError(t, err)
	var organizationConversationID int32
	err = tx.QueryRow(ctx, `INSERT INTO conversations (user_id, organization_id, user_input) VALUES ($1, $2, $3) RETURNING id`, userIDText, organizationID, "Organization title").Scan(&organizationConversationID)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `INSERT INTO messages (message_id, conversation_id, role, content) VALUES ($1, $2, $3, $4)`, "msg_org_snapshot", organizationConversationID, "assistant", "Organization content")
	require.NoError(t, err)
	organizationShareID := "integration_org_share"
	_, err = q.UpdateConversationSharingSnapshotWithOrg(ctx, UpdateConversationSharingSnapshotWithOrgParams{
		ID: organizationConversationID, IsPublic: true, ShareID: &organizationShareID, UserID: &userIDText, OrganizationID: &organizationID,
	})
	require.NoError(t, err)

	exportPayload, err := q.GetGDPRExport(ctx, userID)
	require.NoError(t, err)
	var export map[string]any
	require.NoError(t, json.Unmarshal(exportPayload, &export))
	assert.Contains(t, export, "conversations")
	assert.Contains(t, export, "projects")
	assert.Contains(t, export, "finances")

	require.NoError(t, q.DeleteGDPRUserData(ctx, userID))
	var userCount, conversationCount, organizationConversationCount, organizationSnapshotCount int
	require.NoError(t, tx.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE id = $1`, userID).Scan(&userCount))
	require.NoError(t, tx.QueryRow(ctx, `SELECT COUNT(*) FROM conversations WHERE id = $1`, conversationID).Scan(&conversationCount))
	require.NoError(t, tx.QueryRow(ctx, `SELECT COUNT(*) FROM conversations WHERE id = $1`, organizationConversationID).Scan(&organizationConversationCount))
	require.NoError(t, tx.QueryRow(ctx, `SELECT COUNT(*) FROM public_conversation_snapshots WHERE conversation_id = $1`, organizationConversationID).Scan(&organizationSnapshotCount))
	assert.Zero(t, userCount)
	assert.Zero(t, conversationCount)
	assert.Equal(t, 1, organizationConversationCount)
	assert.Zero(t, organizationSnapshotCount)

	var organizationTitle string
	var ownerCleared, isPublic, shareIDCleared, publicSharedAtCleared bool
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT user_input, user_id IS NULL, is_public, share_id IS NULL, public_shared_at IS NULL
		FROM conversations
		WHERE id = $1
	`, organizationConversationID).Scan(&organizationTitle, &ownerCleared, &isPublic, &shareIDCleared, &publicSharedAtCleared))
	assert.Equal(t, "Organization title", organizationTitle)
	assert.True(t, ownerCleared)
	assert.False(t, isPublic)
	assert.True(t, shareIDCleared)
	assert.True(t, publicSharedAtCleared)

	_, err = q.GetPublicConversationSnapshotByShareID(ctx, &organizationShareID)
	require.ErrorIs(t, err, pgx.ErrNoRows)
}
