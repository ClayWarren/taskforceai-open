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
                    unreachable!("sync ensure device returns value"); // coverage:ignore-line
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
                    None => None, // coverage:ignore-line
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
                )?; // coverage:ignore-line
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
                )?; // coverage:ignore-line
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

#[cfg(test)]
mod tests {
    use crate::runtime::{AppRuntime, RuntimeConfig};

    #[tokio::test]
    async fn sync_command_handlers_cover_status_device_pull_push_poll_and_usage() {
        let mut runtime = AppRuntime::new(RuntimeConfig::default());

        let status = runtime.handle_sync_command(&[]).await.unwrap();
        assert!(status.handled);
        assert_eq!(status.title, "Sync");
        assert!(status.message.contains("Configured: false"));

        let ensure = runtime.handle_sync_command(&["device"]).await.unwrap();
        assert!(ensure.handled);
        assert!(ensure.message.starts_with("Device ID: taskforce-"));

        let pull = runtime
            .handle_sync_command(&["pull", "bad-limit"])
            .await
            .unwrap();
        assert!(pull.handled);
        assert!(pull.message.contains("conversations: 0"));
        assert!(pull.message.contains("messages: 0"));

        let poll = runtime.handle_sync_command(&["poll", "$"]).await.unwrap();
        assert!(poll.handled);
        assert!(poll.message.contains("updates: false"));

        let run = runtime
            .handle_sync_command(&["run", "evt-1"])
            .await
            .unwrap();
        assert!(run.handled);
        assert!(run.message.contains("last event: evt-1"));

        let unknown = runtime.handle_sync_command(&["wat"]).await.unwrap();
        assert!(!unknown.handled);
        assert!(unknown.message.contains("Usage: /sync"));

        let store_path = std::env::temp_dir().join(format!(
            "taskforceai-sync-command-{}-{}.sqlite3",
            std::process::id(),
            crate::runtime::util::unix_millis()
        ));
        let _ = std::fs::remove_file(&store_path);
        let mut configured =
            AppRuntime::new(RuntimeConfig::default().with_run_store_path(&store_path));
        let push = configured.handle_sync_command(&["push"]).await.unwrap();
        assert!(push.handled);
        assert!(push.message.contains("new version: 1"));
        assert!(push.message.contains("accepted: 0"));
        let _ = std::fs::remove_file(store_path);
    }
}
