use rusqlite::{params, OptionalExtension, Row};

use super::{
    codec::{parse_json_array_column, sqlite_bool},
    SqliteRunStore, StoreResult,
};
use taskforceai_app_protocol::{ConversationRecord, MessageRecord};

fn conversation_record_from_row(row: &Row<'_>) -> rusqlite::Result<ConversationRecord> {
    Ok(ConversationRecord {
        id: Some(row.get(0)?),
        conversation_id: row.get(1)?,
        title: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        last_message_preview: row.get(5)?,
        sync_version: row.get(6)?,
        last_synced_at: row.get(7)?,
        device_id: row.get(8)?,
        is_deleted: sqlite_bool(row.get::<_, i64>(9)?),
        is_archived: sqlite_bool(row.get::<_, i64>(10)?),
    })
}

fn message_record_from_row(row: &Row<'_>) -> rusqlite::Result<MessageRecord> {
    let sources: Option<String> = row.get(12)?;
    let tool_events: Option<String> = row.get(13)?;
    let agent_statuses: Option<String> = row.get(14)?;
    Ok(MessageRecord {
        id: Some(row.get(0)?),
        message_id: row.get(1)?,
        conversation_id: row.get(2)?,
        role: row.get(3)?,
        content: row.get(4)?,
        is_streaming: sqlite_bool(row.get::<_, i64>(5)?),
        is_agent_status: sqlite_bool(row.get::<_, i64>(6)?),
        is_local_command_output: sqlite_bool(row.get::<_, i64>(7)?),
        elapsed_seconds: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        error: row.get(11)?,
        sources: parse_json_array_column(sources.as_deref(), 12)?,
        tool_events: parse_json_array_column(tool_events.as_deref(), 13)?,
        agent_statuses: parse_json_array_column(agent_statuses.as_deref(), 14)?,
        trace_id: row.get(15)?,
        sync_version: row.get(16)?,
        last_synced_at: row.get(17)?,
        device_id: row.get(18)?,
        is_deleted: sqlite_bool(row.get::<_, i64>(19)?),
    })
}

impl SqliteRunStore {
    pub fn list_conversations(&self, limit: usize) -> StoreResult<Vec<ConversationRecord>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
                "select rowid, conversation_id, title, created_at, updated_at, last_message_preview, \
                    sync_version, last_synced_at, device_id, is_deleted, is_archived \
                 from conversations where is_deleted = 0 and is_archived = 0 order by updated_at desc limit ?1",
            )?;
        let rows = statement.query_map(params![limit as i64], conversation_record_from_row)?;

        let conversations = rows.collect::<Result<Vec<_>, _>>()?;
        Ok(conversations)
    }

    pub fn list_messages(&self, conversation_id: &str) -> StoreResult<Vec<MessageRecord>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
                "select rowid, message_id, conversation_id, role, content, is_streaming, is_agent_status, is_local_command_output, \
                    elapsed_seconds, created_at, updated_at, error, sources, tool_events, agent_statuses, \
                    trace_id, sync_version, last_synced_at, device_id, is_deleted \
                 from messages where conversation_id = ?1 and is_deleted = 0 order by created_at asc",
            )?;
        let rows = statement.query_map(params![conversation_id], message_record_from_row)?;

        let conversations = rows.collect::<Result<Vec<_>, _>>()?;
        Ok(conversations)
    }

    pub fn get_conversation(
        &self,
        conversation_id: &str,
    ) -> StoreResult<Option<ConversationRecord>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
            "select rowid, conversation_id, title, created_at, updated_at, last_message_preview, \
                    sync_version, last_synced_at, device_id, is_deleted, is_archived \
                 from conversations where conversation_id = ?1 limit 1",
        )?;
        let result = statement
            .query_row(params![conversation_id], conversation_record_from_row)
            .optional()?;
        Ok(result)
    }

    pub fn delete_conversation(&self, conversation_id: &str) -> StoreResult<()> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "delete from messages where conversation_id = ?1",
            params![conversation_id],
        )?;
        transaction.execute(
            "delete from conversations where conversation_id = ?1",
            params![conversation_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn delete_all_conversations(&self) -> StoreResult<()> {
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        transaction.execute("delete from messages", [])?;
        transaction.execute("delete from conversations", [])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn replace_conversation_id(
        &self,
        old_conversation_id: &str,
        new_conversation_id: &str,
    ) -> StoreResult<()> {
        if old_conversation_id == new_conversation_id {
            return Ok(());
        }
        let mut connection = self.open()?;
        let transaction = connection.transaction()?;
        transaction.execute(
            "insert into conversations (
                    conversation_id,
                    user_id,
                    title,
                    status,
                    created_at,
                    updated_at,
                    last_message_preview,
                    sync_version,
                    last_synced_at,
                    device_id,
                    is_deleted,
                    is_archived,
                    error
                )
                select
                    ?1,
                    user_id,
                    title,
                    status,
                    created_at,
                    updated_at,
                    last_message_preview,
                    sync_version,
                    last_synced_at,
                    device_id,
                    is_deleted,
                    is_archived,
                    error
                from conversations
                where conversation_id = ?2
                on conflict(conversation_id) do update set
                    title = excluded.title,
                    status = excluded.status,
                    updated_at = excluded.updated_at,
                    last_message_preview = excluded.last_message_preview,
                    sync_version = excluded.sync_version,
                    last_synced_at = excluded.last_synced_at,
                    device_id = excluded.device_id,
                    is_deleted = excluded.is_deleted,
                    is_archived = excluded.is_archived,
                    error = excluded.error",
            params![new_conversation_id, old_conversation_id],
        )?;
        transaction.execute(
            "update messages set conversation_id = ?1 where conversation_id = ?2",
            params![new_conversation_id, old_conversation_id],
        )?;
        transaction.execute(
            "delete from conversations where conversation_id = ?1",
            params![old_conversation_id],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn get_message(&self, message_id: &str) -> StoreResult<Option<MessageRecord>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
                "select rowid, message_id, conversation_id, role, content, is_streaming, is_agent_status, is_local_command_output, \
                    elapsed_seconds, created_at, updated_at, error, sources, tool_events, agent_statuses, \
                    trace_id, sync_version, last_synced_at, device_id, is_deleted \
                 from messages where message_id = ?1 limit 1",
            )?;
        let result = statement
            .query_row(params![message_id], message_record_from_row)
            .optional()?;
        Ok(result)
    }

    pub fn delete_message(&self, message_id: &str) -> StoreResult<()> {
        let connection = self.open()?;
        connection.execute(
            "delete from messages where message_id = ?1",
            params![message_id],
        )?;
        Ok(())
    }

    pub fn upsert_conversation(&self, conversation: &ConversationRecord) -> StoreResult<()> {
        let connection = self.open()?;
        connection.execute(
            "insert into conversations (
                    conversation_id, title, created_at, updated_at, last_message_preview,
                    sync_version, last_synced_at, device_id, is_deleted, is_archived
                ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                on conflict(conversation_id) do update set
                    title = excluded.title,
                    updated_at = excluded.updated_at,
                    last_message_preview = excluded.last_message_preview,
                    sync_version = excluded.sync_version,
                    last_synced_at = excluded.last_synced_at,
                    device_id = excluded.device_id,
                    is_deleted = excluded.is_deleted,
                    is_archived = excluded.is_archived",
            params![
                conversation.conversation_id,
                conversation.title,
                conversation.created_at,
                conversation.updated_at,
                conversation.last_message_preview,
                conversation.sync_version,
                conversation.last_synced_at,
                conversation.device_id,
                conversation.is_deleted as i64,
                conversation.is_archived as i64
            ],
        )?;
        Ok(())
    }

    pub fn upsert_message(&self, message: &MessageRecord) -> StoreResult<()> {
        let connection = self.open()?;
        let sources = serde_json::to_string(&message.sources)?;
        let tool_events = serde_json::to_string(&message.tool_events)?;
        let agent_statuses = serde_json::to_string(&message.agent_statuses)?;
        connection.execute(
                "insert into messages (
                    message_id, conversation_id, role, content, is_streaming, is_agent_status,
                    is_local_command_output, elapsed_seconds, created_at, updated_at, error,
                    sources, tool_events, agent_statuses, trace_id, sync_version, last_synced_at,
                    device_id, is_deleted
                ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
                on conflict(message_id) do update set
                    conversation_id = excluded.conversation_id,
                    role = excluded.role,
                    content = excluded.content,
                    is_streaming = excluded.is_streaming,
                    is_agent_status = excluded.is_agent_status,
                    is_local_command_output = excluded.is_local_command_output,
                    elapsed_seconds = excluded.elapsed_seconds,
                    updated_at = excluded.updated_at,
                    error = excluded.error,
                    sources = excluded.sources,
                    tool_events = excluded.tool_events,
                    agent_statuses = excluded.agent_statuses,
                    trace_id = excluded.trace_id,
                    sync_version = excluded.sync_version,
                    last_synced_at = excluded.last_synced_at,
                    device_id = excluded.device_id,
                    is_deleted = excluded.is_deleted",
                params![
                    message.message_id,
                    message.conversation_id,
                    message.role,
                    message.content,
                    message.is_streaming as i64,
                    message.is_agent_status as i64,
                    message.is_local_command_output as i64,
                    message.elapsed_seconds,
                    message.created_at,
                    message.updated_at,
                    message.error,
                    sources,
                    tool_events,
                    agent_statuses,
                    message.trace_id,
                    message.sync_version,
                    message.last_synced_at,
                    message.device_id,
                    message.is_deleted as i64
                ],
            )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_conversation_id_noops_when_ids_match() {
        let path = std::env::temp_dir().join(format!(
            "taskforceai-store-conversation-noop-{}-{}.sqlite3",
            std::process::id(),
            crate::test_unix_millis()
        ));
        let store = SqliteRunStore::new(path.clone());

        store
            .replace_conversation_id("same-conversation", "same-conversation")
            .expect("matching conversation ids should noop");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn upsert_message_enforces_existing_conversation() {
        let path = std::env::temp_dir().join(format!(
            "taskforceai-store-message-fk-{}-{}.sqlite3",
            std::process::id(),
            crate::test_unix_millis()
        ));
        let store = SqliteRunStore::new(path.clone());

        let error = store
            .upsert_message(&MessageRecord {
                message_id: "orphan-message".to_string(),
                conversation_id: "missing-conversation".to_string(),
                role: "user".to_string(),
                content: "hello".to_string(),
                created_at: 1,
                updated_at: 1,
                ..MessageRecord::default()
            })
            .expect_err("orphan messages should violate the conversation foreign key");
        assert!(
            error.message.contains("FOREIGN KEY"),
            "unexpected error: {error:?}"
        );

        let _ = std::fs::remove_file(path);
    }
}
