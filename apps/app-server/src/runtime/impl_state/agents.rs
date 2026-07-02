use crate::protocol::*;

use crate::runtime::error::RuntimeError;
use crate::runtime::util::*;
use crate::runtime::AGENT_SESSIONS_METADATA_KEY;

impl crate::runtime::AppRuntime {
    pub(crate) fn agent_sessions(&self) -> Result<Vec<AgentSessionRecord>, RuntimeError> {
        load_metadata_vec(self.metadata_value(AGENT_SESSIONS_METADATA_KEY)?)
    }

    pub(crate) fn save_agent_sessions(
        &mut self,
        sessions: &[AgentSessionRecord],
    ) -> Result<(), RuntimeError> {
        self.save_metadata_vec(AGENT_SESSIONS_METADATA_KEY, sessions)
    }

    pub(crate) fn find_agent_session(
        &self,
        session_id: &str,
    ) -> Result<AgentSessionRecord, RuntimeError> {
        self.agent_sessions()?
            .into_iter()
            .find(|session| session.session_id == session_id)
            .ok_or_else(|| RuntimeError::not_found("agent session not found"))
    }

    pub(crate) fn update_agent_session_state(
        &mut self,
        session_id: &str,
        state: &str,
    ) -> Result<AppResponse, RuntimeError> {
        let mut sessions = self.agent_sessions()?;
        let session = sessions
            .iter_mut()
            .find(|session| session.session_id == session_id)
            .ok_or_else(|| RuntimeError::not_found("agent session not found"))?;
        session.state = state.to_string();
        session.updated_at = unix_millis();
        let saved = session.clone();
        self.save_agent_sessions(&sessions)?;
        Ok(value(AgentSessionResult { session: saved }))
    }

    pub(crate) fn track_agent_session_run(
        &mut self,
        session_id: &str,
        run: &RunRecord,
    ) -> Result<AgentSessionRecord, RuntimeError> {
        let mut sessions = self.agent_sessions()?;
        let session = sessions
            .iter_mut()
            .find(|session| session.session_id == session_id)
            .ok_or_else(|| RuntimeError::not_found("agent session not found"))?;
        if !session.run_ids.iter().any(|run_id| run_id == &run.id) {
            session.run_ids.push(run.id.clone());
        }
        session.active_run_id = Some(run.id.clone());
        session.state = agent_session_state_for_run_status(&run.status).to_string();
        session.last_error = run.error.clone();
        session.updated_at = run.updated_at;
        let saved = session.clone();
        self.save_agent_sessions(&sessions)?;
        Ok(saved)
    }

    pub(crate) fn update_agent_session_for_run(
        &mut self,
        run: &RunRecord,
    ) -> Result<(), RuntimeError> {
        let mut sessions = self.agent_sessions()?;
        let mut changed = false;
        for session in &mut sessions {
            let owns_run = session.active_run_id.as_deref() == Some(run.id.as_str())
                || session.run_ids.iter().any(|run_id| run_id == &run.id);
            if !owns_run {
                continue;
            }
            session.state = agent_session_state_for_run_status(&run.status).to_string();
            if run.status != RunStatus::Queued && run.status != RunStatus::Processing {
                session.active_run_id = None;
            } else {
                session.active_run_id = Some(run.id.clone());
            }
            session.last_error = run.error.clone();
            session.updated_at = run.updated_at;
            changed = true;
        }
        if changed {
            self.save_agent_sessions(&sessions)?;
        }
        Ok(())
    }
}
