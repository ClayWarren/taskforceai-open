use crate::protocol::*;

use super::error::RuntimeError;
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
                    reasoning_effort: params.reasoning_effort,
                    quick_mode: params.quick_mode,
                    autonomous: params.autonomous,
                    computer_use: params.computer_use,
                    computer_use_target: None,
                    use_logged_in_services: params.use_logged_in_services,
                    agent_count: params.agent_count,
                    project_id: params.project_id,
                    attachment_ids: params.attachment_ids,
                    client_mcp_tools: params.client_mcp_tools,
                    private_chat: false,
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
}
