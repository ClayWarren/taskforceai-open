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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{PendingPromptStatus, RunStatus};

    #[test]
    fn store_run_load_delete_and_pending_status_errors_are_reported() {
        let path = temp_store_path("runs-error-paths");
        let store = SqliteRunStore::new(path.clone());
        store
            .upsert_run(&RunRecord {
                id: "run-valid".to_string(),
                prompt: "valid".to_string(),
                model_id: None,
                project_id: None,
                status: RunStatus::Queued,
                output: None,
                error: None,
                created_at: 1,
                updated_at: 1,
                tool_events: Vec::new(),
                sources: Vec::new(),
                agent_statuses: Vec::new(),
                pending_approval: None,
            })
            .expect("valid run should persist");
        store
            .delete("run-valid")
            .expect("delete should execute against runs table");
        assert!(store.load().expect("store should load").is_empty());

        let connection = store.open().expect("store should open");
        connection
            .execute(
                "insert into runs (id, prompt, status, created_at, updated_at) values (?1, ?2, ?3, ?4, ?5)",
                params!["run-bad-status", "bad", "mystery", 1_i64, 1_i64],
            )
            .expect("bad persisted run should insert");
        assert_eq!(
            store
                .load()
                .expect_err("unknown run status should fail")
                .code,
            -32020
        );
        connection
            .execute("delete from runs where id = ?1", params!["run-bad-status"])
            .expect("bad run should delete");
        drop(connection);

        store
            .upsert_pending_prompt(&PendingPromptRecord {
                id: "pending-valid".to_string(),
                prompt: "retry".to_string(),
                model_id: None,
                project_id: None,
                status: PendingPromptStatus::Queued,
                retry_count: 0,
                last_error: None,
                created_at: 1,
                updated_at: 1,
            })
            .expect("valid pending prompt should persist");
        store
            .delete_pending_prompt("pending-valid")
            .expect("pending delete should execute");

        let connection = store.open().expect("store should reopen");
        connection
            .execute(
                "insert into pending_prompts (id, prompt, status, retry_count, created_at, updated_at) values (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["pending-bad-status", "retry", "later", 0_i64, 1_i64, 1_i64],
            )
            .expect("bad pending prompt should insert");
        assert_eq!(
            store
                .list_pending_prompts()
                .expect_err("unknown pending status should fail")
                .code,
            -32020
        );

        let _ = std::fs::remove_file(path);
    }

    fn temp_store_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "taskforceai-store-{name}-{}-{}.sqlite3",
            std::process::id(),
            crate::runtime::unix_millis()
        ))
    }
}
