use rusqlite::params;

use super::{codec::parse_attachment_ids, storage_error, SqliteRunStore};
use crate::{protocol::PromptQueueRecord, runtime::RuntimeError};

impl SqliteRunStore {
    pub fn list_prompt_queue(&self) -> Result<Vec<PromptQueueRecord>, RuntimeError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "select id, conversation_id, prompt, status, dispatch_timing, created_at, updated_at, model_id, attachment_ids \
                 from prompt_queue order by created_at asc, id asc",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(PromptQueueRecord {
                    id: Some(row.get(0)?),
                    conversation_id: row.get(1)?,
                    prompt: row.get(2)?,
                    status: row.get(3)?,
                    dispatch_timing: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                    model_id: row.get(7)?,
                    attachment_ids: {
                        let attachment_ids: Option<String> = row.get(8)?;
                        attachment_ids
                            .as_deref()
                            .map(parse_attachment_ids)
                            .transpose()
                            .map_err(|err| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    8,
                                    rusqlite::types::Type::Text,
                                    Box::new(err),
                                )
                            })?
                            .unwrap_or_default()
                    },
                })
            })
            .map_err(storage_error)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
    }

    pub fn add_prompt_queue(
        &self,
        prompt: &PromptQueueRecord,
    ) -> Result<PromptQueueRecord, RuntimeError> {
        let connection = self.open()?;
        let attachment_ids =
            serde_json::to_string(&prompt.attachment_ids).map_err(storage_error)?;
        connection
            .execute(
                "insert into prompt_queue (
                    conversation_id, prompt, status, dispatch_timing, created_at, updated_at, model_id, attachment_ids
                ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    prompt.conversation_id,
                    prompt.prompt,
                    prompt.status,
                    prompt.dispatch_timing,
                    prompt.created_at,
                    prompt.updated_at,
                    prompt.model_id,
                    attachment_ids
                ],
            )
            .map_err(storage_error)?;
        let mut saved = prompt.clone();
        saved.id = Some(connection.last_insert_rowid());
        Ok(saved)
    }

    pub fn delete_prompt_queue(&self, id: i64) -> Result<(), RuntimeError> {
        let connection = self.open()?;
        connection
            .execute("delete from prompt_queue where id = ?1", params![id])
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn clear_prompt_queue(&self) -> Result<(), RuntimeError> {
        let connection = self.open()?;
        connection
            .execute("delete from prompt_queue", [])
            .map_err(storage_error)?;
        Ok(())
    }
}
