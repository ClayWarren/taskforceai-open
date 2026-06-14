use rusqlite::params;

use super::{
    codec::{parse_pending_status, parse_status, pending_status_as_str, status_as_str},
    storage_error, SqliteRunStore,
};
use crate::{
    protocol::{PendingPromptRecord, RunRecord},
    runtime::RuntimeError,
};

impl SqliteRunStore {
    pub fn load(&self) -> Result<Vec<RunRecord>, RuntimeError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "select id, prompt, model_id, project_id, status, output, error, created_at, updated_at \
                 from runs order by created_at asc, id asc",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map([], |row| {
                let status: String = row.get(4)?;
                Ok(RunRecord {
                    id: row.get(0)?,
                    prompt: row.get(1)?,
                    model_id: row.get(2)?,
                    project_id: row.get(3)?,
                    status: parse_status(&status).map_err(|err| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            Box::new(err),
                        )
                    })?,
                    output: row.get(5)?,
                    error: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    tool_events: Vec::new(),
                    sources: Vec::new(),
                    agent_statuses: Vec::new(),
                    pending_approval: None,
                })
            })
            .map_err(storage_error)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
    }

    pub fn upsert_run(&self, run: &RunRecord) -> Result<(), RuntimeError> {
        let connection = self.open()?;
        upsert_run_on_connection(&connection, run)
    }

    pub fn delete(&self, run_id: &str) -> Result<(), RuntimeError> {
        let connection = self.open()?;
        connection
            .execute("delete from runs where id = ?1", params![run_id])
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn list_pending_prompts(&self) -> Result<Vec<PendingPromptRecord>, RuntimeError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "select id, prompt, model_id, project_id, status, retry_count, last_error, created_at, updated_at \
                 from pending_prompts order by created_at asc, id asc",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map([], |row| {
                let status: String = row.get(4)?;
                Ok(PendingPromptRecord {
                    id: row.get(0)?,
                    prompt: row.get(1)?,
                    model_id: row.get(2)?,
                    project_id: row.get(3)?,
                    status: parse_pending_status(&status).map_err(|err| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            Box::new(err),
                        )
                    })?,
                    retry_count: row.get(5)?,
                    last_error: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .map_err(storage_error)?;

        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
    }

    pub fn upsert_pending_prompt(&self, prompt: &PendingPromptRecord) -> Result<(), RuntimeError> {
        let connection = self.open()?;
        connection
            .execute(
                "insert into pending_prompts (
                    id, prompt, model_id, project_id, status, retry_count, last_error, created_at, updated_at
                ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                on conflict(id) do update set
                    prompt = excluded.prompt,
                    model_id = excluded.model_id,
                    project_id = excluded.project_id,
                    status = excluded.status,
                    retry_count = excluded.retry_count,
                    last_error = excluded.last_error,
                    updated_at = excluded.updated_at",
                params![
                    prompt.id,
                    prompt.prompt,
                    prompt.model_id,
                    prompt.project_id,
                    pending_status_as_str(&prompt.status),
                    prompt.retry_count,
                    prompt.last_error,
                    prompt.created_at,
                    prompt.updated_at
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub fn delete_pending_prompt(&self, id: &str) -> Result<(), RuntimeError> {
        let connection = self.open()?;
        connection
            .execute("delete from pending_prompts where id = ?1", params![id])
            .map_err(storage_error)?;
        Ok(())
    }
}

fn upsert_run_on_connection(
    connection: &rusqlite::Connection,
    run: &RunRecord,
) -> Result<(), RuntimeError> {
    connection
        .execute(
            "insert into runs (
                id, prompt, model_id, project_id, status, output, error, created_at, updated_at
            ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            on conflict(id) do update set
                prompt = excluded.prompt,
                model_id = excluded.model_id,
                project_id = excluded.project_id,
                status = excluded.status,
                output = excluded.output,
                error = excluded.error,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at",
            params![
                run.id,
                run.prompt,
                run.model_id,
                run.project_id,
                status_as_str(&run.status),
                run.output,
                run.error,
                run.created_at,
                run.updated_at
            ],
        )
        .map_err(storage_error)?;
    Ok(())
}
