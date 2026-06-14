use crate::api::{ApiCreateProjectRequest, ApiSubmitMcpServer, ApiSubmitRunRequest};
use crate::protocol::*;
use serde_json::json;

use super::error::RuntimeError;
use super::impl_state::log_runtime;
use super::models::is_ollama_model_id;
use super::orchestration::*;
use super::platform::{
    allowed_attachment_mime_type, attachment_size_limit, detect_attachment_mime_type,
    expand_user_path,
};
use super::records::validate_pending_prompt_record;
use super::run_events::*;
use super::util::*;
use super::util::{MAX_PENDING_ATTACHMENTS, MAX_VIDEO_SIZE};

const MAX_REMOTE_RUN_RESUME_AGE_MS: u64 = 6 * 60 * 60 * 1000;
const IMAGE_GENERATION_MODEL_ID: &str = "google/gemini-2.5-flash-image";
const VIDEO_GENERATION_MODEL_ID: &str = "xai/grok-imagine-video";

struct GeneratedMediaRoute {
    model_id: &'static str,
}

impl super::AppRuntime {
    pub fn resume_remote_run_streams(&self) -> usize {
        let Some(token) = self.auth_token().ok().flatten() else {
            return 0;
        };

        let now = unix_millis();
        let runs = self
            .runs
            .values()
            .filter(|run| should_resume_remote_stream(run, now))
            .cloned()
            .collect::<Vec<_>>();
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
        let prompt = params.prompt.trim();
        if prompt.is_empty() {
            return Err(RuntimeError::invalid_params("prompt is required"));
        }

        let has_attachments = !params.attachment_ids.is_empty()
            || (include_active_attachments && !self.active_attachments.is_empty());
        let requested_model_id = params.model_id;
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
        let quick_mode = if generated_media {
            true
        } else {
            params.quick_mode.unwrap_or(self.quick_mode_enabled()?)
        };
        let autonomous = if generated_media {
            false
        } else {
            params.autonomous.unwrap_or(self.autonomous_enabled()?)
        };
        let stored_computer_use = self.computer_use_enabled()?;
        let computer_use = if generated_media {
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
        let mcp_servers = self.mcp_servers()?;
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
                        quick_mode,
                        autonomous,
                        computer_use,
                        computer_use_target: computer_use
                            .then(|| computer_use_target.as_str().to_string()),
                        use_logged_in_services,
                        agent_count,
                        project_id: run.project_id,
                        attachment_ids: attachment_ids.clone(),
                        client_mcp_tools: params
                            .client_mcp_tools
                            .into_iter()
                            .map(api_submit_mcp_tool)
                            .collect(),
                        role_models: remote_orchestration_role_models(&orchestration),
                        budget: orchestration.budget,
                        mcp_servers: api_mcp_servers,
                        research_workflow: params.research_workflow.clone(),
                    },
                )
                .await
            {
                Ok(submitted) => submitted,
                Err(err) => {
                    let mut failed = run.clone();
                    failed.status = RunStatus::Failed;
                    failed.error = Some(format!("api error: {}", err.detailed_message()));
                    failed.updated_at = unix_millis();
                    self.runs.insert(failed.id.clone(), failed.clone());
                    self.persist_run(&failed)?;
                    self.persist_run_conversation(&failed)?;
                    self.queue_pending_prompt(&failed, failed.error.clone())?;
                    return Ok(AppResponse::WithEvents {
                        result: to_value(SubmitRunResult {
                            run: failed.clone(),
                        }),
                        events: vec![AppServerEvent::RunUpdated {
                            run: Box::new(failed),
                        }],
                    });
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
            self.spawn_ollama_run_worker(run.clone());
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
        let now = unix_millis();
        let token = self.auth_token().ok().flatten();
        let run = self
            .runs
            .get_mut(&params.run_id)
            .ok_or_else(|| RuntimeError::not_found("run not found"))?;
        let should_cancel_remote = token.is_some()
            && !matches!(
                run.status,
                RunStatus::Completed | RunStatus::Failed | RunStatus::Canceled
            )
            && !run.id.starts_with("local_run_");
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
                    log_runtime(
                        "warn",
                        "remote run cancel failed",
                        json!({ "runId": remote_run_id, "error": err.to_string() }),
                    );
                }
            });
        }

        Ok(AppResponse::WithEvents {
            result: to_value(RunStatusResult { run: run.clone() }),
            events: vec![AppServerEvent::RunUpdated { run: Box::new(run) }],
        })
    }

    pub fn run_delete(&mut self, params: RunIDParams) -> Result<AppResponse, RuntimeError> {
        if self.runs.remove(&params.run_id).is_none() {
            return Err(RuntimeError::not_found("run not found"));
        }
        if let Some(store) = &self.run_store {
            store.delete(&params.run_id)?;
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
        let id = params.pending_prompt_id.trim();
        if id.is_empty() {
            return Err(RuntimeError::invalid_params("pendingPromptId is required"));
        }
        self.pending_prompts.remove(id);
        if let Some(store) = &self.run_store {
            store.delete_pending_prompt(id)?;
        }
        Ok(value(AckResult { ok: true }))
    }

    pub async fn pending_prompt_replay(&mut self) -> Result<AppResponse, RuntimeError> {
        let Some(prompt) = self
            .pending_prompts
            .values()
            .find(|prompt| {
                matches!(
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
                quick_mode: None,
                autonomous: None,
                computer_use: None,
                computer_use_target: None,
                use_logged_in_services: None,
                agent_count: None,
                project_id: prompt.project_id,
                attachment_ids: Vec::new(),
                client_mcp_tools: Vec::new(),
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

        let (run, events) = match response {
            AppResponse::WithEvents { result, events } => {
                let result: SubmitRunResult = serde_json::from_value(result)
                    .map_err(|err| RuntimeError::storage(err.to_string()))?;
                (result.run, events)
            }
            AppResponse::Value(result) => {
                let result: SubmitRunResult = serde_json::from_value(result)
                    .map_err(|err| RuntimeError::storage(err.to_string()))?;
                (result.run, Vec::new())
            }
            AppResponse::Shutdown(_) => unreachable!("run_submit never shuts down"),
        };

        if run.status == RunStatus::Failed {
            let mut failed = claimed;
            failed.status = PendingPromptStatus::Failed;
            failed.retry_count += 1;
            failed.last_error = run.error.clone();
            failed.updated_at = unix_millis();
            self.upsert_pending_prompt(failed.clone())?;
            let duplicate_id = format!("pending_{}", run.id);
            if duplicate_id != failed.id {
                self.pending_prompts.remove(&duplicate_id);
                if let Some(store) = &self.run_store {
                    store.delete_pending_prompt(&duplicate_id)?;
                }
            }
            return Ok(AppResponse::WithEvents {
                result: to_value(PendingPromptReplayResult {
                    attempted: true,
                    prompt: Some(failed),
                    run: Some(run),
                    remaining: self.pending_prompts.len(),
                    message: "Pending prompt replay failed and remains queued.".to_string(),
                }),
                events,
            });
        }

        self.pending_prompts.remove(&prompt.id);
        if let Some(store) = &self.run_store {
            store.delete_pending_prompt(&prompt.id)?;
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

    pub fn attachment_list(&self) -> AppResponse {
        value(AttachmentListResult {
            attachments: self.active_attachments.clone(),
            max_attachments: MAX_PENDING_ATTACHMENTS,
        })
    }

    pub async fn attachment_add(
        &mut self,
        params: AttachmentAddParams,
    ) -> Result<AppResponse, RuntimeError> {
        if self.active_attachments.len() >= MAX_PENDING_ATTACHMENTS {
            return Err(RuntimeError::invalid_params(format!(
                "attachment limit reached ({MAX_PENDING_ATTACHMENTS})"
            )));
        }
        let path = expand_user_path(params.path.trim());
        if path.as_os_str().is_empty() {
            return Err(RuntimeError::invalid_params("attachment path is required"));
        }
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required to upload attachments"))?;
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|err| RuntimeError::storage(err.to_string()))?;
        if !metadata.is_file() {
            return Err(RuntimeError::invalid_params(
                "attachment path must reference a regular file",
            ));
        }
        if metadata.len() > MAX_VIDEO_SIZE as u64 {
            return Err(RuntimeError::invalid_params(format!(
                "attachment too large ({} bytes); maximum is {} MB",
                metadata.len(),
                MAX_VIDEO_SIZE / (1024 * 1024)
            )));
        }
        let data = tokio::fs::read(&path)
            .await
            .map_err(|err| RuntimeError::storage(err.to_string()))?;
        let mime_type = detect_attachment_mime_type(&path, &data);
        let limit = attachment_size_limit(&mime_type);
        if data.len() > limit {
            return Err(RuntimeError::invalid_params(format!(
                "attachment too large ({} bytes); maximum is {} MB",
                data.len(),
                limit / (1024 * 1024)
            )));
        }
        if !allowed_attachment_mime_type(&mime_type) {
            return Err(RuntimeError::invalid_params(format!(
                "unsupported attachment type: {mime_type}"
            )));
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("attachment")
            .to_string();
        let uploaded = self
            .api_client
            .upload_attachment(&token, &name, data)
            .await
            .map_err(|err| RuntimeError::network(format!("attachment upload failed: {err}")))?;
        let attachment = AttachmentRecord {
            id: uploaded.id,
            name,
            path: path.display().to_string(),
            mime_type: uploaded.mime_type,
            size: uploaded.size,
        };
        self.active_attachments.push(attachment.clone());
        Ok(value(AttachmentAddResult {
            attachment,
            attachments: self.active_attachments.clone(),
            max_attachments: MAX_PENDING_ATTACHMENTS,
        }))
    }

    pub fn attachment_clear(&mut self) -> AppResponse {
        self.active_attachments.clear();
        value(AttachmentListResult {
            attachments: Vec::new(),
            max_attachments: MAX_PENDING_ATTACHMENTS,
        })
    }

    pub async fn project_list(&self) -> Result<AppResponse, RuntimeError> {
        let active_project_id = self.active_project_id()?;
        let Some(token) = self.auth_token()? else {
            return Ok(value(ProjectListResult {
                projects: Vec::new(),
                active_project_id,
            }));
        };
        let projects = self
            .api_client
            .list_projects(&token)
            .await
            .map_err(|err| RuntimeError::network(err.to_string()))?
            .into_iter()
            .map(project_from_api)
            .collect();
        Ok(value(ProjectListResult {
            projects,
            active_project_id,
        }))
    }

    pub async fn project_create(
        &self,
        params: ProjectCreateParams,
    ) -> Result<AppResponse, RuntimeError> {
        let name = params.name.trim();
        if name.is_empty() {
            return Err(RuntimeError::invalid_params("project name is required"));
        }
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required for project.create"))?;
        let project = self
            .api_client
            .create_project(
                &token,
                ApiCreateProjectRequest {
                    name: name.to_string(),
                    description: params.description,
                    custom_instructions: params.custom_instructions,
                },
            )
            .await
            .map_err(|err| RuntimeError::network(err.to_string()))?;
        Ok(value(ProjectResult {
            project: project_from_api(project),
        }))
    }

    pub async fn project_delete(
        &mut self,
        params: ProjectIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        let token = self
            .auth_token()?
            .ok_or_else(|| RuntimeError::not_configured("login required for project.delete"))?;
        self.api_client
            .delete_project(&token, params.project_id)
            .await
            .map_err(|err| RuntimeError::network(err.to_string()))?;
        if self.active_project_id()? == Some(params.project_id) {
            self.set_metadata_value("active_project_id", "")?;
        }
        Ok(value(AckResult { ok: true }))
    }

    pub fn project_use(&mut self, params: ProjectIDParams) -> Result<AppResponse, RuntimeError> {
        if params.project_id <= 0 {
            return Err(RuntimeError::invalid_params("projectId must be positive"));
        }
        self.set_metadata_value("active_project_id", &params.project_id.to_string())?;
        Ok(value(crate::protocol::ActiveProjectResult {
            active_project_id: Some(params.project_id),
        }))
    }

    pub fn project_clear(&mut self) -> Result<AppResponse, RuntimeError> {
        self.set_metadata_value("active_project_id", "")?;
        Ok(value(crate::protocol::ActiveProjectResult {
            active_project_id: None,
        }))
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
                    return Ok(events);
                };
                if current.status == RunStatus::Canceled && run.status != RunStatus::Canceled {
                    return Ok(vec![AppServerEvent::RunUpdated {
                        run: Box::new(current.clone()),
                    }]);
                }
                self.runs.insert(run.id.clone(), (**run).clone());
                self.persist_run(run)?;
                self.persist_run_conversation(run)?;
                if run.status == RunStatus::Completed {
                    self.persist_assistant_message(run)?;
                }
                self.update_agent_session_for_run(run)?;
                for workflow_run in self.update_workflow_runs_for_run(run)? {
                    events.push(AppServerEvent::WorkflowRunUpdated {
                        run: Box::new(workflow_run),
                    });
                }
            }
            AppServerEvent::RunDeleted { run_id } => {
                self.runs.remove(run_id);
                if let Some(store) = &self.run_store {
                    store.delete(run_id)?;
                }
            }
            AppServerEvent::TurnStarted { .. } | AppServerEvent::TurnInterrupted { .. } => {}
            AppServerEvent::WorkflowRunUpdated { .. } => {}
        }

        Ok(events)
    }
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

fn resolve_computer_use(param: Option<bool>, stored: bool) -> bool {
    stored || param.unwrap_or(false)
}

fn resolve_generated_media_route(
    prompt: &str,
    has_attachments: bool,
) -> Option<GeneratedMediaRoute> {
    let normalized = prompt.to_lowercase();
    if should_route_to_video_model(&normalized, has_attachments) {
        return Some(GeneratedMediaRoute {
            model_id: VIDEO_GENERATION_MODEL_ID,
        });
    }
    if should_route_to_image_model(&normalized, has_attachments) {
        return Some(GeneratedMediaRoute {
            model_id: IMAGE_GENERATION_MODEL_ID,
        });
    }
    None
}

fn should_route_to_image_model(prompt: &str, has_attachments: bool) -> bool {
    (has_any_word(
        prompt,
        &[
            "image",
            "images",
            "picture",
            "pictures",
            "photo",
            "photos",
            "illustration",
            "illustrations",
            "artwork",
            "logo",
            "logos",
            "avatar",
            "avatars",
            "icon",
            "icons",
            "wallpaper",
            "wallpapers",
            "poster",
            "posters",
            "sticker",
            "stickers",
            "meme",
            "memes",
        ],
    ) && has_any_word(
        prompt,
        &[
            "generate",
            "create",
            "make",
            "draw",
            "design",
            "illustrate",
            "render",
            "produce",
            "craft",
        ],
    )) || (has_attachments
        && contains_any_phrase(
            prompt,
            &[
                "edit",
                "modify",
                "transform",
                "restyle",
                "retouch",
                "upscale",
                "enhance",
                "recolor",
                "remove background",
            ],
        ))
}

fn should_route_to_video_model(prompt: &str, has_attachments: bool) -> bool {
    (has_any_word(
        prompt,
        &[
            "video",
            "videos",
            "clip",
            "clips",
            "shorts",
            "reel",
            "reels",
            "animation",
            "animations",
            "movie",
            "movies",
            "trailer",
            "trailers",
            "storyboard",
            "storyboards",
        ],
    ) && has_any_word(
        prompt,
        &[
            "generate",
            "create",
            "make",
            "animate",
            "render",
            "produce",
            "edit",
            "transform",
            "turn",
            "convert",
        ],
    )) || (has_attachments
        && contains_any_phrase(
            prompt,
            &[
                "animate",
                "motion",
                "lip-sync",
                "lip sync",
                "add audio",
                "voiceover",
            ],
        ))
}

fn has_any_word(text: &str, words: &[&str]) -> bool {
    words.iter().any(|word| has_word(text, word))
}

fn has_word(text: &str, word: &str) -> bool {
    text.split(|ch: char| !ch.is_alphanumeric())
        .any(|part| part == word)
}

fn contains_any_phrase(text: &str, phrases: &[&str]) -> bool {
    phrases.iter().any(|phrase| text.contains(phrase))
}

#[cfg(test)]
mod resume_tests {
    use super::*;

    fn run_record(id: &str, status: RunStatus, updated_at: u64) -> RunRecord {
        RunRecord {
            id: id.to_string(),
            prompt: "prompt".to_string(),
            model_id: None,
            project_id: None,
            status,
            output: None,
            error: None,
            created_at: 1,
            updated_at,
            tool_events: Vec::new(),
            sources: Vec::new(),
            agent_statuses: Vec::new(),
            pending_approval: None,
        }
    }

    #[test]
    fn resumes_only_nonterminal_remote_task_ids() {
        let remote = "task_6295f579-e462-4c63-b799-c8bbe344d85e";
        let now = MAX_REMOTE_RUN_RESUME_AGE_MS + 10_000;

        assert!(should_resume_remote_stream(
            &run_record(remote, RunStatus::Processing, now),
            now
        ));
        assert!(should_resume_remote_stream(
            &run_record(remote, RunStatus::Queued, now),
            now
        ));
        assert!(!should_resume_remote_stream(
            &run_record(remote, RunStatus::Completed, now),
            now
        ));
        assert!(!should_resume_remote_stream(
            &run_record("local_run_1", RunStatus::Processing, now),
            now
        ));
        assert!(!should_resume_remote_stream(
            &run_record("task_recorded", RunStatus::Processing, now),
            now
        ));
        assert!(!should_resume_remote_stream(
            &run_record(
                remote,
                RunStatus::Processing,
                now - MAX_REMOTE_RUN_RESUME_AGE_MS - 1
            ),
            now
        ));
    }

    #[test]
    fn stored_computer_use_mode_wins_over_stale_false_param() {
        assert!(resolve_computer_use(Some(false), true));
        assert!(resolve_computer_use(Some(true), false));
        assert!(!resolve_computer_use(None, false));
        assert!(!resolve_computer_use(Some(false), false));
    }

    #[test]
    fn short_text_file_prompts_do_not_route_to_video() {
        assert!(
            resolve_generated_media_route("Create a video showing the changed files", false)
                .is_some()
        );
        assert!(resolve_generated_media_route(
            "Create a folder named demo and write two short lines to demo/notes.txt",
            false
        )
        .is_none());
    }
}
