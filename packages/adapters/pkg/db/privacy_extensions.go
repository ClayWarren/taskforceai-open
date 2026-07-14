package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

const getGDPRExport = `-- name: GetGDPRExport :one
SELECT jsonb_build_object(
    'user', (
        SELECT to_jsonb(account) - 'mfa_totp_secret'
        FROM users AS account
        WHERE account.id = $1
    ),
    'memberships', COALESCE((
        SELECT jsonb_agg(to_jsonb(membership) ORDER BY membership.created_at)
        FROM memberships AS membership
        WHERE membership.user_id = $1
    ), '[]'::jsonb),
    'projects', COALESCE((
        SELECT jsonb_agg(to_jsonb(project) ORDER BY project.created_at)
        FROM projects AS project
        WHERE project.user_id = $1
    ), '[]'::jsonb),
    'memories', COALESCE((
        SELECT jsonb_agg(to_jsonb(memory) ORDER BY memory.created_at)
        FROM memories AS memory
        WHERE memory.user_id = $1
    ), '[]'::jsonb),
    'conversations', COALESCE((
        SELECT jsonb_agg(
            (to_jsonb(conversation) - 'vector_clock') || jsonb_build_object(
                'messages', COALESCE((
                    SELECT jsonb_agg(
                        to_jsonb(message) - ARRAY['vector_clock', 'trace']::text[]
                        ORDER BY message.created_at, message.id
                    )
                    FROM messages AS message
                    WHERE message.conversation_id = conversation.id
                ), '[]'::jsonb)
            ) ORDER BY conversation.timestamp, conversation.id
        )
        FROM conversations AS conversation
        WHERE conversation.user_id = $1::text
    ), '[]'::jsonb),
    'agents', COALESCE((
        SELECT jsonb_agg(to_jsonb(agent) ORDER BY agent.created_at)
        FROM agents AS agent
        WHERE agent.user_id = $1
    ), '[]'::jsonb),
    'artifacts', COALESCE((
        SELECT jsonb_agg(
            to_jsonb(artifact) || jsonb_build_object(
                'versions', COALESCE((
                    SELECT jsonb_agg(to_jsonb(version) ORDER BY version.version)
                    FROM artifact_versions AS version
                    WHERE version.artifact_id = artifact.id
                ), '[]'::jsonb)
            ) ORDER BY artifact.created_at
        )
        FROM artifacts AS artifact
        WHERE artifact.owner_user_id = $1
    ), '[]'::jsonb),
    'developerFiles', COALESCE((
        SELECT jsonb_agg(to_jsonb(file) ORDER BY file.created_at)
        FROM developer_files AS file
        WHERE file.user_id = $1
    ), '[]'::jsonb),
    'developerApiKeys', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', api_key.id,
            'displayKey', api_key.display_key,
            'name', api_key.name,
            'tier', api_key.tier,
            'rateLimit', api_key.rate_limit,
            'monthlyQuota', api_key.monthly_quota,
            'createdAt', api_key.created_at,
            'updatedAt', api_key.updated_at,
            'revokedAt', api_key.revoked_at,
            'lastUsedAt', api_key.last_used_at
        ) ORDER BY api_key.created_at)
        FROM developer_api_keys AS api_key
        WHERE api_key.user_id = $1
    ), '[]'::jsonb),
    'finances', COALESCE((
        SELECT jsonb_agg(
            (to_jsonb(connection) - 'encrypted_access_token') || jsonb_build_object(
                'accounts', COALESCE((
                    SELECT jsonb_agg(to_jsonb(financial_account) ORDER BY financial_account.created_at)
                    FROM financial_accounts AS financial_account
                    WHERE financial_account.connection_id = connection.id
                ), '[]'::jsonb),
                'transactions', COALESCE((
                    SELECT jsonb_agg(to_jsonb(transaction) ORDER BY transaction.date, transaction.id)
                    FROM financial_transactions AS transaction
                    WHERE transaction.connection_id = connection.id
                ), '[]'::jsonb),
                'recurringStreams', COALESCE((
                    SELECT jsonb_agg(to_jsonb(stream) ORDER BY stream.created_at)
                    FROM financial_recurring_streams AS stream
                    WHERE stream.connection_id = connection.id
                ), '[]'::jsonb)
            ) ORDER BY connection.created_at
        )
        FROM financial_connections AS connection
        WHERE connection.user_id = $1
    ), '[]'::jsonb),
    'tasks', COALESCE((
        SELECT jsonb_agg(to_jsonb(task) ORDER BY task.created_at)
        FROM tasks AS task
        WHERE task.user_id = $1::text
    ), '[]'::jsonb),
    'usageEvents', COALESCE((
        SELECT jsonb_agg(to_jsonb(usage_event) ORDER BY usage_event.created_at)
        FROM usage_events AS usage_event
        WHERE usage_event.user_id = $1::text
    ), '[]'::jsonb),
    'auditLogs', COALESCE((
        SELECT jsonb_agg(to_jsonb(audit_log) ORDER BY audit_log.timestamp)
        FROM audit_logs AS audit_log
        WHERE audit_log.user_id = $1::text
    ), '[]'::jsonb),
    'syncDevices', COALESCE((
        SELECT jsonb_agg(to_jsonb(sync_device) ORDER BY sync_device.created_at)
        FROM sync_devices AS sync_device
        WHERE sync_device.user_id = $1::text
    ), '[]'::jsonb)
)
`

// GetGDPRExport returns all user-visible product data as a single JSON object.
// Authentication, session, provider-token, and credential hashes are
// intentionally excluded from the portability payload.
func (q *Queries) GetGDPRExport(ctx context.Context, userID int32) ([]byte, error) {
	var payload []byte
	err := q.db.QueryRow(ctx, getGDPRExport, userID).Scan(&payload)
	return payload, err
}

const deleteGDPRUserData = `-- name: DeleteGDPRUserData :exec
WITH target AS (
    SELECT id, id::text AS text_id
    FROM users
    WHERE id = $1
), deleted_personal_conversations AS (
    DELETE FROM conversations AS conversation
    USING target
    WHERE conversation.user_id = target.text_id
      AND conversation.organization_id IS null
), anonymized_org_conversations AS (
    UPDATE conversations AS conversation
    SET user_id = null,
        is_public = false,
        share_id = null,
        public_shared_at = null,
        sync_version = NEXTVAL('sync_version_seq'),
        last_synced_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    FROM target
    WHERE conversation.user_id = target.text_id
      AND conversation.organization_id IS NOT null
    RETURNING conversation.id
), deleted_org_conversation_snapshots AS (
    DELETE FROM public_conversation_snapshots AS snapshot
    USING anonymized_org_conversations AS conversation
    WHERE snapshot.conversation_id = conversation.id
), deleted_rate_limits AS (
    DELETE FROM rate_limits USING target WHERE rate_limits.user_id = target.text_id
), deleted_tasks AS (
    DELETE FROM tasks USING target WHERE tasks.user_id = target.text_id
), deleted_audit_logs AS (
    DELETE FROM audit_logs USING target WHERE audit_logs.user_id = target.text_id
), deleted_sync_audit_logs AS (
    DELETE FROM sync_audit_logs USING target WHERE sync_audit_logs.user_id = target.text_id
), deleted_sync_devices AS (
    DELETE FROM sync_devices USING target WHERE sync_devices.user_id = target.text_id
), deleted_sync_push_results AS (
    DELETE FROM sync_push_results USING target WHERE sync_push_results.user_id = target.text_id
), deleted_remote_targets AS (
    DELETE FROM remote_targets USING target WHERE remote_targets.user_id = target.text_id
), deleted_remote_credentials AS (
    DELETE FROM remote_device_credentials USING target WHERE remote_device_credentials.user_id = target.text_id
), deleted_remote_connections AS (
    DELETE FROM remote_connections USING target WHERE remote_connections.user_id = target.text_id
), deleted_token_usage AS (
    DELETE FROM token_usage USING target WHERE token_usage.user_id = target.text_id
), deleted_tool_usage AS (
    DELETE FROM tool_usage USING target WHERE tool_usage.user_id = target.text_id
), deleted_usage_events AS (
    DELETE FROM usage_events USING target WHERE usage_events.user_id = target.text_id
), deleted_execution_traces AS (
    DELETE FROM execution_traces USING target WHERE execution_traces.user_id = target.id
)
DELETE FROM users AS account
USING target
WHERE account.id = target.id
`

// DeleteGDPRUserData removes non-FK user data and then deletes the user row,
// allowing database cascades to remove all FK-owned data atomically.
func (q *Queries) DeleteGDPRUserData(ctx context.Context, userID int32) error {
	_, err := q.db.Exec(ctx, deleteGDPRUserData, userID)
	return err
}

const conversationSnapshotCTEs = `
), deleted_snapshot AS (
    DELETE FROM public_conversation_snapshots AS snapshot
    USING updated
    WHERE snapshot.conversation_id = updated.id
      AND NOT updated.is_public
), upserted_snapshot AS (
    INSERT INTO public_conversation_snapshots (conversation_id, title, messages, snapshot_at)
    SELECT
        updated.id,
        updated.user_input,
        COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'messageId', message.message_id,
                    'role', message.role,
                    'content', message.content,
                    'isAgentStatus', message.is_agent_status,
                    'createdAt', message.created_at
                ) ORDER BY message.created_at, message.id
            )
            FROM messages AS message
            WHERE message.conversation_id = updated.id
              AND NOT message.is_deleted
        ), '[]'::jsonb),
        CURRENT_TIMESTAMP
    FROM updated
    WHERE updated.is_public
    ON CONFLICT (conversation_id) DO UPDATE SET
        title = EXCLUDED.title,
        messages = EXCLUDED.messages,
        snapshot_at = EXCLUDED.snapshot_at
)
SELECT id, is_public, share_id FROM updated
`

const updateConversationSharingSnapshot = `-- name: UpdateConversationSharingSnapshot :one
WITH updated AS (
    UPDATE conversations
    SET
        is_public = $2,
        share_id = $3,
        public_shared_at = CASE WHEN $2 THEN NOW() END,
        sync_version = NEXTVAL('sync_version_seq'),
        last_synced_at = NOW(),
        updated_at = NOW()
    WHERE id = $1 AND user_id = $4 AND organization_id IS null
    RETURNING id, is_public, share_id, user_input
` + conversationSnapshotCTEs

const updateConversationSharingSnapshotWithOrg = `-- name: UpdateConversationSharingSnapshotWithOrg :one
WITH updated AS (
    UPDATE conversations
    SET
        is_public = $2,
        share_id = $3,
        public_shared_at = CASE WHEN $2 THEN NOW() END,
        sync_version = NEXTVAL('sync_version_seq'),
        last_synced_at = NOW(),
        updated_at = NOW()
    WHERE id = $1 AND user_id = $4 AND organization_id = $5
    RETURNING id, is_public, share_id, user_input
` + conversationSnapshotCTEs

type UpdateConversationSharingSnapshotParams struct {
	ID       int32
	IsPublic bool
	ShareID  *string
	UserID   *string
}

type UpdateConversationSharingSnapshotWithOrgParams struct {
	ID             int32
	IsPublic       bool
	ShareID        *string
	UserID         *string
	OrganizationID *int32
}

type ConversationSharingSnapshotResult struct {
	ID       int32
	IsPublic bool
	ShareID  *string
}

func (q *Queries) UpdateConversationSharingSnapshot(ctx context.Context, arg UpdateConversationSharingSnapshotParams) (ConversationSharingSnapshotResult, error) {
	row := q.db.QueryRow(ctx, updateConversationSharingSnapshot, arg.ID, arg.IsPublic, arg.ShareID, arg.UserID)
	var result ConversationSharingSnapshotResult
	err := row.Scan(&result.ID, &result.IsPublic, &result.ShareID)
	return result, err
}

func (q *Queries) UpdateConversationSharingSnapshotWithOrg(ctx context.Context, arg UpdateConversationSharingSnapshotWithOrgParams) (ConversationSharingSnapshotResult, error) {
	row := q.db.QueryRow(ctx, updateConversationSharingSnapshotWithOrg, arg.ID, arg.IsPublic, arg.ShareID, arg.UserID, arg.OrganizationID)
	var result ConversationSharingSnapshotResult
	err := row.Scan(&result.ID, &result.IsPublic, &result.ShareID)
	return result, err
}

const getPublicConversationSnapshotByShareID = `-- name: GetPublicConversationSnapshotByShareID :one
SELECT
    conversation.id,
    snapshot.title,
    conversation.is_public,
    conversation.is_deleted,
    snapshot.snapshot_at
FROM conversations AS conversation
JOIN public_conversation_snapshots AS snapshot ON snapshot.conversation_id = conversation.id
WHERE conversation.share_id = $1
  AND conversation.is_public
  AND NOT conversation.is_deleted
LIMIT 1
`

type PublicConversationSnapshotResult struct {
	ID         int32
	Title      string
	IsPublic   bool
	IsDeleted  bool
	SnapshotAt pgtype.Timestamp
}

func (q *Queries) GetPublicConversationSnapshotByShareID(ctx context.Context, shareID *string) (PublicConversationSnapshotResult, error) {
	row := q.db.QueryRow(ctx, getPublicConversationSnapshotByShareID, shareID)
	var snapshot PublicConversationSnapshotResult
	err := row.Scan(&snapshot.ID, &snapshot.Title, &snapshot.IsPublic, &snapshot.IsDeleted, &snapshot.SnapshotAt)
	return snapshot, err
}

const getPublicConversationSnapshotMessages = `-- name: GetPublicConversationSnapshotMessages :many
SELECT
    item.value->>'messageId' AS message_id,
    item.value->>'role' AS role,
    item.value->>'content' AS content,
    COALESCE((item.value->>'isAgentStatus')::boolean, false) AS is_agent_status,
    (item.value->>'createdAt')::timestamp AS created_at
FROM public_conversation_snapshots AS snapshot
CROSS JOIN LATERAL jsonb_array_elements(snapshot.messages) WITH ORDINALITY AS item(value, position)
WHERE snapshot.conversation_id = $1
ORDER BY item.position
`

type PublicConversationSnapshotMessage struct {
	MessageID     string
	Role          string
	Content       string
	IsAgentStatus bool
	CreatedAt     pgtype.Timestamp
}

func (q *Queries) GetPublicConversationSnapshotMessages(ctx context.Context, conversationID int32) ([]PublicConversationSnapshotMessage, error) {
	rows, err := q.db.Query(ctx, getPublicConversationSnapshotMessages, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]PublicConversationSnapshotMessage, 0)
	for rows.Next() {
		var item PublicConversationSnapshotMessage
		if err := rows.Scan(&item.MessageID, &item.Role, &item.Content, &item.IsAgentStatus, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
