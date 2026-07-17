use super::*;

impl super::super::AppRuntime {
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

        let threads = self.thread_records()?;
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
        self.save_agent_sessions(&sessions)?;
        self.save_thread_record(&imported)?;

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
        self.clear_thread_permission_grants(&params.thread_id);
        if !self.delete_thread_record(&params.thread_id)? {
            return Err(RuntimeError::not_found("thread not found"));
        }
        let mut sessions = self.agent_sessions()?;
        sessions.retain(|session| session.session_id != params.thread_id);
        self.save_agent_sessions(&sessions)?;
        self.remove_thread_settings(&params.thread_id)?;
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

    pub fn thread_compact(
        &mut self,
        params: ThreadCompactParams,
    ) -> Result<AppResponse, RuntimeError> {
        let keep_last_turns = params.keep_last_turns.unwrap_or(8).clamp(1, 100);
        let max_summary_chars = params
            .max_summary_chars
            .unwrap_or(16_000)
            .clamp(256, 100_000);
        let mut thread = self.find_thread_record(&params.thread_id)?;
        if thread
            .turns
            .iter()
            .any(|turn| matches!(turn.status, TurnStatus::Queued | TurnStatus::InProgress))
        {
            return Err(RuntimeError::invalid_params(
                "cannot compact a thread with an active turn",
            ));
        }
        if thread.turns.len() <= keep_last_turns {
            return Err(RuntimeError::invalid_params(
                "thread does not have enough turns to compact",
            ));
        }
        let compacted_turn_count = thread.turns.len() - keep_last_turns;
        let compacted = thread
            .turns
            .drain(..compacted_turn_count)
            .collect::<Vec<_>>();
        let now = unix_millis();
        let turn_id = format!("{}:compaction:{now}", thread.id);
        let summary_item = ThreadItemRecord {
            id: format!("{turn_id}:summary"),
            turn_id: turn_id.clone(),
            item_type: ThreadItemType::Compaction,
            status: ThreadItemStatus::Completed,
            content: serde_json::json!({
                "summary": compacted_turn_summary(&compacted, max_summary_chars),
                "compactedTurnCount": compacted_turn_count,
            }),
            created_at: now,
            updated_at: now,
        };
        thread.turns.insert(
            0,
            TurnRecord {
                id: turn_id,
                thread_id: thread.id.clone(),
                run_id: format!("compaction:{now}"),
                status: TurnStatus::Completed,
                items: vec![summary_item.clone()],
                created_at: now,
                updated_at: now,
            },
        );
        thread.updated_at = now;
        self.save_thread_record(&thread)?;
        self.sync_session_after_compaction(&thread)?;
        Ok(AppResponse::WithEvents {
            result: to_value(ThreadCompactResult {
                thread: thread.clone(),
                compacted_turn_count,
                summary_item,
            }),
            events: vec![AppServerEvent::ThreadUpdated {
                thread: Box::new(thread),
            }],
        })
    }

    pub(super) fn set_thread_active(
        &mut self,
        thread_id: &str,
    ) -> Result<AppResponse, RuntimeError> {
        let thread = self.update_thread(thread_id, |thread| {
            thread.state = ThreadState::Active;
            thread.archived = false;
        })?;
        self.update_agent_session_state(thread_id, "running")?;
        Ok(value(ThreadResult { thread, turn: None }))
    }

    fn sync_session_after_compaction(&mut self, thread: &ThreadRecord) -> Result<(), RuntimeError> {
        let mut sessions = self.agent_sessions()?;
        let session = sessions
            .iter_mut()
            .find(|session| session.session_id == thread.id)
            .ok_or_else(|| RuntimeError::not_found("agent session not found"))?;
        session.run_ids = thread
            .turns
            .iter()
            .filter(|turn| !turn.run_id.starts_with("compaction:"))
            .map(|turn| turn.run_id.clone())
            .collect();
        session.last_message = thread
            .turns
            .iter()
            .rev()
            .find_map(|turn| last_text_item(&turn.items));
        session.updated_at = thread.updated_at;
        self.save_agent_sessions(&sessions)
    }

    pub(super) fn update_thread(
        &mut self,
        thread_id: &str,
        update: impl FnOnce(&mut ThreadRecord),
    ) -> Result<ThreadRecord, RuntimeError> {
        let mut thread = self.find_thread_record(thread_id)?;
        update(&mut thread);
        thread.updated_at = unix_millis();
        let result = thread.clone();
        self.save_thread_record(&thread)?;
        Ok(result)
    }

    pub fn diagnostics_inspect(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.diagnostics_inspect_result()?))
    }

    pub fn diagnostics_submit(
        &self,
        params: DiagnosticsSubmitParams,
    ) -> Result<AppResponse, RuntimeError> {
        let service = params.service.trim();
        let message = params.message.trim();
        if service.is_empty() || message.is_empty() {
            return Err(RuntimeError::invalid_params(
                "service and message are required",
            ));
        }
        let level = params.level.trim().to_ascii_lowercase();
        let details = serde_json::json!({
            "service": service,
            "threadId": params.thread_id,
            "extra": params.extra,
        });
        match level.as_str() {
            "debug" => log::debug!(target: "client_diagnostics", "{message} {details}"),
            "info" => log::info!(target: "client_diagnostics", "{message} {details}"),
            "warn" | "warning" => {
                log::warn!(target: "client_diagnostics", "{message} {details}")
            }
            "error" => log::error!(target: "client_diagnostics", "{message} {details}"),
            _ => {
                return Err(RuntimeError::invalid_params(
                    "level must be debug, info, warn, or error",
                ));
            }
        }
        Ok(value(DiagnosticsSubmitResult {
            accepted: true,
            diagnostic_id: format!("diag-{}", unix_millis()),
        }))
    }

    pub async fn server_request_list(
        &self,
        params: ServerRequestListParams,
    ) -> Result<AppResponse, RuntimeError> {
        let requests = match &self.interaction_broker {
            Some(broker) => broker.pending_requests(params.thread_id.as_deref()).await,
            None => Vec::new(),
        };
        Ok(value(ServerRequestListResult { requests }))
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
