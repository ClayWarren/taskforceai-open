use crate::protocol::*;

use super::error::RuntimeError;
use super::models::{ollama_memory_recommendation, total_system_memory_bytes};
use super::util::*;

impl super::AppRuntime {
    pub fn goal_get(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(GoalGetResult {
            goal: self.goal_record()?,
        }))
    }

    pub fn goal_set(&mut self, params: GoalSetParams) -> Result<AppResponse, RuntimeError> {
        Ok(value(GoalGetResult {
            goal: Some(self.set_goal(&params.objective)?),
        }))
    }

    pub fn goal_pause(&mut self) -> Result<AppResponse, RuntimeError> {
        Ok(value(GoalGetResult {
            goal: self.update_goal_status(GoalStatus::Paused)?,
        }))
    }

    pub fn goal_resume(&mut self) -> Result<AppResponse, RuntimeError> {
        Ok(value(GoalGetResult {
            goal: self.update_goal_status(GoalStatus::Active)?,
        }))
    }

    pub fn goal_clear(&mut self) -> Result<AppResponse, RuntimeError> {
        self.clear_goal()?;
        Ok(value(AckResult { ok: true }))
    }

    pub fn agent_session_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(AgentSessionListResult {
            sessions: self.agent_sessions()?,
        }))
    }

    pub fn agent_session_create(
        &mut self,
        params: AgentSessionCreateParams,
    ) -> Result<AppResponse, RuntimeError> {
        let objective = params.objective.trim();
        if objective.is_empty() {
            return Err(RuntimeError::invalid_params("objective is required")); // coverage:ignore-line
        }
        let now = unix_millis();
        let session = AgentSessionRecord {
            session_id: format!("agent-{}", now),
            title: params
                .title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Agent session")
                .to_string(),
            objective: objective.to_string(),
            state: "running".to_string(),
            source: params
                .source
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("manual")
                .to_string(),
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
        Ok(value(AgentSessionResult { session }))
    }

    pub fn agent_session_get(
        &self,
        params: AgentSessionIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        Ok(value(AgentSessionResult {
            session: self.find_agent_session(&params.session_id)?,
        }))
    }

    pub fn agent_session_pause(
        &mut self,
        params: AgentSessionIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.update_agent_session_state(&params.session_id, "paused")
    }

    pub fn agent_session_resume(
        &mut self,
        params: AgentSessionIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.update_agent_session_state(&params.session_id, "running")
    }

    pub fn agent_session_cancel(
        &mut self,
        params: AgentSessionIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.update_agent_session_state(&params.session_id, "cancelled")
    }

    pub fn agent_session_message(
        &mut self,
        params: AgentSessionMessageParams,
    ) -> Result<AppResponse, RuntimeError> {
        let message = params.message.trim();
        if message.is_empty() {
            return Err(RuntimeError::invalid_params("message is required")); // coverage:ignore-line
        }
        let mut sessions = self.agent_sessions()?;
        let session = sessions
            .iter_mut()
            .find(|session| session.session_id == params.session_id)
            .ok_or_else(|| RuntimeError::not_found("agent session not found"))?;
        session.last_message = Some(message.to_string());
        session.updated_at = unix_millis();
        let saved = session.clone();
        self.save_agent_sessions(&sessions)?;
        Ok(value(AgentSessionResult { session: saved }))
    }

    pub fn agent_session_fork(
        &mut self,
        params: AgentSessionIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        let parent = self.find_agent_session(&params.session_id)?;
        let now = unix_millis();
        let mut fork = parent.clone();
        fork.session_id = format!("agent-{}", now);
        fork.title = format!("{} fork", parent.title);
        fork.parent_session_id = Some(parent.session_id);
        fork.state = "running".to_string();
        fork.run_ids.clear();
        fork.active_run_id = None;
        fork.last_error = None;
        fork.created_at = now;
        fork.updated_at = now;
        let mut sessions = self.agent_sessions()?;
        sessions.push(fork.clone());
        self.save_agent_sessions(&sessions)?;
        Ok(value(AgentSessionResult { session: fork }))
    }

    pub async fn agent_session_run(
        &mut self,
        params: AgentSessionRunParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.agent_session_run_with_attachment_policy(params, true)
            .await
    }

    pub(crate) async fn agent_session_run_with_attachment_policy(
        &mut self,
        params: AgentSessionRunParams,
        include_active_attachments: bool,
    ) -> Result<AppResponse, RuntimeError> {
        let session = self.find_agent_session(&params.session_id)?;
        match session.state.as_str() {
            "paused" => return Err(RuntimeError::invalid_params("agent session is paused")),
            "cancelled" => return Err(RuntimeError::invalid_params("agent session is cancelled")),
            _ => {}
        }

        let prompt = params
            .prompt
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| agent_session_prompt(&session));

        let response = self
            .run_submit_with_attachment_policy(
                SubmitRunParams {
                    prompt,
                    model_id: params.model_id,
                    quick_mode: params.quick_mode,
                    autonomous: params.autonomous,
                    computer_use: params.computer_use,
                    computer_use_target: None,
                    use_logged_in_services: params.use_logged_in_services,
                    agent_count: params.agent_count,
                    project_id: params.project_id,
                    attachment_ids: params.attachment_ids,
                    client_mcp_tools: Vec::new(),
                    research_workflow: None,
                },
                include_active_attachments,
            )
            .await?;
        let (result, events) = submit_run_result_and_events(response)?;
        let session = self.track_agent_session_run(&session.session_id, &result.run)?;
        Ok(AppResponse::WithEvents {
            result: to_value(AgentSessionRunResult {
                session,
                run: result.run,
            }),
            events,
        })
    }

    pub fn thread_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(ThreadListResult {
            threads: self.agent_sessions()?,
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
            .agent_sessions()?
            .iter()
            .any(|session| session.session_id == thread_id)
        {
            return Err(RuntimeError::invalid_params("thread id already exists"));
            // coverage:ignore-line
            // coverage:ignore-line
        }
        let session = AgentSessionRecord {
            session_id: thread_id,
            title: params
                .title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Agent thread")
                .to_string(),
            objective: objective.to_string(),
            state: "running".to_string(),
            source: params
                .source
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("thread")
                .to_string(),
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
        Ok(value(ThreadResult { thread: session }))
    }

    pub fn thread_resume(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        self.agent_thread_state(params.thread_id, "running")
    }

    pub fn thread_archive(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        self.agent_thread_state(params.thread_id, "cancelled")
    }

    pub fn thread_fork(&mut self, params: ThreadIDParams) -> Result<AppResponse, RuntimeError> {
        let session: AgentSessionResult =
            from_value_response(self.agent_session_fork(AgentSessionIDParams {
                session_id: params.thread_id,
            })?)?;
        Ok(value(ThreadResult {
            thread: session.session,
        }))
    }

    pub async fn turn_start(
        &mut self,
        params: TurnStartParams,
    ) -> Result<AppResponse, RuntimeError> {
        let response = self
            .agent_session_run(AgentSessionRunParams {
                session_id: params.thread_id,
                prompt: Some(params.input),
                model_id: params.model_id,
                quick_mode: params.quick_mode,
                autonomous: params.autonomous,
                computer_use: params.computer_use,
                use_logged_in_services: params.use_logged_in_services,
                agent_count: params.agent_count,
                project_id: params.project_id,
                attachment_ids: params.attachment_ids,
            })
            .await?;
        let (result, run_events) = agent_session_run_result_and_events(response)?;
        let thread_id = result.session.session_id.clone();
        let run = result.run.clone();
        let mut events = vec![AppServerEvent::TurnStarted {
            thread_id: thread_id.clone(),
            run: Box::new(run.clone()),
        }];
        events.extend(run_events);
        Ok(AppResponse::WithEvents {
            result: to_value(TurnResult {
                thread: result.session,
                run,
            }),
            events,
        })
    }

    pub fn turn_steer(&mut self, params: TurnSteerParams) -> Result<AppResponse, RuntimeError> {
        let session: AgentSessionResult =
            from_value_response(self.agent_session_message(AgentSessionMessageParams {
                session_id: params.thread_id,
                message: params.input,
            })?)?;
        Ok(value(ThreadResult {
            thread: session.session,
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
        let (run, events) = run_status_result_and_events(self.run_cancel(RunIDParams { run_id })?)?;
        let session: AgentSessionResult =
            from_value_response(self.update_agent_session_state(&params.thread_id, "paused")?)?;
        let run = run.run;
        let events = std::iter::once(AppServerEvent::TurnInterrupted {
            thread_id: session.session.session_id.clone(),
            run: Box::new(run.clone()),
        })
        .chain(events)
        .collect();
        Ok(AppResponse::WithEvents {
            result: to_value(TurnResult {
                thread: session.session,
                run,
            }),
            events,
        })
    }

    fn agent_thread_state(
        &mut self,
        thread_id: String,
        state: &str,
    ) -> Result<AppResponse, RuntimeError> {
        let session: AgentSessionResult =
            from_value_response(self.update_agent_session_state(&thread_id, state)?)?;
        Ok(value(ThreadResult {
            thread: session.session,
        }))
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

fn run_status_result_and_events(
    response: AppResponse,
) -> Result<(RunStatusResult, Vec<AppServerEvent>), RuntimeError> {
    match response {
        AppResponse::WithEvents { result, events } => {
            let result = serde_json::from_value(result)
                .map_err(|err| RuntimeError::storage(err.to_string()))?;
            Ok((result, events)) // coverage:ignore-line
        } // coverage:ignore-line
        // coverage:ignore-start
        AppResponse::Value(result) => {
            let result = serde_json::from_value(result)
                .map_err(|err| RuntimeError::storage(err.to_string()))?;
            Ok((result, Vec::new()))
            // coverage:ignore-end
        }
        AppResponse::Shutdown(_) => Err(RuntimeError::storage("unexpected shutdown response")), // coverage:ignore-line
    }
}
