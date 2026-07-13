use rusqlite::params;

use super::{codec::parse_attachment_ids, SqliteRunStore, StoreResult};
use taskforceai_app_protocol::PromptQueueRecord;

impl SqliteRunStore {
    pub fn list_prompt_queue(&self) -> StoreResult<Vec<PromptQueueRecord>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
                "select id, conversation_id, prompt, status, dispatch_timing, created_at, updated_at, model_id, reasoning_effort, attachment_ids \
                 from prompt_queue order by created_at asc, id asc",
            )?;
        let rows = statement.query_map([], |row| {
            Ok(PromptQueueRecord {
                id: Some(row.get(0)?),
                conversation_id: row.get(1)?,
                prompt: row.get(2)?,
                status: row.get(3)?,
                dispatch_timing: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                model_id: row.get(7)?,
                reasoning_effort: row.get(8)?,
                attachment_ids: {
                    let attachment_ids: Option<String> = row.get(9)?;
                    attachment_ids
                        .as_deref()
                        .map(parse_attachment_ids)
                        .transpose()
                        .map_err(|err| {
                            rusqlite::Error::FromSqlConversionFailure(
                                9,
                                rusqlite::types::Type::Text,
                                Box::new(err),
                            )
                        })?
                        .unwrap_or_default()
                },
            })
        })?;

        let prompts = rows.collect::<Result<Vec<_>, _>>()?;
        Ok(prompts)
    }

    pub fn add_prompt_queue(&self, prompt: &PromptQueueRecord) -> StoreResult<PromptQueueRecord> {
        let connection = self.open()?;
        let attachment_ids = serde_json::to_string(&prompt.attachment_ids)?;
        connection.execute(
                "insert into prompt_queue (
                    conversation_id, prompt, status, dispatch_timing, created_at, updated_at, model_id, reasoning_effort, attachment_ids
                ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    prompt.conversation_id,
                    prompt.prompt,
                    prompt.status,
                    prompt.dispatch_timing,
                    prompt.created_at,
                    prompt.updated_at,
                    prompt.model_id,
                    prompt.reasoning_effort,
                    attachment_ids
                ],
            )?;
        let mut saved = prompt.clone();
        saved.id = Some(connection.last_insert_rowid());
        Ok(saved)
    }

    pub fn delete_prompt_queue(&self, id: i64) -> StoreResult<()> {
        let connection = self.open()?;
        connection.execute("delete from prompt_queue where id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_prompt_queue(&self) -> StoreResult<()> {
        let connection = self.open()?;
        connection.execute("delete from prompt_queue", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_prompt_queue_reports_bad_attachment_id_json() {
        let path = temp_store_path("queue-bad-attachments");
        let store = SqliteRunStore::new(path.clone());
        let connection = store.open().expect("store should open");
        connection.execute(
                "insert into prompt_queue (
                    conversation_id, prompt, status, dispatch_timing, created_at, updated_at, attachment_ids
                ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    "conversation_bad",
                    "prompt",
                    "queued",
                    "immediate",
                    1_i64,
                    1_i64,
                    "not-json"
                ],
            )
            .expect("bad queue row should insert");

        let error = store
            .list_prompt_queue()
            .expect_err("bad attachment id json should fail");
        assert!(error.to_string().contains("invalid attachment ids"));

        let _ = std::fs::remove_file(path);
    }

    fn temp_store_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "taskforceai-store-{name}-{}-{}.sqlite3",
            std::process::id(),
            crate::test_unix_millis()
        ))
    }
}
