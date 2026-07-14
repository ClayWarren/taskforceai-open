use rusqlite::{params, Row};

use super::{
    codec::{
        parse_json_array_column, parse_optional_json_column, parse_pending_status, parse_status,
        pending_status_as_str, status_as_str,
    },
    SqliteRunStore, StoreResult,
};
use taskforceai_app_protocol::{PendingPromptRecord, RunRecord};

impl SqliteRunStore {
    pub fn load(&self) -> StoreResult<Vec<RunRecord>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
                "select id, prompt, model_id, project_id, status, output, error, created_at, updated_at, \
                    tool_events, sources, agent_statuses, pending_approval \
                 from runs order by created_at asc, id asc",
            )?;
        let mut rows = statement.query([])?;
        let mut runs = Vec::new();
        while let Some(row) = rows.next()? {
            if let Some(run) = run_record_from_row(row)? {
                runs.push(run);
            }
        }
        Ok(runs)
    }

    pub fn upsert_run(&self, run: &RunRecord) -> StoreResult<()> {
        let connection = self.open()?;
        upsert_run_on_connection(&connection, run)
    }

    pub fn delete(&self, run_id: &str) -> StoreResult<()> {
        let connection = self.open()?;
        connection.execute("delete from runs where id = ?1", params![run_id])?;
        Ok(())
    }

    pub fn list_pending_prompts(&self) -> StoreResult<Vec<PendingPromptRecord>> {
        let connection = self.open()?;
        let mut statement = connection.prepare(
                "select id, prompt, model_id, reasoning_effort, project_id, status, retry_count, last_error, created_at, updated_at \
                 from pending_prompts order by created_at asc, id asc",
            )?;
        let mut rows = statement.query([])?;
        let mut prompts = Vec::new();
        while let Some(row) = rows.next()? {
            if let Some(prompt) = pending_prompt_from_row(row)? {
                prompts.push(prompt);
            }
        }
        Ok(prompts)
    }

    pub fn upsert_pending_prompt(&self, prompt: &PendingPromptRecord) -> StoreResult<()> {
        let connection = self.open()?;
        connection.execute(
                "insert into pending_prompts (
                    id, prompt, model_id, reasoning_effort, project_id, status, retry_count, last_error, created_at, updated_at
                ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                on conflict(id) do update set
                    prompt = excluded.prompt,
                    model_id = excluded.model_id,
                    reasoning_effort = excluded.reasoning_effort,
                    project_id = excluded.project_id,
                    status = excluded.status,
                    retry_count = excluded.retry_count,
                    last_error = excluded.last_error,
                    updated_at = excluded.updated_at",
                params![
                    prompt.id,
                    prompt.prompt,
                    prompt.model_id,
                    prompt.reasoning_effort,
                    prompt.project_id,
                    pending_status_as_str(&prompt.status),
                    prompt.retry_count,
                    prompt.last_error,
                    prompt.created_at,
                    prompt.updated_at
                ],
            )?;
        Ok(())
    }

    pub fn delete_pending_prompt(&self, id: &str) -> StoreResult<()> {
        let connection = self.open()?;
        connection.execute("delete from pending_prompts where id = ?1", params![id])?;
        Ok(())
    }
}

fn run_record_from_row(row: &Row<'_>) -> StoreResult<Option<RunRecord>> {
    let id: String = row.get(0)?;
    let status: String = row.get(4)?;
    let status = match parse_status(&status) {
        Ok(status) => status,
        Err(err) => {
            // coverage:ignore-start
            log::warn!(
                target: "taskforceai_app_server",
                "skipping persisted run {id} with unknown status {status}: {err}"
            );
            // coverage:ignore-end
            return Ok(None);
        }
    };

    Ok(Some(RunRecord {
        id,
        prompt: row.get(1)?,
        model_id: row.get(2)?,
        project_id: row.get(3)?,
        status,
        output: row.get(5)?,
        error: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        tool_events: parse_json_array_column(row.get::<_, Option<String>>(9)?.as_deref(), 9)?,
        sources: parse_json_array_column(row.get::<_, Option<String>>(10)?.as_deref(), 10)?,
        agent_statuses: parse_json_array_column(row.get::<_, Option<String>>(11)?.as_deref(), 11)?,
        pending_approval: parse_optional_json_column(
            row.get::<_, Option<String>>(12)?.as_deref(),
            12,
        )?,
    }))
}

fn pending_prompt_from_row(row: &Row<'_>) -> StoreResult<Option<PendingPromptRecord>> {
    let id: String = row.get(0)?;
    let status: String = row.get(5)?;
    let status = match parse_pending_status(&status) {
        Ok(status) => status,
        Err(err) => {
            // coverage:ignore-start
            log::warn!(
                target: "taskforceai_app_server",
                "skipping pending prompt {id} with unknown status {status}: {err}"
            );
            // coverage:ignore-end
            return Ok(None);
        }
    };

    Ok(Some(PendingPromptRecord {
        id,
        prompt: row.get(1)?,
        model_id: row.get(2)?,
        reasoning_effort: row.get(3)?,
        project_id: row.get(4)?,
        status,
        retry_count: row.get(6)?,
        last_error: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    }))
}

fn upsert_run_on_connection(connection: &rusqlite::Connection, run: &RunRecord) -> StoreResult<()> {
    let tool_events = serde_json::to_string(&run.tool_events)?;
    let sources = serde_json::to_string(&run.sources)?;
    let agent_statuses = serde_json::to_string(&run.agent_statuses)?;
    let pending_approval = run
        .pending_approval
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    connection.execute(
        "insert into runs (
                id, prompt, model_id, project_id, status, output, error, created_at, updated_at,
                tool_events, sources, agent_statuses, pending_approval
            ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            on conflict(id) do update set
                prompt = excluded.prompt,
                model_id = excluded.model_id,
                project_id = excluded.project_id,
                status = excluded.status,
                output = excluded.output,
                error = excluded.error,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                tool_events = excluded.tool_events,
                sources = excluded.sources,
                agent_statuses = excluded.agent_statuses,
                pending_approval = excluded.pending_approval",
        params![
            run.id,
            run.prompt,
            run.model_id,
            run.project_id,
            status_as_str(&run.status),
            run.output,
            run.error,
            run.created_at,
            run.updated_at,
            tool_events,
            sources,
            agent_statuses,
            pending_approval
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use taskforceai_app_protocol::{PendingPromptStatus, RunStatus};

    #[test]
    fn store_run_load_delete_and_skip_unknown_status_rows() {
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

        let connection = store.open().expect("store should open");
        connection.execute(
                "insert into runs (id, prompt, status, created_at, updated_at) values (?1, ?2, ?3, ?4, ?5)",
                params!["run-bad-status", "bad", "mystery", 1_i64, 1_i64],
            )
            .expect("bad persisted run should insert");
        drop(connection);
        let runs = store.load().expect("unknown run status should be skipped");
        assert_eq!(
            runs.iter().map(|run| run.id.as_str()).collect::<Vec<_>>(),
            vec!["run-valid"]
        );
        store
            .delete("run-valid")
            .expect("delete should execute against runs table");
        let connection = store.open().expect("store should reopen");
        connection
            .execute("delete from runs where id = ?1", params!["run-bad-status"])
            .expect("bad run should delete");
        drop(connection);

        store
            .upsert_pending_prompt(&PendingPromptRecord {
                id: "pending-valid".to_string(),
                prompt: "retry".to_string(),
                model_id: None,
                reasoning_effort: None,
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

        store
            .upsert_pending_prompt(&PendingPromptRecord {
                id: "pending-valid".to_string(),
                prompt: "retry".to_string(),
                model_id: Some("openai/gpt-5.6-sol".to_string()),
                reasoning_effort: Some("max".to_string()),
                project_id: None,
                status: PendingPromptStatus::Queued,
                retry_count: 0,
                last_error: None,
                created_at: 1,
                updated_at: 1,
            })
            .expect("valid pending prompt should persist again");
        let connection = store.open().expect("store should reopen");
        connection.execute(
                "insert into pending_prompts (id, prompt, status, retry_count, created_at, updated_at) values (?1, ?2, ?3, ?4, ?5, ?6)",
                params!["pending-bad-status", "retry", "later", 0_i64, 1_i64, 1_i64],
            )
            .expect("bad pending prompt should insert");
        drop(connection);
        let prompts = store
            .list_pending_prompts()
            .expect("unknown pending status should be skipped");
        assert_eq!(
            prompts
                .iter()
                .map(|prompt| prompt.id.as_str())
                .collect::<Vec<_>>(),
            vec!["pending-valid"]
        );
        assert_eq!(prompts[0].reasoning_effort.as_deref(), Some("max"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn store_run_round_trips_stream_artifacts_and_pending_approval_after_restart() {
        let path = temp_store_path("runs-artifacts");
        let store = SqliteRunStore::new(path.clone());
        store
            .upsert_run(&RunRecord {
                id: "run-artifacts".to_string(),
                prompt: "inspect".to_string(),
                model_id: Some("openai/gpt-5.6-sol".to_string()),
                project_id: Some(7),
                status: RunStatus::Processing,
                output: Some("working".to_string()),
                error: None,
                created_at: 10,
                updated_at: 20,
                tool_events: vec![json!({ "tool": "browser", "status": "running" })],
                sources: vec![json!({ "url": "https://example.test" })],
                agent_statuses: vec![json!({ "agent": "Lead", "status": "waiting" })],
                pending_approval: Some(json!({ "id": "approval-1", "kind": "computer" })),
            })
            .expect("run should persist");
        drop(store);

        let restarted = SqliteRunStore::new(path.clone());
        let runs = restarted.load().expect("run should reload");
        assert_eq!(runs.len(), 1);
        let run = &runs[0];
        assert_eq!(
            run.tool_events,
            vec![json!({ "tool": "browser", "status": "running" })]
        );
        assert_eq!(run.sources, vec![json!({ "url": "https://example.test" })]);
        assert_eq!(
            run.agent_statuses,
            vec![json!({ "agent": "Lead", "status": "waiting" })]
        );
        assert_eq!(
            run.pending_approval,
            Some(json!({ "id": "approval-1", "kind": "computer" }))
        );

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
