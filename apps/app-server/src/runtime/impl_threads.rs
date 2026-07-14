use crate::protocol::*;
use std::path::PathBuf;

use super::error::RuntimeError;
use super::models::{ollama_memory_recommendation, total_system_memory_bytes};
use super::util::*;

impl super::AppRuntime {
    pub fn thread_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(ThreadListResult {
            threads: self.thread_records()?,
        }))
    }

    pub fn thread_start(&mut self, params: ThreadStartParams) -> Result<AppResponse, RuntimeError> {
        let objective = params.objective.trim();
        if objective.is_empty() {
            return Err(RuntimeError::invalid_params("objective is required")); // coverage:ignore-line
        }
        let now = unix_millis();
        let thread_id = params
            .thread_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("agent-{now}"));
        if self
            .thread_records()?
            .iter()
            .any(|thread| thread.id == thread_id)
        {
            return Err(RuntimeError::invalid_params("thread id already exists"));
            // coverage:ignore-line
            // coverage:ignore-line
        }
        let title = params
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Agent thread")
            .to_string();
        let source = params
            .source
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("thread")
            .to_string();
        let thread = ThreadRecord {
            id: thread_id.clone(),
            title: title.clone(),
            objective: objective.to_string(),
            state: ThreadState::Active,
            archived: false,
            source: source.clone(),
            task_mode: params.task_mode,
            parent_thread_id: None,
            turns: Vec::new(),
            created_at: now,
            updated_at: now,
        };
        let session = AgentSessionRecord {
            session_id: thread_id,
            title,
            objective: objective.to_string(),
            state: "running".to_string(),
            source,
            task_mode: params.task_mode,
            parent_session_id: None,
            last_message: None,
            run_ids: Vec::new(),
            active_run_id: None,
            last_error: None,
            created_at: now,
            updated_at: now,
        };
        let mut threads = self.thread_records()?;
        let mut sessions = self.agent_sessions()?;
        sessions.push(session.clone());
        self.save_agent_sessions(&sessions)?;
        threads.push(thread.clone());
        self.save_thread_records(&threads)?;
        Ok(value(ThreadResult { thread, turn: None }))
    }

    pub fn thread_resume(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        self.set_thread_active(&params.thread_id)
    }

    pub fn thread_archive(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        let thread = self.update_thread(&params.thread_id, |thread| {
            thread.archived = true;
        })?;
        Ok(value(ThreadResult { thread, turn: None }))
    }

    pub fn thread_cancel(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        let thread_id = params.thread_id;
        let active_run_id = self.find_agent_session(&thread_id)?.active_run_id;
        let mut events = Vec::new();
        if let Some(run_id) = active_run_id {
            let (_, run_events) =
                run_status_result_and_events(self.run_cancel(RunIDParams { run_id })?)?;
            events.extend(run_events);
        }
        if let Some(broker) = self.interaction_broker.clone() {
            let cancellation_thread_id = thread_id.clone();
            tokio::spawn(async move {
                broker.cancel_thread(&cancellation_thread_id).await;
            });
        }
        let thread = self.update_thread(&thread_id, |thread| {
            thread.state = ThreadState::Canceled;
        })?;
        self.update_agent_session_state(&thread_id, "cancelled")?;
        events.push(AppServerEvent::ThreadUpdated {
            thread: Box::new(thread.clone()),
        });
        Ok(AppResponse::WithEvents {
            result: to_value(ThreadResult { thread, turn: None }),
            events,
        })
    }

    pub fn thread_fork(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        let parent = self.find_thread_record(&params.thread_id)?;
        let now = unix_millis();
        let threads = self.thread_records()?;
        let fork_id = unique_thread_id(&threads, now);
        let mut fork = parent.clone();
        fork.id = fork_id.clone();
        fork.title = format!("{} fork", parent.title);
        fork.parent_thread_id = Some(parent.id);
        fork.state = ThreadState::Active;
        fork.archived = false;
        fork.created_at = now;
        fork.updated_at = now;
        for (turn_index, turn) in fork.turns.iter_mut().enumerate() {
            let turn_id = format!("{fork_id}:fork:{turn_index}");
            turn.id = turn_id.clone();
            turn.thread_id = fork_id.clone();
            for (item_index, item) in turn.items.iter_mut().enumerate() {
                item.id = format!("{turn_id}:item:{item_index}");
                item.turn_id = turn_id.clone();
            }
        }
        let mut all_threads = threads;
        all_threads.push(fork.clone());
        self.save_thread_records(&all_threads)?;

        let mut sessions = self.agent_sessions()?;
        sessions.push(AgentSessionRecord {
            session_id: fork.id.clone(),
            title: fork.title.clone(),
            objective: fork.objective.clone(),
            state: "running".to_string(),
            source: fork.source.clone(),
            task_mode: fork.task_mode,
            parent_session_id: fork.parent_thread_id.clone(),
            last_message: fork
                .turns
                .last()
                .and_then(|turn| last_text_item(&turn.items)),
            run_ids: fork.turns.iter().map(|turn| turn.run_id.clone()).collect(),
            active_run_id: None,
            last_error: None,
            created_at: now,
            updated_at: now,
        });
        self.save_agent_sessions(&sessions)?;
        Ok(value(ThreadResult {
            thread: fork,
            turn: None,
        }))
    }

    pub async fn turn_start(
        &mut self,
        params: TurnStartParams,
    ) -> Result<AppResponse, RuntimeError> {
        let input = params.input.trim().to_string();
        if input.is_empty() {
            return Err(RuntimeError::invalid_params("input is required"));
        }
        let thread = self.find_thread_record(&params.thread_id)?;
        if thread.archived {
            return Err(RuntimeError::invalid_params("thread is archived"));
        }
        if thread.state != ThreadState::Active {
            return Err(RuntimeError::invalid_params("thread is not active"));
        }
        let run_input = if thread.task_mode == TaskMode::Code {
            match params.project_id {
                Some(project_id) => self.prepare_project_code_input(project_id, &input).await?,
                None => input.clone(),
            }
        } else {
            input.clone()
        };
        let response = self
            .agent_session_run(AgentSessionRunParams {
                session_id: params.thread_id.clone(),
                prompt: Some(run_input),
                model_id: params.model_id,
                reasoning_effort: params.reasoning_effort,
                quick_mode: params.quick_mode,
                autonomous: params.autonomous,
                computer_use: params.computer_use,
                use_logged_in_services: params.use_logged_in_services,
                agent_count: params.agent_count,
                project_id: params.project_id,
                attachment_ids: params.attachment_ids,
                client_mcp_tools: params.client_mcp_tools,
            })
            .await?;
        let (result, run_events) = agent_session_run_result_and_events(response)?;
        let thread_id = result.session.session_id.clone();
        let run = result.run.clone();
        let now = run.created_at;
        let turn_id = format!("turn:{}", run.id);
        let user_item = ThreadItemRecord {
            id: format!("{turn_id}:user"),
            turn_id: turn_id.clone(),
            item_type: ThreadItemType::UserMessage,
            status: ThreadItemStatus::Completed,
            content: serde_json::json!({"text": input}),
            created_at: now,
            updated_at: now,
        };
        let agent_item = ThreadItemRecord {
            id: format!("{turn_id}:agent-message"),
            turn_id: turn_id.clone(),
            item_type: ThreadItemType::AgentMessage,
            status: ThreadItemStatus::InProgress,
            content: serde_json::json!({"text": run.output, "error": run.error}),
            created_at: now,
            updated_at: run.updated_at,
        };
        let turn = TurnRecord {
            id: turn_id,
            thread_id: thread_id.clone(),
            run_id: run.id.clone(),
            status: turn_status_for_run(&run.status),
            items: vec![user_item.clone(), agent_item.clone()],
            created_at: now,
            updated_at: run.updated_at,
        };
        let thread = self.update_thread(&thread_id, |thread| {
            thread.turns.push(turn.clone());
        })?;
        let mut events = vec![
            AppServerEvent::TurnStarted {
                thread_id: thread_id.clone(),
                turn: Box::new(turn.clone()),
            },
            AppServerEvent::ItemCompleted {
                thread_id: thread_id.clone(),
                turn_id: turn.id.clone(),
                item: Box::new(user_item),
            },
            AppServerEvent::ItemStarted {
                thread_id: thread_id.clone(),
                turn_id: turn.id.clone(),
                item: Box::new(agent_item),
            },
        ];
        events.extend(run_events);
        Ok(AppResponse::WithEvents {
            result: to_value(TurnResult { thread, turn, run }),
            events,
        })
    }

    async fn prepare_project_code_input(
        &mut self,
        project_id: i64,
        input: &str,
    ) -> Result<String, RuntimeError> {
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required for Code projects"))?;
        let project = self
            .projects_with_local_workspaces(&token)
            .await?
            .into_iter()
            .find(|project| project.id == project_id)
            .ok_or_else(|| RuntimeError::not_found("project not found"))?;
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let mut workspace_roots = Vec::new();
        for root in project.workspace_roots {
            let canonical = PathBuf::from(root).canonicalize().map_err(|error| {
                RuntimeError::invalid_params(format!("Project workspace is unavailable: {error}"))
            })?;
            let canonical = taskforceai_core::local_coding::validate_workspace_path(
                canonical.clone(),
                canonical.is_dir(),
                home.as_deref(),
            )
            .map_err(RuntimeError::invalid_params)?;
            if !workspace_roots.contains(&canonical) {
                workspace_roots.push(canonical);
            }
        }
        if workspace_roots.is_empty() {
            return Err(RuntimeError::invalid_params(
                "The selected project does not have a local workspace",
            ));
        }

        let tools = taskforceai_core::local_coding::filesystem_tool_names();
        self.mcp_add(McpServerAddParams {
            name: taskforceai_core::local_coding::WORKSPACE_MCP_SERVER_NAME.to_string(),
            endpoint: taskforceai_core::local_coding::filesystem_mcp_endpoint_for_roots(
                &workspace_roots,
            ),
            tools: tools.clone(),
            enabled: true,
        })?;
        self.mcp_tools(McpServerToolsParams {
            name: taskforceai_core::local_coding::WORKSPACE_MCP_SERVER_NAME.to_string(),
            tools,
        })?;
        self.project_use(ProjectIDParams { project_id })?;

        Ok(taskforceai_core::local_coding::prompt_for_workspace_roots(
            &workspace_roots,
            input,
        ))
    }

    pub async fn turn_steer(
        &mut self,
        params: TurnSteerParams,
    ) -> Result<AppResponse, RuntimeError> {
        let input = params.input.trim();
        if input.is_empty() {
            return Err(RuntimeError::invalid_params("input is required"));
        }
        let active_run_id = self
            .find_agent_session(&params.thread_id)?
            .active_run_id
            .ok_or_else(|| RuntimeError::invalid_params("thread has no active turn"))?;
        if let Some(token) = self.auth_token()? {
            if !active_run_id.starts_with("local_run_") {
                self.api_client
                    .steer_run(&token, &active_run_id, input)
                    .await?;
            }
        }
        let now = unix_millis();
        let mut updated_turn = None;
        let thread = self.update_thread(&params.thread_id, |thread| {
            let turn =
                thread.turns.iter_mut().rev().find(|turn| {
                    matches!(turn.status, TurnStatus::Queued | TurnStatus::InProgress)
                });
            if let Some(turn) = turn {
                turn.items.push(ThreadItemRecord {
                    id: format!("{}:steer:{}", turn.id, turn.items.len()),
                    turn_id: turn.id.clone(),
                    item_type: ThreadItemType::SteeringMessage,
                    status: ThreadItemStatus::Completed,
                    content: serde_json::json!({"text": input}),
                    created_at: now,
                    updated_at: now,
                });
                turn.updated_at = now;
                updated_turn = Some(turn.clone());
            }
        })?;
        let turn = updated_turn
            .ok_or_else(|| RuntimeError::invalid_params("thread has no active turn"))?;
        self.agent_session_message(AgentSessionMessageParams {
            session_id: params.thread_id,
            message: input.to_string(),
        })?;
        Ok(value(ThreadResult {
            thread,
            turn: Some(turn),
        }))
    }

    pub fn turn_interrupt(
        &mut self,
        params: TurnInterruptParams,
    ) -> Result<AppResponse, RuntimeError> {
        let session = self.find_agent_session(&params.thread_id)?;
        let Some(run_id) = session.active_run_id else {
            // coverage:ignore-line
            return Err(RuntimeError::invalid_params("thread has no active turn"));
            // coverage:ignore-line
        };
        if let Some(broker) = self.interaction_broker.clone() {
            let thread_id = params.thread_id.clone();
            let turn_id = run_id.clone();
            tokio::spawn(async move {
                broker.cancel_turn(&thread_id, &turn_id).await;
            });
        }
        let (run, mut events) = run_status_result_and_events(self.run_cancel(RunIDParams {
            run_id: run_id.clone(),
        })?)?;
        self.update_agent_session_state(&params.thread_id, "paused")?;
        let run = run.run;
        let mut interrupted_turn = None;
        let thread = self.update_thread(&params.thread_id, |thread| {
            thread.state = ThreadState::Paused;
            if let Some(turn) = thread.turns.iter_mut().find(|turn| turn.run_id == run_id) {
                turn.status = TurnStatus::Interrupted;
                turn.updated_at = run.updated_at;
                for item in &mut turn.items {
                    if item.status == ThreadItemStatus::InProgress {
                        item.status = ThreadItemStatus::Failed;
                        item.updated_at = run.updated_at;
                    }
                }
                interrupted_turn = Some(turn.clone());
            }
        })?;
        let turn =
            interrupted_turn.ok_or_else(|| RuntimeError::not_found("active turn not found"))?;
        events.insert(
            0,
            AppServerEvent::TurnInterrupted {
                thread_id: params.thread_id,
                turn: Box::new(turn.clone()),
            },
        );
        Ok(AppResponse::WithEvents {
            result: to_value(TurnResult { thread, turn, run }),
            events,
        })
    }

    pub fn thread_read(&self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        Ok(value(ThreadResult {
            thread: self.find_thread_record(&params.thread_id)?,
            turn: None,
        }))
    }

    pub fn thread_import(
        &mut self,
        params: ThreadImportParams,
    ) -> Result<AppResponse, RuntimeError> {
        let mut imported = params.thread;
        if imported.id.trim().is_empty() {
            return Err(RuntimeError::invalid_params("thread id is required"));
        }
        if imported.title.trim().is_empty() {
            return Err(RuntimeError::invalid_params("thread title is required"));
        }
        if imported.objective.trim().is_empty() {
            return Err(RuntimeError::invalid_params("thread objective is required"));
        }

        let mut threads = self.thread_records()?;
        let existing_thread = threads.iter().position(|thread| thread.id == imported.id);
        if existing_thread.is_some() && !params.overwrite {
            return Err(RuntimeError::invalid_params("thread id already exists"));
        }

        // A handoff transfers durable history, not an in-flight executor. Any turn
        // that was active on the source is made safely resumable on the destination.
        let now = unix_millis();
        for turn in &mut imported.turns {
            if matches!(turn.status, TurnStatus::Queued | TurnStatus::InProgress) {
                turn.status = TurnStatus::Interrupted;
                turn.updated_at = now;
            }
            for item in &mut turn.items {
                if item.status == ThreadItemStatus::InProgress {
                    item.status = ThreadItemStatus::Failed;
                    item.updated_at = now;
                }
            }
        }
        imported.updated_at = now;

        let last_message = imported
            .turns
            .iter()
            .rev()
            .find_map(|turn| last_text_item(&turn.items));
        let last_error = imported.turns.iter().rev().find_map(|turn| {
            turn.items.iter().rev().find_map(|item| {
                (item.item_type == ThreadItemType::Error)
                    .then(|| item.content.get("text").and_then(serde_json::Value::as_str))
                    .flatten()
                    .map(str::to_string)
            })
        });
        let mut run_ids = Vec::new();
        for turn in &imported.turns {
            if !run_ids.iter().any(|run_id| run_id == &turn.run_id) {
                run_ids.push(turn.run_id.clone());
            }
        }
        let session = AgentSessionRecord {
            session_id: imported.id.clone(),
            title: imported.title.clone(),
            objective: imported.objective.clone(),
            state: match imported.state {
                ThreadState::Active => "running",
                ThreadState::Paused => "paused",
                ThreadState::Canceled => "cancelled",
            }
            .to_string(),
            source: imported.source.clone(),
            task_mode: imported.task_mode,
            parent_session_id: imported.parent_thread_id.clone(),
            last_message,
            run_ids,
            active_run_id: None,
            last_error,
            created_at: imported.created_at,
            updated_at: imported.updated_at,
        };

        let mut sessions = self.agent_sessions()?;
        let existing_session = sessions
            .iter()
            .position(|candidate| candidate.session_id == session.session_id);
        match existing_session {
            Some(index) => sessions[index] = session,
            None => sessions.push(session),
        }
        match existing_thread {
            Some(index) => threads[index] = imported.clone(),
            None => threads.push(imported.clone()),
        }
        self.save_agent_sessions(&sessions)?;
        self.save_thread_records(&threads)?;

        Ok(AppResponse::WithEvents {
            result: to_value(ThreadResult {
                thread: imported.clone(),
                turn: None,
            }),
            events: vec![AppServerEvent::ThreadUpdated {
                thread: Box::new(imported),
            }],
        })
    }

    pub fn thread_unarchive(
        &mut self,
        params: ThreadIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.set_thread_active(&params.thread_id)
    }

    pub fn thread_delete(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        let mut threads = self.thread_records()?;
        let before = threads.len();
        threads.retain(|thread| thread.id != params.thread_id);
        if before == threads.len() {
            return Err(RuntimeError::not_found("thread not found"));
        }
        self.save_thread_records(&threads)?;
        let mut sessions = self.agent_sessions()?;
        sessions.retain(|session| session.session_id != params.thread_id);
        self.save_agent_sessions(&sessions)?;
        Ok(value(AckResult { ok: true }))
    }

    pub fn thread_name_set(
        &mut self,
        params: ThreadNameSetParams,
    ) -> Result<AppResponse, RuntimeError> {
        let title = params.title.trim();
        if title.is_empty() {
            return Err(RuntimeError::invalid_params("title is required"));
        }
        let thread = self.update_thread(&params.thread_id, |thread| {
            thread.title = title.to_string();
        })?;
        self.update_agent_session_title(&params.thread_id, title)?;
        Ok(value(ThreadResult { thread, turn: None }))
    }

    pub fn thread_metadata_update(
        &mut self,
        params: ThreadMetadataUpdateParams,
    ) -> Result<AppResponse, RuntimeError> {
        let title = params
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let objective = params
            .objective
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if title.is_none() && objective.is_none() {
            return Err(RuntimeError::invalid_params(
                "title or objective is required",
            ));
        }
        let thread = self.update_thread(&params.thread_id, |thread| {
            if let Some(title) = title {
                thread.title = title.to_string();
            }
            if let Some(objective) = objective {
                thread.objective = objective.to_string();
            }
        })?;
        self.update_agent_session_metadata(&params.thread_id, title, objective)?;
        Ok(value(ThreadResult { thread, turn: None }))
    }

    pub fn thread_rollback(
        &mut self,
        params: ThreadRollbackParams,
    ) -> Result<AppResponse, RuntimeError> {
        let mut found = false;
        let thread = self.update_thread(&params.thread_id, |thread| {
            if let Some(index) = thread
                .turns
                .iter()
                .position(|turn| turn.id == params.turn_id)
            {
                thread.turns.truncate(index + 1);
                found = true;
            }
        })?;
        if !found {
            return Err(RuntimeError::not_found("turn not found"));
        }
        Ok(value(ThreadResult { thread, turn: None }))
    }

    fn set_thread_active(&mut self, thread_id: &str) -> Result<AppResponse, RuntimeError> {
        let thread = self.update_thread(thread_id, |thread| {
            thread.state = ThreadState::Active;
            thread.archived = false;
        })?;
        self.update_agent_session_state(thread_id, "running")?;
        Ok(value(ThreadResult { thread, turn: None }))
    }

    fn update_thread(
        &mut self,
        thread_id: &str,
        update: impl FnOnce(&mut ThreadRecord),
    ) -> Result<ThreadRecord, RuntimeError> {
        let mut threads = self.thread_records()?;
        let thread = threads
            .iter_mut()
            .find(|thread| thread.id == thread_id)
            .ok_or_else(|| RuntimeError::not_found("thread not found"))?;
        update(thread);
        thread.updated_at = unix_millis();
        let result = thread.clone();
        self.save_thread_records(&threads)?;
        Ok(result)
    }

    pub fn diagnostics_inspect(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.diagnostics_inspect_result()?))
    }

    pub(crate) fn diagnostics_inspect_result(
        &self,
    ) -> Result<DiagnosticsInspectResult, RuntimeError> {
        let skills = self.discover_skills().unwrap_or(SkillListResult {
            skills: Vec::new(),
            truncated: false,
        });
        let plugins = self.discover_plugins().unwrap_or(PluginListResult {
            plugins: Vec::new(),
        });
        let mcp = self.mcp_servers().unwrap_or_default();
        let agent_sessions = self.agent_sessions().unwrap_or_default();
        let channels = self.channels().unwrap_or_default();
        let schedules = self.schedules().unwrap_or_default();
        let sections = vec![
            DiagnosticSection {
                title: "Runtime".to_string(),
                items: vec![
                    diagnostic_item("server", &self.config.server_info.name),
                    diagnostic_item("version", &self.config.server_info.version),
                    diagnostic_item("protocol", &self.config.server_info.protocol_version),
                    diagnostic_item("transport", "stdio/jsonl"),
                    diagnostic_item("api base url", self.api_client.base_url()),
                    diagnostic_item(
                        "run store",
                        &self
                            .config
                            .run_store_path
                            .as_ref()
                            .map(|path| path.display().to_string())
                            .unwrap_or_else(|| "memory".to_string()),
                    ),
                ],
            },
            DiagnosticSection {
                title: "Account".to_string(),
                items: vec![diagnostic_item(
                    "authenticated", // coverage:ignore-line
                    if self.auth_token().ok().flatten().is_some() {
                        "true" // coverage:ignore-line
                    } else {
                        "false"
                    },
                )],
            },
            DiagnosticSection {
                title: "Models".to_string(),
                items: vec![
                    diagnostic_item(
                        "selected",
                        &self
                            .default_model_id()?
                            .unwrap_or_else(|| "default".to_string()),
                    ),
                    diagnostic_item(
                        "ollama recommended",
                        &ollama_memory_recommendation(total_system_memory_bytes())
                            .recommended_model_id,
                    ),
                ],
            },
            DiagnosticSection {
                title: "Extensions".to_string(),
                items: vec![
                    diagnostic_item("skills", &skills.skills.len().to_string()),
                    diagnostic_item("plugins", &plugins.plugins.len().to_string()),
                    diagnostic_item("mcp servers", &mcp.len().to_string()),
                ],
            },
            DiagnosticSection {
                title: "Automation".to_string(),
                items: vec![
                    diagnostic_item("agent sessions", &agent_sessions.len().to_string()),
                    diagnostic_item("channels", &channels.len().to_string()),
                    diagnostic_item("schedules", &schedules.len().to_string()),
                    diagnostic_item("pending prompts", &self.pending_prompts.len().to_string()),
                ],
            },
        ];
        Ok(DiagnosticsInspectResult {
            sections,
            suggestions: vec![
                "Use /agents to inspect or steer background sessions.".to_string(),
                "Use /channel list and /schedule list to audit local automation inputs."
                    .to_string(),
                "Use /context and /memory when behavior looks context-related.".to_string(),
            ],
        })
    }
}

fn unique_thread_id(threads: &[ThreadRecord], now: u64) -> String {
    let base = format!("thread-{now}");
    if !threads.iter().any(|thread| thread.id == base) {
        return base;
    }
    let mut suffix = 2_u64;
    loop {
        let candidate = format!("{base}-{suffix}");
        if !threads.iter().any(|thread| thread.id == candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

fn last_text_item(items: &[ThreadItemRecord]) -> Option<String> {
    items.iter().rev().find_map(|item| {
        item.content
            .get("text")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
    })
}

fn turn_status_for_run(status: &RunStatus) -> TurnStatus {
    match status {
        RunStatus::Queued => TurnStatus::Queued,
        RunStatus::Processing => TurnStatus::InProgress,
        RunStatus::Completed => TurnStatus::Completed,
        RunStatus::Failed => TurnStatus::Failed,
        RunStatus::Canceled => TurnStatus::Interrupted,
    }
}

#[cfg(test)]
#[path = "impl_threads_tests.rs"]
mod tests;
