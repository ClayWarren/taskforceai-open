use crate::protocol::*;

use super::error::RuntimeError;
use super::util::*;

impl super::AppRuntime {
    pub fn channel_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(ChannelListResult {
            channels: self.channels()?,
        }))
    }

    pub fn channel_add(&mut self, params: ChannelAddParams) -> Result<AppResponse, RuntimeError> {
        let name = params.name.trim();
        if name.is_empty() {
            return Err(RuntimeError::invalid_params("channel name is required"));
        }
        let now = unix_millis();
        let channel = ChannelRecord {
            channel_id: format!("channel-{}", now),
            name: name.to_string(),
            kind: params.kind.trim().to_string(),
            enabled: params.enabled,
            target_session_id: params.target_session_id,
            last_message: None,
            created_at: now,
            updated_at: now,
        };
        let mut channels = self.channels()?;
        channels.push(channel.clone());
        self.save_channels(&channels)?;
        Ok(value(ChannelResult {
            channel,
            session: None,
            run: None,
        }))
    }

    pub fn channel_delete(&mut self, params: ChannelIDParams) -> Result<AppResponse, RuntimeError> {
        let mut channels = self.channels()?;
        let before = channels.len();
        channels.retain(|channel| channel.channel_id != params.channel_id);
        if channels.len() == before {
            return Err(RuntimeError::not_found("channel not found"));
        }
        self.save_channels(&channels)?;
        Ok(value(AckResult { ok: true }))
    }

    pub async fn channel_push(
        &mut self,
        params: ChannelPushParams,
    ) -> Result<AppResponse, RuntimeError> {
        let dispatch = params.dispatch;
        let result: ChannelResult = from_value_response(self.channel_push_local(params)?)?;
        if !dispatch {
            return Ok(value(result));
        }

        let Some(session_id) = result.channel.target_session_id.clone() else {
            return Ok(value(result));
        };
        let prompt = result
            .channel
            .last_message
            .clone()
            .unwrap_or_else(|| "Channel event".to_string());
        let response = self
            .agent_session_run(AgentSessionRunParams {
                session_id,
                prompt: Some(prompt),
                model_id: None,
                quick_mode: None,
                autonomous: None,
                computer_use: None,
                use_logged_in_services: None,
                agent_count: None,
                project_id: None,
                attachment_ids: Vec::new(),
            })
            .await?;
        let (run_result, events) = agent_session_run_result_and_events(response)?;
        Ok(AppResponse::WithEvents {
            result: to_value(ChannelResult {
                channel: result.channel,
                session: Some(run_result.session),
                run: Some(run_result.run),
            }),
            events,
        })
    }

    pub(crate) fn channel_push_local(
        &mut self,
        params: ChannelPushParams,
    ) -> Result<AppResponse, RuntimeError> {
        let message = params.message.trim();
        if message.is_empty() {
            return Err(RuntimeError::invalid_params("message is required"));
        }
        let mut channels = self.channels()?;
        let channel = channels
            .iter_mut()
            .find(|channel| channel.channel_id == params.channel_id)
            .ok_or_else(|| RuntimeError::not_found("channel not found"))?;
        if !channel.enabled {
            return Err(RuntimeError::invalid_params("channel is disabled"));
        }
        channel.last_message = Some(message.to_string());
        channel.updated_at = unix_millis();
        let saved = channel.clone();
        if let Some(session_id) = saved.target_session_id.clone() {
            let _ = self.agent_session_message(AgentSessionMessageParams {
                session_id,
                message: message.to_string(),
            })?;
        }
        self.save_channels(&channels)?;
        Ok(value(ChannelResult {
            channel: saved,
            session: None,
            run: None,
        }))
    }

    pub fn schedule_list(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(ScheduleListResult {
            schedules: self.schedules()?,
        }))
    }

    pub fn schedule_add(&mut self, params: ScheduleAddParams) -> Result<AppResponse, RuntimeError> {
        let name = params.name.trim();
        let prompt = params.prompt.trim();
        let cadence = params.cadence.trim();
        if name.is_empty() || prompt.is_empty() || cadence.is_empty() {
            return Err(RuntimeError::invalid_params(
                "schedule name, prompt, and cadence are required",
            ));
        }
        let now = unix_millis();
        let schedule = ScheduleRecord {
            schedule_id: format!("schedule-{}", now),
            name: name.to_string(),
            prompt: prompt.to_string(),
            cadence: cadence.to_string(),
            enabled: params.enabled,
            target_session_id: params.target_session_id,
            next_run_at: None,
            created_at: now,
            updated_at: now,
        };
        let mut schedules = self.schedules()?;
        schedules.push(schedule.clone());
        self.save_schedules(&schedules)?;
        Ok(value(ScheduleResult { schedule }))
    }

    pub fn schedule_delete(
        &mut self,
        params: ScheduleIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        let mut schedules = self.schedules()?;
        let before = schedules.len();
        schedules.retain(|schedule| schedule.schedule_id != params.schedule_id);
        if schedules.len() == before {
            return Err(RuntimeError::not_found("schedule not found"));
        }
        self.save_schedules(&schedules)?;
        Ok(value(AckResult { ok: true }))
    }

    pub fn schedule_enable(
        &mut self,
        params: ScheduleIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.update_schedule_enabled(&params.schedule_id, true)
    }

    pub fn schedule_disable(
        &mut self,
        params: ScheduleIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.update_schedule_enabled(&params.schedule_id, false)
    }

    pub async fn schedule_tick(
        &mut self,
        params: ScheduleTickParams,
    ) -> Result<AppResponse, RuntimeError> {
        let now = params.now.unwrap_or_else(unix_millis);
        let mut schedules = self.schedules()?;
        let mut due = Vec::new();

        for schedule in &mut schedules {
            if !schedule.enabled {
                continue;
            }
            let next_run_at = schedule
                .next_run_at
                .unwrap_or_else(|| schedule.created_at.min(now));
            if next_run_at <= now {
                schedule.next_run_at = Some(next_schedule_run_at(&schedule.cadence, now)?);
                schedule.updated_at = now;
                due.push(schedule.clone());
            }
        }
        self.save_schedules(&schedules)?;

        let mut dispatched = Vec::new();
        for schedule in due {
            let (run, session) = if let Some(session_id) = schedule.target_session_id.clone() {
                let response = self
                    .agent_session_run_with_attachment_policy(
                        AgentSessionRunParams {
                            session_id,
                            prompt: Some(schedule.prompt.clone()),
                            model_id: None,
                            quick_mode: None,
                            autonomous: None,
                            computer_use: None,
                            use_logged_in_services: None,
                            agent_count: None,
                            project_id: None,
                            attachment_ids: Vec::new(),
                        },
                        false,
                    )
                    .await?;
                let result = agent_session_run_result_and_events(response)?.0;
                (result.run, Some(result.session))
            } else {
                let response = self
                    .run_submit_with_attachment_policy(
                        SubmitRunParams {
                            prompt: schedule.prompt.clone(),
                            model_id: None,
                            quick_mode: None,
                            autonomous: None,
                            computer_use: None,
                            computer_use_target: None,
                            use_logged_in_services: None,
                            agent_count: None,
                            project_id: None,
                            attachment_ids: Vec::new(),
                            client_mcp_tools: Vec::new(),
                            research_workflow: None,
                        },
                        false,
                    )
                    .await?;
                let result = submit_run_result_and_events(response)?.0;
                (result.run, None)
            };
            dispatched.push(ScheduleDispatchRecord {
                schedule_id: schedule.schedule_id,
                name: schedule.name,
                run,
                session,
            });
        }

        let next_due_at = self
            .schedules()?
            .into_iter()
            .filter(|schedule| schedule.enabled)
            .filter_map(|schedule| schedule.next_run_at)
            .min();
        Ok(value(ScheduleTickResult {
            dispatched,
            next_due_at,
        }))
    }
}
