use crate::protocol::*;

use super::error::RuntimeError;
use super::format::*;
use super::settings_util::*;
use super::util::*;

impl super::AppRuntime {
    pub(crate) async fn handle_sync_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = args
            .first()
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_else(|| "status".to_string());
        match action.as_str() {
            "status" => Ok(CommandExecuteResult {
                handled: true,
                title: "Sync".to_string(),
                message: format_sync_status(&self.sync_status_result()?),
            }),
            "ensure" | "device" => {
                let AppResponse::Value(result) = self.sync_ensure_device()? else {
                    unreachable!("sync ensure device returns value");
                };
                let device_id = result["deviceId"].as_str().unwrap_or_default();
                Ok(CommandExecuteResult {
                    handled: true,
                    title: "Sync".to_string(),
                    message: format!("Device ID: {device_id}"),
                })
            }
            "pull" => {
                let limit = match args.get(1) {
                    Some(raw) => raw.parse::<usize>().ok(),
                    None => None,
                };
                let result: SyncPullResult =
                    from_value_response(self.sync_pull(SyncPullParams { limit }).await?)?;
                Ok(CommandExecuteResult {
                    handled: true,
                    title: "Sync".to_string(),
                    message: format!(
                        "device: {}\nlatest version: {}\nconversations: {}\nmessages: {}\ndeletions: {}",
                        result.device_id.as_deref().unwrap_or("none"),
                        result.latest_version,
                        result.conversations.len(),
                        result.messages.len(),
                        result.deletions.len()
                    ),
                })
            }
            "push" => {
                let result: SyncPushResult = from_value_response(
                    self.sync_push(SyncPushParams {
                        conversations: Vec::new(),
                        messages: Vec::new(),
                        deletions: Vec::new(),
                        new_version: None,
                    })
                    .await?,
                )?;
                Ok(command_message(
                    "Sync",
                    format!(
                        "new version: {}\naccepted: {}\nconflicts: {}",
                        result.new_version,
                        result.accepted.len(),
                        result.conflicts.len()
                    ),
                ))
            }
            "poll" | "run" => {
                let result: SyncRealtimePollResult = from_value_response(
                    self.sync_realtime_poll(SyncRealtimePollParams {
                        last_event_id: args.get(1).map(|value| (*value).to_string()),
                    })
                    .await?,
                )?;
                Ok(command_message(
                    "Sync",
                    format!(
                        "updates: {}\nlast event: {}",
                        result.has_updates, result.last_event_id
                    ),
                ))
            }
            _ => Ok(CommandExecuteResult {
                handled: false,
                title: "Sync".to_string(),
                message: "Usage: /sync [status|ensure|pull|push|poll]".to_string(),
            }),
        }
    }
}
