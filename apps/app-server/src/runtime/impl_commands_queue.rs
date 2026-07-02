use crate::protocol::*;

use super::error::RuntimeError;
use super::format::*;
use super::settings_util::*;
use super::util::*;

impl super::AppRuntime {
    pub(crate) async fn handle_pending_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        match args
            .first()
            .map(|value| value.to_ascii_lowercase())
            .as_deref()
        {
            Some("add") => {
                let prompt = args.get(1..).unwrap_or_default().join(" ");
                if prompt.trim().is_empty() {
                    return Ok(CommandExecuteResult {
                        handled: false,
                        title: "Pending Prompts".to_string(),
                        message: "Usage: /pending add <prompt>".to_string(),
                    });
                }
                let now = unix_millis();
                let result: PendingPromptResult =
                    from_value_response(self.pending_prompt_add(PendingPromptRecord {
                        id: format!("manual_{now}"),
                        prompt,
                        model_id: None,
                        project_id: None,
                        status: PendingPromptStatus::Queued,
                        retry_count: 0,
                        last_error: None,
                        created_at: now,
                        updated_at: now,
                    })?)?;
                return Ok(command_message(
                    "Pending Prompts",
                    format!("Queued {}.", result.prompt.id),
                ));
            }
            Some("delete") => {
                let id = args
                    .get(1)
                    .map(|value| value.trim())
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| {
                        RuntimeError::invalid_params("usage: /pending delete <pending-prompt-id>")
                    })?;
                self.pending_prompt_delete(PendingPromptIDParams {
                    pending_prompt_id: id.to_string(),
                })?;
                return Ok(command_message("Pending Prompts", format!("Deleted {id}.")));
            }
            Some("replay") => {
                let result: PendingPromptReplayResult =
                    from_value_response(self.pending_prompt_replay().await?)?;
                return Ok(command_message("Pending Prompts", result.message));
            }
            _ => {}
        }
        Ok(CommandExecuteResult {
            handled: true,
            title: "Pending Prompts".to_string(),
            message: format_pending_prompts(self.pending_prompts.values()),
        })
    }

    pub(crate) async fn handle_prompt_queue_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        match args
            .first()
            .map(|value| value.to_ascii_lowercase())
            .as_deref()
        {
            Some("add") => {
                let dispatch_timing = args.get(1).copied().unwrap_or_default();
                if dispatch_timing != "immediate" && dispatch_timing != "after_response" {
                    return Ok(CommandExecuteResult {
                        handled: false,
                        title: "Prompt Queue".to_string(),
                        message:
                            "Usage: /prompt-queue add <immediate|after_response> <conversation-id> <prompt>"
                                .to_string(),
                    });
                }
                let conversation_id = args.get(2).copied().unwrap_or_default();
                let prompt = args.get(3..).unwrap_or_default().join(" ");
                if conversation_id.trim().is_empty() || prompt.trim().is_empty() {
                    return Ok(CommandExecuteResult {
                        handled: false,
                        title: "Prompt Queue".to_string(),
                        message:
                            "Usage: /prompt-queue add <immediate|after_response> <conversation-id> <prompt>"
                                .to_string(),
                    });
                }
                let now = unix_millis();
                let result: PromptQueueResult = from_value_response(
                    self.prompt_queue_add(PromptQueueRecord {
                        id: None,
                        conversation_id: conversation_id.to_string(),
                        prompt,
                        status: "queued".to_string(),
                        dispatch_timing: dispatch_timing.to_string(),
                        created_at: now,
                        updated_at: now,
                        model_id: None,
                        attachment_ids: Vec::new(),
                    })
                    .await?,
                )?; // coverage:ignore-line
                return Ok(command_message(
                    "Prompt Queue",
                    format!(
                        "Queued {} for {}.",
                        result
                            .queued_prompt
                            .id
                            .map_or_else(|| "prompt".to_string(), |id| id.to_string()),
                        result.queued_prompt.dispatch_timing
                    ),
                ));
            }
            Some("delete") => {
                let id = args
                    .get(1)
                    .and_then(|value| value.parse::<i64>().ok())
                    .filter(|id| *id > 0)
                    .ok_or_else(|| {
                        RuntimeError::invalid_params("usage: /prompt-queue delete <id>")
                    })?;
                self.prompt_queue_delete(PromptQueueIDParams { id })?;
                return Ok(command_message(
                    "Prompt Queue",
                    format!("Deleted queued prompt {id}."),
                ));
            }
            Some("clear") => {
                self.prompt_queue_clear()?;
                return Ok(command_message("Prompt Queue", "Cleared queued prompts."));
            }
            _ => {}
        }
        let result: PromptQueueListResult = from_value_response(self.prompt_queue_list()?)?;
        Ok(command_message(
            "Prompt Queue",
            format_prompt_queue(&result.queued_prompts),
        ))
    }

    pub(crate) fn handle_pending_changes_command(
        &self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        match args
            .first()
            .map(|value| value.to_ascii_lowercase())
            .as_deref()
        {
            Some("delete") => {
                let id = args
                    .get(1)
                    .and_then(|value| value.parse::<i64>().ok())
                    .filter(|id| *id > 0)
                    .ok_or_else(|| {
                        RuntimeError::invalid_params("usage: /pending-changes delete <id>")
                    })?;
                self.pending_change_delete(PendingChangeIDParams { id })?;
                return Ok(command_message(
                    "Pending Changes",
                    format!("Deleted pending change {id}."),
                ));
            }
            Some("clear") => {
                self.pending_change_clear()?;
                return Ok(command_message(
                    "Pending Changes",
                    "Cleared pending changes.",
                ));
            }
            _ => {}
        }
        let result: PendingChangeListResult = from_value_response(self.pending_change_list()?)?;
        Ok(command_message(
            "Pending Changes",
            format_pending_changes(&result.pending_changes),
        ))
    }

    pub(crate) async fn handle_attachment_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        if args
            .first()
            .is_some_and(|arg| arg.eq_ignore_ascii_case("clear"))
        {
            let result: AttachmentListResult = from_value_response(self.attachment_clear())?;
            return Ok(command_message(
                "Attachments",
                format!(
                    "Attachments cleared. {} / {} pending.",
                    result.attachments.len(),
                    result.max_attachments
                ),
            ));
        }
        let path = args.join(" ");
        if path.trim().is_empty() {
            let result: AttachmentListResult = from_value_response(self.attachment_list())?;
            return Ok(command_message(
                "Attachments",
                if result.attachments.is_empty() {
                    format!(
                        "No pending attachments. 0 / {} pending.",
                        result.max_attachments
                    )
                } else {
                    format!(
                        "{} / {} attachments pending.",
                        result.attachments.len(),
                        result.max_attachments
                    )
                },
            ));
        }
        let result: AttachmentAddResult =
            from_value_response(self.attachment_add(AttachmentAddParams { path }).await?)?;
        Ok(command_message(
            "Attachments",
            format!(
                "Uploaded {}. {} / {} pending.",
                result.attachment.name,
                result.attachments.len(),
                result.max_attachments
            ),
        ))
    }
}
