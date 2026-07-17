use crate::api::{
    ApiClientError, ApiCreateProjectRequest, ApiSubmitMcpServer, ApiSubmitRunRequest,
};
use crate::protocol::*;
use crate::runtime::approval::is_new_approval;
use serde_json::json;
use std::collections::BTreeMap;
use std::time::Duration;
use taskforceai_core::models as core_models;

use super::error::RuntimeError;
use super::impl_state::log_runtime;
use super::models::is_ollama_model_id;
use super::orchestration::*;
use super::platform::{
    allowed_attachment_mime_type, attachment_size_limit, detect_attachment_mime_type,
    expand_user_path,
};
use super::records::validate_pending_prompt_record;
use super::util::*;
use super::util::{MAX_PENDING_ATTACHMENTS, MAX_VIDEO_SIZE};
use super::PROJECT_WORKSPACES_METADATA_KEY;

mod attachments_projects;

const MAX_REMOTE_RUN_RESUME_AGE_MS: u64 = 6 * 60 * 60 * 1000;
const IMAGE_GENERATION_MODEL_ID: &str = "google/gemini-2.5-flash-image";
const VIDEO_GENERATION_MODEL_ID: &str = "xai/grok-imagine-video-1.5";

struct GeneratedMediaRoute {
    model_id: &'static str,
}

struct GeneratedMediaRouteRule {
    model_id: &'static str,
    requires_attachments: bool,
    subject_words: &'static str,
    action_words: &'static str,
    attachment_phrases: &'static str,
}

impl GeneratedMediaRouteRule {
    fn matches(&self, prompt: &str, has_attachments: bool) -> bool {
        if self.requires_attachments && !has_attachments {
            return false;
        }

        (has_any_word(prompt, self.subject_words) && has_any_word(prompt, self.action_words))
            || (has_attachments && contains_any_phrase(prompt, self.attachment_phrases))
    }
}

const GENERATED_MEDIA_ROUTE_RULES: &[GeneratedMediaRouteRule] = &[
    GeneratedMediaRouteRule {
        model_id: VIDEO_GENERATION_MODEL_ID,
        requires_attachments: true,
        subject_words: "video videos clip clips shorts reel reels animation animations movie movies trailer trailers storyboard storyboards",
        action_words: "generate create make animate render produce edit transform turn convert",
        attachment_phrases: "animate,motion,lip-sync,lip sync,add audio,voiceover",
    },
    GeneratedMediaRouteRule {
        model_id: IMAGE_GENERATION_MODEL_ID,
        requires_attachments: false,
        subject_words: "image images picture pictures photo photos illustration illustrations artwork logo logos avatar avatars icon icons wallpaper wallpapers poster posters sticker stickers meme memes",
        action_words: "generate create make draw design illustrate render produce craft",
        attachment_phrases: "edit,modify,transform,restyle,retouch,upscale,enhance,recolor,remove background",
    },
];

impl super::AppRuntime {
    pub fn resume_remote_run_streams(&self) -> usize {
        let now = unix_millis();
        let runs = self
            .runs
            .values()
            .filter(|run| should_resume_remote_stream(run, now))
            .cloned()
            .collect::<Vec<_>>();
        if runs.is_empty() {
            return 0;
        }

        let Some(token) = self.auth_token().ok().flatten() else {
            return 0;
        };

        for run in &runs {
            self.spawn_remote_stream_worker(token.clone(), run.clone(), None);
        }
        runs.len()
    }

    pub async fn run_submit(
        &mut self,
        params: SubmitRunParams,
    ) -> Result<AppResponse, RuntimeError> {
        self.run_submit_with_attachment_policy(params, true).await
    }

    pub(crate) async fn run_submit_with_attachment_policy(
        &mut self,
        params: SubmitRunParams,
        include_active_attachments: bool,
    ) -> Result<AppResponse, RuntimeError> {
        self.run_submit_with_attachment_policy_and_permission(
            params,
            include_active_attachments,
            None,
        )
        .await
    }

    pub(crate) async fn run_submit_with_attachment_policy_and_permission(
        &mut self,
        params: SubmitRunParams,
        include_active_attachments: bool,
        permission_profile: Option<PermissionProfile>,
    ) -> Result<AppResponse, RuntimeError> {
        let prompt = params.prompt.trim();
        if prompt.is_empty() {
            return Err(RuntimeError::invalid_params("prompt is required"));
        }

        let private_chat = params.private_chat;
        let has_attachments = !params.attachment_ids.is_empty()
            || (include_active_attachments && !self.active_attachments.is_empty());
        let requested_model_id = params.model_id;
        let reasoning_effort = params
            .reasoning_effort
            .map(|effort| effort.trim().to_ascii_lowercase())
            .filter(|effort| !effort.is_empty());
        let generated_media_route = if requested_model_id.is_none() {
            resolve_generated_media_route(prompt, has_attachments)
        } else {
            None
        };
        let model_id = match (generated_media_route.as_ref(), requested_model_id) {
            (Some(route), _) => Some(route.model_id.to_string()),
            (None, Some(model_id)) => Some(model_id),
            (None, None) => self.default_model_id()?,
        };
        let generated_media = generated_media_route.is_some();
        let reasoning_effort = if generated_media {
            None
        } else {
            reasoning_effort
        };
        if let Some(effort) = reasoning_effort.as_deref() {
            let selected_model = model_id.as_deref().unwrap_or_default();
            let Some(config) = core_models::reasoning_effort_config(selected_model) else {
                return Err(RuntimeError::invalid_params(format!(
                    "model {selected_model:?} does not support configurable reasoning effort"
                )));
            };
            if !config.levels.contains(&effort) {
                return Err(RuntimeError::invalid_params(format!(
                    "reasoning effort {effort:?} is not supported by model {selected_model:?}"
                )));
            }
        }
        let quick_mode = if generated_media {
            true
        } else {
            params.quick_mode.unwrap_or(self.quick_mode_enabled()?)
        };
        if permission_profile == Some(PermissionProfile::ReadOnly)
            && params.autonomous == Some(true)
        {
            return Err(RuntimeError::invalid_params(
                "read_only permission does not allow autonomous execution",
            ));
        }
        if permission_profile.is_some_and(|profile| profile != PermissionProfile::FullAccess)
            && params.computer_use == Some(true)
        {
            return Err(RuntimeError::invalid_params(
                "selected permission profile does not allow computer use",
            ));
        }
        let autonomous =
            if generated_media || permission_profile == Some(PermissionProfile::ReadOnly) {
                false
            } else {
                params.autonomous.unwrap_or(self.autonomous_enabled()?)
            };
        let stored_computer_use = self.computer_use_enabled()?;
        let computer_use = if generated_media
            || permission_profile.is_some_and(|profile| profile != PermissionProfile::FullAccess)
        {
            false
        } else {
            resolve_computer_use(params.computer_use, stored_computer_use)
        };
        let computer_use_target = if computer_use {
            params
                .computer_use_target
                .unwrap_or(ComputerUseTarget::Virtual)
        } else {
            ComputerUseTarget::Virtual
        };
        if computer_use_target == ComputerUseTarget::Local {
            return Err(RuntimeError::invalid_params(
                "local Computer Use requires an authorized desktop capability",
            ));
        }
        log_runtime(
            "info",
            "computer use mode resolved",
            json!({
                "param": params.computer_use,
                "stored": stored_computer_use,
                "resolved": computer_use,
                "target": computer_use_target.as_str()
            }),
        );
        let use_logged_in_services = computer_use && params.use_logged_in_services.unwrap_or(false);
        let agent_count = if generated_media {
            Some(1)
        } else {
            params.agent_count
        };
        let orchestration = self.orchestration_config()?;
        let mcp_servers =
            filter_mcp_servers_for_permission(self.mcp_servers()?, permission_profile);
        let api_mcp_servers = api_submit_mcp_servers(&mcp_servers);
        let attachment_ids = if params.attachment_ids.is_empty() && include_active_attachments {
            self.active_attachments
                .iter()
                .map(|attachment| attachment.id.clone())
                .collect::<Vec<_>>()
        } else {
            params.attachment_ids
        };

        let now = unix_millis();
        let run = RunRecord {
            id: self.next_run_id(),
            prompt: prompt.to_string(),
            model_id,
            project_id: match params.project_id {
                Some(project_id) => Some(project_id),
                None => self.active_project_id()?,
            },
            status: RunStatus::Queued,
            output: None,
            error: None,
            created_at: now,
            updated_at: now,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        };
        let token = self.auth_token()?;
        let run = if let Some(token) = token.as_deref() {
            let submitted = match self
                .api_client
                .submit_run(
                    token,
                    ApiSubmitRunRequest {
                        prompt: prompt.to_string(),
                        model_id: run.model_id.clone(),
                        reasoning_effort: reasoning_effort.clone(),
                        quick_mode,
                        autonomous,
                        computer_use,
                        computer_use_target: computer_use
                            .then(|| computer_use_target.as_str().to_string()),
                        use_logged_in_services,
                        agent_count,
                        project_id: run.project_id,
                        attachment_ids: attachment_ids.clone(),
                        client_mcp_tools: filter_client_mcp_tools_for_permission(
                            params.client_mcp_tools,
                            permission_profile,
                        )?
                        .into_iter()
                        .map(api_submit_mcp_tool)
                        .collect(),
                        role_models: remote_orchestration_role_models(&orchestration),
                        budget: orchestration.budget,
                        mcp_servers: api_mcp_servers,
                        private_chat: params.private_chat,
                        research_workflow: params.research_workflow.clone(),
                        permission_profile,
                    },
                )
                .await
            {
                Ok(submitted) => submitted,
                Err(err) => {
                    return self.failed_remote_submit_response(
                        run,
                        private_chat,
                        reasoning_effort,
                        err,
                    )
                }
            };
            RunRecord {
                id: submitted.task_id,
                status: RunStatus::Processing,
                ..run
            }
        } else {
            run
        };
        if private_chat {
            self.private_run_ids.insert(run.id.clone());
        }
        self.runs.insert(run.id.clone(), run.clone());
        self.persist_run(&run)?;
        self.persist_run_conversation(&run)?;
        if include_active_attachments {
            self.active_attachments.clear();
        }
        if let Some(token) = token {
            self.spawn_remote_stream_worker(
                token,
                run.clone(),
                hybrid_local_reviewer(&orchestration, &self.config.ollama_base_url),
            );
        } else if run.model_id.as_deref().is_some_and(is_ollama_model_id) {
            self.spawn_ollama_run_worker(run.clone()); // coverage:ignore-line
        } else {
            self.spawn_placeholder_run_worker(run.clone());
        }

        Ok(AppResponse::WithEvents {
            result: to_value(SubmitRunResult { run: run.clone() }),
            events: vec![AppServerEvent::RunUpdated { run: Box::new(run) }],
        })
    }

    pub fn run_status(&self, params: RunIDParams) -> Result<AppResponse, RuntimeError> {
        let run = self.get_run(&params.run_id)?;
        Ok(value(RunStatusResult { run }))
    }

    pub fn run_cancel(&mut self, params: RunIDParams) -> Result<AppResponse, RuntimeError> {
        let current = self
            .runs
            .get(&params.run_id)
            .ok_or_else(|| RuntimeError::not_found("run not found"))?;
        if matches!(current.status, RunStatus::Completed | RunStatus::Failed) {
            return Err(RuntimeError::invalid_params(
                "terminal runs cannot be canceled",
            ));
        }
        if current.status == RunStatus::Canceled {
            return Ok(AppResponse::WithEvents {
                result: to_value(RunStatusResult {
                    run: current.clone(),
                }),
                events: Vec::new(),
            });
        }
        let token = self.auth_token().ok().flatten();
        let now = unix_millis();
        let run = self
            .runs
            .get_mut(&params.run_id)
            .expect("run existence checked above");
        let should_cancel_remote = token.is_some() && !run.id.starts_with("local_run_");
        let remote_run_id = run.id.clone();

        run.status = RunStatus::Canceled;
        run.updated_at = now;
        let run = run.clone();
        self.persist_run(&run)?;
        self.update_agent_session_for_run(&run)?;

        if should_cancel_remote {
            let api_client = self.api_client.clone();
            let token = token.expect("checked above");
            tokio::spawn(async move {
                if let Err(err) = api_client.cancel_run(&token, &remote_run_id).await {
                    // coverage:ignore-start
                    log_runtime(
                        "warn",
                        "remote run cancel failed",
                        json!({ "runId": remote_run_id, "error": err.to_string() }),
                    );
                    // coverage:ignore-end
                }
            });
        }

        Ok(AppResponse::WithEvents {
            result: to_value(RunStatusResult { run: run.clone() }),
            events: vec![AppServerEvent::RunUpdated { run: Box::new(run) }],
        })
    }

    pub fn run_delete(&mut self, params: RunIDParams) -> Result<AppResponse, RuntimeError> {
        let Some(run) = self.runs.get(&params.run_id) else {
            return Err(RuntimeError::not_found("run not found"));
        };
        if !matches!(
            run.status,
            RunStatus::Completed | RunStatus::Failed | RunStatus::Canceled
        ) {
            self.run_cancel(params.clone())?;
        }
        self.cancel_run_interactions(&params.run_id)?;
        self.runs.remove(&params.run_id);
        self.private_run_ids.remove(&params.run_id);
        if let Some(store) = &self.run_store {
            store.delete(&params.run_id)?; // coverage:ignore-line
        }

        Ok(AppResponse::WithEvents {
            result: to_value(AckResult { ok: true }),
            events: vec![AppServerEvent::RunDeleted {
                run_id: params.run_id,
            }],
        })
    }

    pub fn pending_prompt_list(&self) -> AppResponse {
        let prompts = self.pending_prompts.values().cloned().collect::<Vec<_>>();
        value(PendingPromptListResult { prompts })
    }

    pub fn pending_prompt_add(
        &mut self,
        prompt: PendingPromptRecord,
    ) -> Result<AppResponse, RuntimeError> {
        validate_pending_prompt_record(&prompt)?;
        self.upsert_pending_prompt(prompt.clone())?;
        Ok(value(PendingPromptResult { prompt }))
    }

    pub fn pending_prompt_delete(
        &mut self,
        params: PendingPromptIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        let id = params.pending_prompt_id.trim(); // coverage:ignore-line
        if id.is_empty() {
            return Err(RuntimeError::invalid_params("pendingPromptId is required"));
            // coverage:ignore-line
        }
        self.pending_prompts.remove(id);
        if let Some(store) = &self.run_store {
            store.delete_pending_prompt(id)?;
        }
        Ok(value(AckResult { ok: true }))
    }

    pub async fn pending_prompt_replay(&mut self) -> Result<AppResponse, RuntimeError> {
        let Some(prompt) = self
            .pending_prompts // coverage:ignore-line
            .values()
            .find(|prompt| {
                matches!(
                    // coverage:ignore-line
                    prompt.status,
                    PendingPromptStatus::Queued
                        | PendingPromptStatus::Pending
                        | PendingPromptStatus::Failed
                )
            })
            .cloned()
        else {
            return Ok(value(PendingPromptReplayResult {
                attempted: false,
                prompt: None,
                run: None,
                remaining: self.pending_prompts.len(),
                message: "No queued pending prompts to replay.".to_string(),
            }));
        };

        let mut claimed = prompt.clone();
        claimed.status = PendingPromptStatus::Pending;
        claimed.updated_at = unix_millis();
        self.upsert_pending_prompt(claimed.clone())?;

        let response = match self
            .run_submit(SubmitRunParams {
                prompt: prompt.prompt.clone(),
                model_id: prompt.model_id.clone(),
                reasoning_effort: prompt.reasoning_effort.clone(),
                quick_mode: None,
                autonomous: None,
                computer_use: None,
                computer_use_target: None,
                use_logged_in_services: None,
                agent_count: None,
                project_id: prompt.project_id,
                attachment_ids: Vec::new(),
                client_mcp_tools: Vec::new(),
                private_chat: false,
                research_workflow: None,
            })
            .await
        {
            Ok(response) => response,
            Err(err) => {
                let mut failed = claimed;
                failed.status = PendingPromptStatus::Failed;
                failed.retry_count += 1;
                failed.last_error = Some(err.to_string());
                failed.updated_at = unix_millis();
                self.upsert_pending_prompt(failed.clone())?;
                return Ok(value(PendingPromptReplayResult {
                    attempted: true,
                    prompt: Some(failed),
                    run: None,
                    remaining: self.pending_prompts.len(),
                    message: "Pending prompt replay failed and remains queued.".to_string(),
                }));
            }
        };

        let (result, events) = submit_run_result_and_events(response)?;
        let run = result.run;

        if run.status == RunStatus::Failed {
            let mut failed = claimed;
            failed.status = PendingPromptStatus::Failed;
            failed.retry_count += 1;
            failed.last_error = run.error.clone();
            failed.updated_at = unix_millis(); // coverage:ignore-line
            self.upsert_pending_prompt(failed.clone())?;
            let duplicate_id = format!("pending_{}", run.id); // coverage:ignore-line
            if duplicate_id != failed.id {
                self.pending_prompts.remove(&duplicate_id);
                if let Some(store) = &self.run_store {
                    store.delete_pending_prompt(&duplicate_id)?; // coverage:ignore-line
                }
            } // coverage:ignore-line
            return Ok(AppResponse::WithEvents {
                result: to_value(PendingPromptReplayResult {
                    attempted: true,
                    prompt: Some(failed),
                    run: Some(run),
                    remaining: self.pending_prompts.len(),
                    message: "Pending prompt replay failed and remains queued.".to_string(),
                }),
                events, // coverage:ignore-line
            });
        }

        self.pending_prompts.remove(&prompt.id);
        if let Some(store) = &self.run_store {
            store.delete_pending_prompt(&prompt.id)?; // coverage:ignore-line
        }
        Ok(AppResponse::WithEvents {
            result: to_value(PendingPromptReplayResult {
                attempted: true,
                prompt: Some(prompt),
                run: Some(run),
                remaining: self.pending_prompts.len(),
                message: "Pending prompt replayed.".to_string(),
            }),
            events,
        })
    }

    pub fn context_summary(&self) -> AppResponse {
        value(self.context_summary_result())
    }

    pub fn memory_summary(&self) -> AppResponse {
        value(self.memory_summary_result())
    }

    pub fn apply_event(
        &mut self,
        event: AppServerEvent,
    ) -> Result<Vec<AppServerEvent>, RuntimeError> {
        let mut events = vec![event.clone()];
        match &event {
            AppServerEvent::RunUpdated { run } => {
                let Some(current) = self.runs.get(&run.id) else {
                    return Ok(Vec::new());
                };
                if current.status == RunStatus::Canceled && run.status != RunStatus::Canceled {
                    return Ok(vec![AppServerEvent::RunUpdated {
                        run: Box::new(current.clone()),
                    }]);
                }
                let previous_approval = current.pending_approval.clone();
                if is_new_approval(previous_approval.as_ref(), run.pending_approval.as_ref()) {
                    self.spawn_run_approval_interaction(run)?;
                }
                self.runs.insert(run.id.clone(), (**run).clone());
                self.persist_run(run)?;
                self.persist_run_conversation(run)?;
                if run.status == RunStatus::Completed {
                    self.persist_assistant_message(run)?;
                }
                self.update_agent_session_for_run(run)?;
                events.extend(self.update_thread_for_run(run)?);
                if matches!(
                    run.status,
                    RunStatus::Completed | RunStatus::Failed | RunStatus::Canceled
                ) {
                    self.cancel_run_interactions(&run.id)?;
                }
                for workflow_run in self.update_workflow_runs_for_run(run)? {
                    events.push(AppServerEvent::WorkflowRunUpdated {
                        run: Box::new(workflow_run),
                    }); // coverage:ignore-line
                }
            }
            AppServerEvent::RunDeleted { run_id } => {
                // coverage:ignore-line
                self.runs.remove(run_id); // coverage:ignore-line
                self.private_run_ids.remove(run_id); // coverage:ignore-line
                if let Some(store) = &self.run_store {
                    store.delete(run_id)?; // coverage:ignore-line
                }
            }
            // coverage:ignore-start
            AppServerEvent::TurnStarted { .. }
            | AppServerEvent::TurnInterrupted { .. }
            | AppServerEvent::TurnUpdated { .. }
            | AppServerEvent::TurnCompleted { .. }
            | AppServerEvent::ItemStarted { .. }
            | AppServerEvent::ItemUpdated { .. }
            | AppServerEvent::ItemCompleted { .. }
            | AppServerEvent::ItemDelta { .. }
            | AppServerEvent::PlanUpdated { .. }
            | AppServerEvent::ThreadUpdated { .. }
            | AppServerEvent::McpStartupStatusUpdated { .. }
            | AppServerEvent::McpOAuthCompleted { .. }
            | AppServerEvent::ThreadTokenUsageUpdated { .. }
            | AppServerEvent::TurnDiffUpdated { .. }
            | AppServerEvent::ProcessOutputDelta { .. }
            | AppServerEvent::ProcessExited { .. }
            | AppServerEvent::FsChanged { .. }
            | AppServerEvent::HookCompleted { .. }
            | AppServerEvent::ConfigReloaded { .. } => {}
            AppServerEvent::WorkflowRunUpdated { .. } => {} // coverage:ignore-end
            AppServerEvent::ServerRequest { .. } => {}
        }

        Ok(events)
    }

    fn spawn_run_approval_interaction(&self, run: &RunRecord) -> Result<(), RuntimeError> {
        let (Some(approval), Some(token)) = (run.pending_approval.clone(), self.auth_token()?)
        else {
            return Ok(());
        };
        let thread_id = self
            .agent_sessions()?
            .into_iter()
            .find(|session| {
                session.active_run_id.as_deref() == Some(run.id.as_str())
                    || session.run_ids.iter().any(|run_id| run_id == &run.id)
            })
            .map(|session| session.session_id)
            .unwrap_or_else(|| run.id.clone());
        let signature = Self::approval_signature(&approval);
        let api_client = self.api_client.clone();
        let run_id = run.id.clone();
        if self.has_permission_grant(&thread_id, &signature) {
            tokio::spawn(async move {
                if let Err(err) = api_client
                    .respond_to_run_approval(&token, &run_id, true, None, None)
                    .await
                {
                    log::warn!(target: "app_server", "Failed to forward session approval for run {run_id}: {err}");
                }
            });
            return Ok(());
        }
        let Some(broker) = self.interaction_broker.clone() else {
            return Ok(());
        };
        let item_id = approval
            .get("approvalId")
            .or_else(|| approval.get("approval_id"))
            .or_else(|| approval.get("id"))
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&run.id)
            .to_string();
        let reason = approval
            .get("permission")
            .and_then(serde_json::Value::as_str)
            .map(|permission| format!("Allow {permission}"));
        let granted_thread_id = thread_id.clone();
        let granted_permissions = approval.clone();
        let request = ServerRequestPayload::PermissionApproval(PermissionApprovalParams {
            context: InteractionContext {
                thread_id,
                turn_id: Some(run.id.clone()),
            },
            item_id,
            reason,
            permissions: approval,
        });
        let grants = std::sync::Arc::clone(&self.approval_grants);
        tokio::spawn(async move {
            let response = broker.request(request, Duration::from_secs(30 * 60)).await;
            let (decision, approved, result, error) = match response {
                Ok(value) => match serde_json::from_value::<ApprovalResponse>(value.clone()) {
                    Ok(ApprovalResponse { decision }) => {
                        let approved = matches!(
                            decision,
                            ApprovalDecision::Accept | ApprovalDecision::AcceptForSession
                        );
                        (Some(decision), approved, value.get("result").cloned(), None)
                    }
                    Err(err) => (
                        None,
                        false,
                        None,
                        Some(format!("invalid approval response: {err}")),
                    ),
                },
                // coverage:ignore-start -- cancellation and transport failures are covered by the interaction broker tests.
                Err(crate::interactions::InteractionError::Canceled) => return,
                Err(err) => (None, false, None, Some(err.to_string())),
                // coverage:ignore-end
            };
            let approval_result = api_client
                .respond_to_run_approval(&token, &run_id, approved, result, error)
                .await;
            match approval_result {
                Ok(()) if matches!(decision, Some(ApprovalDecision::AcceptForSession)) => {
                    Self::save_permission_grant(
                        &grants,
                        granted_thread_id,
                        signature,
                        granted_permissions,
                    );
                }
                Ok(()) => {}
                Err(err) => {
                    log::warn!(target: "app_server", "Failed to forward approval for run {run_id}: {err}");
                    // coverage:ignore-line -- diagnostics-only API failure path.
                }
            }
        });
        Ok(())
    }

    fn cancel_run_interactions(&self, run_id: &str) -> Result<(), RuntimeError> {
        let Some(broker) = self.interaction_broker.clone() else {
            return Ok(());
        };
        let thread_id = self
            .agent_sessions()?
            .into_iter()
            .find(|session| session.run_ids.iter().any(|owned| owned == run_id))
            .map(|session| session.session_id)
            .unwrap_or_else(|| run_id.to_string());
        tokio::spawn(async move {
            broker.cancel_thread(&thread_id).await;
        });
        Ok(())
    }

    fn failed_remote_submit_response(
        &mut self,
        run: RunRecord,
        private_chat: bool,
        reasoning_effort: Option<String>,
        err: ApiClientError,
    ) -> Result<AppResponse, RuntimeError> {
        let auth_failed = err.is_unauthorized();
        if auth_failed {
            self.set_auth_token(None)?;
        }

        let mut failed = run;
        failed.status = RunStatus::Failed;
        failed.error = Some(if auth_failed {
            "login required. Please sign in again.".to_string()
        } else {
            format!("api error: {}", err.detailed_message())
        });
        failed.updated_at = unix_millis();
        if private_chat {
            self.private_run_ids.insert(failed.id.clone());
        }
        self.runs.insert(failed.id.clone(), failed.clone());
        if !private_chat {
            self.persist_run(&failed)?;
            self.persist_run_conversation(&failed)?;
            if !auth_failed {
                self.queue_pending_prompt(&failed, failed.error.clone(), reasoning_effort)?;
            }
        }
        Ok(AppResponse::WithEvents {
            result: to_value(SubmitRunResult {
                run: failed.clone(),
            }),
            events: vec![AppServerEvent::RunUpdated {
                run: Box::new(failed),
            }],
        })
    }
}

fn normalize_workspace_roots(workspace_roots: Vec<String>) -> Vec<String> {
    workspace_roots
        .into_iter()
        .map(|root| root.trim().to_string())
        .filter(|root| !root.is_empty())
        .fold(Vec::new(), |mut roots, root| {
            if !roots.contains(&root) {
                roots.push(root);
            }
            roots
        })
}

fn should_resume_remote_stream(run: &RunRecord, now: u64) -> bool {
    matches!(run.status, RunStatus::Queued | RunStatus::Processing)
        && is_recent_remote_run(run, now)
        && is_remote_task_id(&run.id)
}

fn is_recent_remote_run(run: &RunRecord, now: u64) -> bool {
    now.saturating_sub(run.updated_at) <= MAX_REMOTE_RUN_RESUME_AGE_MS
}

fn is_remote_task_id(id: &str) -> bool {
    let Some(suffix) = id.strip_prefix("task_") else {
        return false;
    };
    suffix.len() >= 32 && suffix.contains('-')
}

fn api_submit_mcp_servers(servers: &[McpServerRecord]) -> Vec<ApiSubmitMcpServer> {
    servers.iter().map(api_submit_mcp_server).collect()
}

fn filter_mcp_servers_for_permission(
    mut servers: Vec<McpServerRecord>,
    permission_profile: Option<PermissionProfile>,
) -> Vec<McpServerRecord> {
    let Some(permission_profile) = permission_profile else {
        return servers;
    };
    for server in &mut servers {
        server
            .tools
            .retain(|tool| permission_allows_tool(tool, permission_profile));
    }
    servers
}

fn filter_client_mcp_tools_for_permission(
    tools: Vec<ClientMcpTool>,
    permission_profile: Option<PermissionProfile>,
) -> Result<Vec<ClientMcpTool>, RuntimeError> {
    let Some(permission_profile) = permission_profile else {
        return Ok(tools);
    };
    if let Some(tool) = tools
        .iter()
        .find(|tool| !permission_allows_tool(&tool.tool_name, permission_profile))
    {
        return Err(RuntimeError::invalid_params(format!(
            "tool {} is not allowed by the selected permission profile",
            tool.tool_name
        )));
    }
    Ok(tools)
}

fn permission_allows_tool(tool: &str, permission_profile: PermissionProfile) -> bool {
    if permission_profile == PermissionProfile::FullAccess {
        return true;
    }
    let tool = tool.to_ascii_lowercase();
    if permission_profile == PermissionProfile::ReadOnly {
        return matches!(
            tool.as_str(),
            "read_file"
                | "read_multiple_files"
                | "list_directory"
                | "list_directory_with_sizes"
                | "directory_tree"
                | "search_files"
                | "get_file_info"
                | "list_allowed_directories"
        ) || ["read", "list", "search", "get", "inspect", "status"]
            .iter()
            .any(|prefix| tool.starts_with(prefix));
    }
    ![
        "computer", "browser", "shell", "terminal", "process", "exec",
    ]
    .iter()
    .any(|fragment| tool.contains(fragment))
}

fn resolve_computer_use(param: Option<bool>, stored: bool) -> bool {
    stored || param.unwrap_or(false)
}

fn resolve_generated_media_route(
    prompt: &str,
    has_attachments: bool,
) -> Option<GeneratedMediaRoute> {
    let normalized = prompt.to_lowercase();
    GENERATED_MEDIA_ROUTE_RULES
        .iter()
        .find(|rule| rule.matches(&normalized, has_attachments))
        .map(|rule| GeneratedMediaRoute {
            model_id: rule.model_id,
        })
}

fn has_any_word(text: &str, words: &str) -> bool {
    words.split_whitespace().any(|word| has_word(text, word))
}

fn has_word(text: &str, word: &str) -> bool {
    text.split(|ch: char| !ch.is_alphanumeric())
        .any(|part| part == word)
}

fn contains_any_phrase(text: &str, phrases: &str) -> bool {
    phrases.split(',').any(|phrase| text.contains(phrase))
}

#[cfg(test)]
#[path = "impl_runs_tests.rs"]
mod resume_tests;
