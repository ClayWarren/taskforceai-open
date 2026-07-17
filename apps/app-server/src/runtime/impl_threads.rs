use crate::protocol::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use super::error::RuntimeError;
use super::models::{ollama_memory_recommendation, total_system_memory_bytes};
use super::util::*;

static NEXT_THREAD_ID: AtomicU64 = AtomicU64::new(1);

mod management;

impl super::AppRuntime {
    pub fn thread_list(&self, params: ThreadListParams) -> Result<AppResponse, RuntimeError> {
        let include_turns = params.include_turns.unwrap_or(true);
        if !has_thread_filters(&params) {
            if let Some(store) = &self.run_store {
                let (threads, next_cursor) = store.list_threads_page(
                    params.cursor.as_deref(),
                    params.limit,
                    include_turns,
                    params.archived,
                )?; // coverage:ignore-line -- LLVM attributes the exercised store result edge to this delimiter.
                return Ok(value(ThreadListResult {
                    threads,
                    next_cursor,
                }));
            }
        }
        let mut threads = self.thread_records()?;
        threads.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        if let Some(archived) = params.archived {
            threads.retain(|thread| thread.archived == archived);
        }
        apply_thread_filters(&mut threads, &params);
        let offset = params
            .cursor
            .as_deref()
            .unwrap_or("0")
            .parse::<usize>()
            .map_err(|_| RuntimeError::invalid_params("invalid thread cursor"))?;
        let limit = params.limit.unwrap_or(50).clamp(1, 200);
        let has_more = threads.len() > offset + limit;
        let mut threads = threads
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect::<Vec<_>>();
        if !include_turns {
            for thread in &mut threads {
                thread.turns.clear();
            }
        }
        Ok(value(ThreadListResult {
            threads,
            next_cursor: has_more.then(|| (offset + limit).to_string()),
        }))
    }

    pub fn thread_children(&self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        self.find_thread_record(&params.thread_id)?;
        let mut threads = self
            .thread_records()?
            .into_iter()
            .filter(|thread| thread.parent_thread_id.as_deref() == Some(params.thread_id.as_str()))
            .collect::<Vec<_>>();
        threads.sort_by_key(|thread| std::cmp::Reverse(thread.updated_at));
        Ok(value(ThreadChildrenResult { threads }))
    }

    pub fn thread_status_list(&self) -> Result<AppResponse, RuntimeError> {
        let statuses = self
            .thread_records()?
            .into_iter()
            .map(|thread| {
                let active_turn = thread.turns.iter().rev().find(|turn| {
                    matches!(turn.status, TurnStatus::Queued | TurnStatus::InProgress)
                });
                ThreadStatusRecord {
                    thread_id: thread.id,
                    state: thread.state,
                    active_turn_id: active_turn.map(|turn| turn.id.clone()),
                    active_run_id: active_turn.map(|turn| turn.run_id.clone()),
                    turn_status: active_turn.map(|turn| turn.status),
                }
            })
            .collect();
        Ok(value(ThreadStatusListResult { statuses }))
    }

    pub fn thread_turns_list(
        &self,
        params: ThreadTurnsListParams,
    ) -> Result<AppResponse, RuntimeError> {
        let include_items = params.include_items.unwrap_or(true);
        let (turns, next_cursor) = if let Some(store) = &self.run_store {
            if store.get_thread(&params.thread_id)?.is_none() {
                return Err(RuntimeError::not_found("thread not found"));
            }
            store.list_thread_turns_page(
                &params.thread_id,
                params.cursor.as_deref(),
                params.limit,
                include_items,
            )? // coverage:ignore-line -- LLVM attributes the exercised store result edge to this delimiter.
        } else {
            let thread = self.find_thread_record(&params.thread_id)?;
            page_turns(
                thread.turns,
                params.cursor.as_deref(),
                params.limit,
                include_items,
            )? // coverage:ignore-line -- LLVM attributes the exercised paging result edge to this delimiter.
        };
        Ok(value(ThreadTurnsListResult { turns, next_cursor }))
    }

    pub fn thread_items_list(
        &self,
        params: ThreadItemsListParams,
    ) -> Result<AppResponse, RuntimeError> {
        let (items, next_cursor) = if let Some(store) = &self.run_store {
            if store.get_thread(&params.thread_id)?.is_none() {
                return Err(RuntimeError::not_found("thread not found"));
            }
            store.list_thread_items_page(
                &params.thread_id,
                params.turn_id.as_deref(),
                params.cursor.as_deref(),
                params.limit,
            )? // coverage:ignore-line -- LLVM attributes the exercised store result edge to this delimiter.
        } else {
            let thread = self.find_thread_record(&params.thread_id)?;
            let items = thread
                .turns
                .into_iter()
                .filter(|turn| params.turn_id.as_ref().is_none_or(|id| id == &turn.id))
                .flat_map(|turn| turn.items)
                .collect();
            page_items(items, params.cursor.as_deref(), params.limit)?
        };
        Ok(value(ThreadItemsListResult { items, next_cursor }))
    }

    pub fn thread_start(&mut self, params: ThreadStartParams) -> Result<AppResponse, RuntimeError> {
        let objective = params.objective.trim();
        let now = unix_millis();
        let thread_id = params
            .thread_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                format!(
                    "agent-{now}-{}",
                    NEXT_THREAD_ID.fetch_add(1, Ordering::Relaxed)
                )
            });
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
        let mut events =
            self.run_lifecycle_hooks(HookEvent::BeforeThreadStart, Some(&thread_id))?;
        let initial_settings = params.settings.clone();
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
        let mut sessions = self.agent_sessions()?;
        sessions.push(session.clone());
        self.save_agent_sessions(&sessions)?;
        self.save_thread_record(&thread)?;
        self.save_initial_thread_settings(&thread.id, initial_settings)?;
        events.extend(self.run_lifecycle_hooks(HookEvent::AfterThreadStart, Some(&thread.id))?);
        Ok(AppResponse::WithEvents {
            result: to_value(ThreadResult { thread, turn: None }),
            events,
        })
    }

    pub fn thread_resume(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        self.set_thread_active(&params.thread_id)
    }

    pub fn thread_archive(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        self.clear_thread_permission_grants(&params.thread_id);
        let thread = self.update_thread(&params.thread_id, |thread| {
            thread.archived = true;
        })?;
        Ok(value(ThreadResult { thread, turn: None }))
    }

    pub fn thread_cancel(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        let thread_id = params.thread_id;
        self.clear_thread_permission_grants(&thread_id);
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
        self.save_thread_record(&fork)?;
        let parent_settings = self.thread_execution_settings(&params.thread_id)?;
        self.persist_turn_settings(&fork.id, parent_settings)?;

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
        mut params: TurnStartParams,
    ) -> Result<AppResponse, RuntimeError> {
        let input = params.input.trim().to_string();
        if input.is_empty() {
            return Err(RuntimeError::invalid_params("input is required"));
        }
        let display_input = params
            .display_input
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&input)
            .to_string();
        let thread = self.find_thread_record(&params.thread_id)?;
        if thread.archived {
            return Err(RuntimeError::invalid_params("thread is archived"));
        }
        if thread.state != ThreadState::Active {
            return Err(RuntimeError::invalid_params("thread is not active"));
        }
        let client_user_message_id =
            normalized_client_message_id(params.client_user_message_id.as_deref())?;
        if let Some(message_id) = client_user_message_id.as_deref() {
            if let Some(turn) = find_turn_by_client_message_id(&thread, message_id) {
                let turn = turn.clone();
                let existing_text = turn
                    .items
                    .iter()
                    .find(|item| item.item_type == ThreadItemType::UserMessage)
                    .and_then(|item| item.content.get("text"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default();
                if existing_text != display_input {
                    return Err(RuntimeError::invalid_params(
                        "clientUserMessageId was already used with different input",
                    ));
                }
                let run = self.get_run(&turn.run_id)?;
                return Ok(value(TurnResult { thread, turn, run }));
            }
        }
        let saved = self.thread_execution_settings(&params.thread_id)?;
        params.model_id = params.model_id.or(saved.model_id);
        params.reasoning_effort = params.reasoning_effort.or(saved.reasoning_effort);
        params.quick_mode = params.quick_mode.or(saved.quick_mode);
        params.autonomous = params.autonomous.or(saved.autonomous);
        params.computer_use = params.computer_use.or(saved.computer_use);
        params.use_logged_in_services = params
            .use_logged_in_services
            .or(saved.use_logged_in_services);
        params.agent_count = params.agent_count.or(saved.agent_count);
        params.project_id = params.project_id.or(saved.project_id);
        params.workspace_root = params.workspace_root.or(saved.workspace_root);
        params.permission_profile = params.permission_profile.or(saved.permission_profile);
        let resolved_settings = ThreadExecutionSettings {
            model_id: params.model_id.clone(),
            reasoning_effort: params.reasoning_effort.clone(),
            quick_mode: params.quick_mode,
            autonomous: params.autonomous,
            computer_use: params.computer_use,
            use_logged_in_services: params.use_logged_in_services,
            agent_count: params.agent_count,
            project_id: params.project_id,
            workspace_root: params.workspace_root.clone(),
            permission_profile: params.permission_profile,
        };
        // An omitted profile preserves the pre-profile behavior for existing clients.
        let permission_profile = params
            .permission_profile
            .unwrap_or(PermissionProfile::FullAccess);
        let (autonomous, computer_use, use_logged_in_services) = permission_flags(
            permission_profile,
            params.autonomous,
            params.computer_use,
            params.use_logged_in_services,
        )?;
        let client_mcp_tools = filter_client_tools(params.client_mcp_tools, permission_profile)?;
        let run_input = if thread.task_mode == TaskMode::Code {
            match params.project_id {
                Some(project_id) => {
                    self.prepare_project_code_input(
                        project_id,
                        &input,
                        params.workspace_root.as_deref(),
                        permission_profile,
                    )
                    .await?
                }
                None => input.clone(),
            }
        } else {
            input.clone()
        };
        let mut hook_events =
            self.run_lifecycle_hooks(HookEvent::BeforeTurnStart, Some(&params.thread_id))?;
        let response = self
            .agent_session_run(AgentSessionRunParams {
                session_id: params.thread_id.clone(),
                prompt: Some(run_input),
                model_id: params.model_id,
                reasoning_effort: params.reasoning_effort,
                quick_mode: params.quick_mode,
                autonomous,
                computer_use,
                use_logged_in_services,
                agent_count: params.agent_count,
                project_id: params.project_id,
                attachment_ids: params.attachment_ids,
                client_mcp_tools,
                permission_profile: Some(permission_profile),
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
            content: serde_json::json!({
                "text": display_input,
                "clientUserMessageId": client_user_message_id,
                "permissionProfile": permission_profile,
                "workspaceRoot": params.workspace_root,
                "projectId": params.project_id,
            }),
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
        self.persist_turn_settings(&thread_id, resolved_settings)?;
        let mut events = Vec::new();
        events.append(&mut hook_events);
        events.extend([
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
            AppServerEvent::ThreadTokenUsageUpdated {
                thread_id: thread_id.clone(),
                usage: self.usage_for_thread(&thread),
            },
            AppServerEvent::TurnDiffUpdated {
                thread_id: thread_id.clone(),
                turn_id: turn.id.clone(),
                diff: Self::diff_for_turn(&turn),
            },
        ]);
        events.extend(run_events);
        events.extend(self.run_lifecycle_hooks(HookEvent::AfterTurnStart, Some(&thread_id))?);
        Ok(AppResponse::WithEvents {
            result: to_value(TurnResult { thread, turn, run }),
            events,
        })
    }

    async fn prepare_project_code_input(
        &mut self,
        project_id: i64,
        input: &str,
        selected_workspace: Option<&str>,
        permission_profile: PermissionProfile,
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
        if let Some(selected_workspace) = selected_workspace
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let selected = PathBuf::from(selected_workspace)
                .canonicalize()
                .map_err(|error| {
                    RuntimeError::invalid_params(format!(
                        "Selected workspace is unavailable: {error}"
                    ))
                })?;
            if !workspace_roots.contains(&selected) {
                return Err(RuntimeError::invalid_params(
                    "Selected workspace is not attached to this project",
                ));
            }
            workspace_roots.retain(|workspace| workspace != &selected);
            workspace_roots.insert(0, selected);
        }

        let mut tools = taskforceai_core::local_coding::filesystem_tool_names();
        if permission_profile == PermissionProfile::ReadOnly {
            tools.retain(|tool| is_read_only_workspace_tool(tool));
        }
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
        let input = params.input.trim().to_string();
        if input.is_empty() {
            return Err(RuntimeError::invalid_params("input is required"));
        }
        let display_input = params
            .display_input
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&input)
            .to_string();
        let active_run_id = self
            .find_agent_session(&params.thread_id)?
            .active_run_id
            .ok_or_else(|| RuntimeError::invalid_params("thread has no active turn"))?;
        if let Some(token) = self.auth_token()? {
            if !active_run_id.starts_with("local_run_") {
                self.api_client
                    .steer_run(&token, &active_run_id, &input)
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
                    content: serde_json::json!({"text": display_input}),
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
            message: input,
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
}

fn has_thread_filters(params: &ThreadListParams) -> bool {
    params
        .search
        .as_ref()
        .is_some_and(|value| !value.trim().is_empty())
        || params
            .workspace_root
            .as_ref()
            .is_some_and(|value| !value.trim().is_empty())
        || params.state.is_some()
        || params.parent_thread_id.is_some()
}

fn apply_thread_filters(threads: &mut Vec<ThreadRecord>, params: &ThreadListParams) {
    if let Some(search) = params
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let search = search.to_lowercase();
        threads.retain(|thread| {
            thread.title.to_lowercase().contains(&search)
                || thread.objective.to_lowercase().contains(&search)
                || thread.turns.iter().any(|turn| {
                    turn.items.iter().any(|item| {
                        item.content
                            .get("text")
                            .and_then(serde_json::Value::as_str)
                            .is_some_and(|text| text.to_lowercase().contains(&search))
                    })
                })
        });
    }
    if let Some(workspace_root) = params
        .workspace_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        threads.retain(|thread| {
            thread.turns.iter().any(|turn| {
                turn.items.iter().any(|item| {
                    item.content
                        .get("workspaceRoot")
                        .and_then(serde_json::Value::as_str)
                        == Some(workspace_root)
                })
            })
        });
    }
    if let Some(state) = params.state {
        threads.retain(|thread| thread.state == state);
    }
    if let Some(parent_thread_id) = params.parent_thread_id.as_deref() {
        threads.retain(|thread| thread.parent_thread_id.as_deref() == Some(parent_thread_id));
    }
}

fn normalized_client_message_id(value: Option<&str>) -> Result<Option<String>, RuntimeError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 200 {
        return Err(RuntimeError::invalid_params(
            "clientUserMessageId cannot exceed 200 characters",
        ));
    }
    Ok(Some(value.to_string()))
}

fn find_turn_by_client_message_id<'a>(
    thread: &'a ThreadRecord,
    message_id: &str,
) -> Option<&'a TurnRecord> {
    thread.turns.iter().find(|turn| {
        turn.items.iter().any(|item| {
            item.item_type == ThreadItemType::UserMessage
                && item
                    .content
                    .get("clientUserMessageId")
                    .and_then(serde_json::Value::as_str)
                    == Some(message_id)
        })
    })
}

type PermissionFlags = (Option<bool>, Option<bool>, Option<bool>);

fn permission_flags(
    profile: PermissionProfile,
    autonomous: Option<bool>,
    computer_use: Option<bool>,
    use_logged_in_services: Option<bool>,
) -> Result<PermissionFlags, RuntimeError> {
    match profile {
        PermissionProfile::ReadOnly => {
            if autonomous == Some(true)
                || computer_use == Some(true)
                || use_logged_in_services == Some(true)
            {
                return Err(RuntimeError::invalid_params(
                    "read_only permission is incompatible with autonomy or computer use",
                ));
            }
            Ok((Some(false), Some(false), Some(false)))
        }
        PermissionProfile::WorkspaceWrite => {
            if computer_use == Some(true) || use_logged_in_services == Some(true) {
                return Err(RuntimeError::invalid_params(
                    "workspace_write permission does not allow computer use",
                ));
            }
            Ok((autonomous, Some(false), Some(false)))
        }
        PermissionProfile::FullAccess => Ok((autonomous, computer_use, use_logged_in_services)),
    }
}

fn filter_client_tools(
    tools: Vec<ClientMcpTool>,
    profile: PermissionProfile,
) -> Result<Vec<ClientMcpTool>, RuntimeError> {
    if profile == PermissionProfile::FullAccess {
        return Ok(tools);
    }
    let forbidden = tools.iter().find(|tool| {
        let name = tool.tool_name.to_ascii_lowercase();
        if profile == PermissionProfile::ReadOnly {
            !is_read_only_workspace_tool(&name)
        } else {
            name.contains("computer") || name.contains("browser") || name.contains("shell")
        }
    });
    if let Some(tool) = forbidden {
        return Err(RuntimeError::invalid_params(format!(
            "tool {} is not allowed by the selected permission profile",
            tool.tool_name
        )));
    }
    Ok(tools)
}

fn is_read_only_workspace_tool(tool: &str) -> bool {
    matches!(
        tool,
        "read_file"
            | "read_multiple_files"
            | "list_directory"
            | "list_directory_with_sizes"
            | "directory_tree"
            | "search_files"
            | "get_file_info"
            | "list_allowed_directories"
    )
}

fn compacted_turn_summary(turns: &[TurnRecord], max_chars: usize) -> String {
    let mut summary = String::new();
    for turn in turns {
        for item in &turn.items {
            let label = match item.item_type {
                ThreadItemType::UserMessage => "User",
                ThreadItemType::AgentMessage => "Assistant",
                ThreadItemType::Reasoning => "Reasoning",
                ThreadItemType::ToolCall
                | ThreadItemType::CommandExecution
                | ThreadItemType::FileChange => "Tool",
                ThreadItemType::Error => "Error",
                _ => continue,
            };
            let text = item
                .content
                .get("text")
                .or_else(|| item.content.get("output"))
                .or_else(|| item.content.get("error"))
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let Some(text) = text else { continue };
            let line = format!("{label}: {text}\n");
            if summary.len().saturating_add(line.len()) > max_chars {
                summary.push_str("[summary truncated]");
                return summary;
            }
            summary.push_str(&line);
        }
    }
    summary
}

fn page_turns(
    mut turns: Vec<TurnRecord>,
    cursor: Option<&str>,
    limit: Option<usize>,
    include_items: bool,
) -> Result<(Vec<TurnRecord>, Option<String>), RuntimeError> {
    let offset = page_offset(cursor)?;
    let limit = limit.unwrap_or(50).clamp(1, 200);
    turns.reverse();
    let has_more = turns.len() > offset + limit;
    let mut turns = turns
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect::<Vec<_>>();
    if !include_items {
        for turn in &mut turns {
            turn.items.clear();
        }
    }
    Ok((turns, has_more.then(|| (offset + limit).to_string())))
}

fn page_items(
    mut items: Vec<ThreadItemRecord>,
    cursor: Option<&str>,
    limit: Option<usize>,
) -> Result<(Vec<ThreadItemRecord>, Option<String>), RuntimeError> {
    let offset = page_offset(cursor)?;
    let limit = limit.unwrap_or(50).clamp(1, 200);
    items.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    let has_more = items.len() > offset + limit;
    Ok((
        items.into_iter().skip(offset).take(limit).collect(),
        has_more.then(|| (offset + limit).to_string()),
    ))
}

fn page_offset(cursor: Option<&str>) -> Result<usize, RuntimeError> {
    cursor
        .filter(|cursor| !cursor.trim().is_empty())
        .map(str::parse::<usize>)
        .transpose()
        .map_err(|_| RuntimeError::invalid_params("invalid page cursor"))
        .map(Option::unwrap_or_default)
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
