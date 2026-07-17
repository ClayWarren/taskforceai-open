use std::collections::BTreeSet;

use serde_json::{json, Value};

use crate::api::{ApiSyncPullRequest, ApiSyncPushRequest};
use crate::protocol::*;

use super::error::RuntimeError;
use super::mcp_util::*;
use super::records::{
    apply_sync_deletion, conversation_record_from_sync_value, conversation_sync_value,
    desktop_conversation_sync_value, desktop_message_sync_value, message_record_from_sync_value,
    message_sync_value, sync_deletion_id,
};
use super::util::*;

impl super::AppRuntime {
    pub fn metadata_get(&self, params: MetadataGetParams) -> Result<AppResponse, RuntimeError> {
        let key = normalize_metadata_key(&params.key)?;
        let stored_value = if key == "auth_token" {
            self.auth_token()?
        } else {
            self.metadata_value(key)?
        };
        Ok(value(MetadataGetResult {
            value: stored_value,
        }))
    }

    pub fn metadata_set(&mut self, params: MetadataSetParams) -> Result<AppResponse, RuntimeError> {
        let key = normalize_metadata_key(&params.key)?;
        if key == "auth_token" {
            let token = non_empty_string(&params.value);
            self.set_auth_token(token.as_deref())?;
        } else {
            self.set_metadata_value(key, &params.value)?;
        }
        Ok(value(AckResult { ok: true }))
    }

    pub fn metadata_clear_all(&mut self) -> Result<AppResponse, RuntimeError> {
        if let Some(store) = &self.run_store {
            store.clear_all()?;
        }
        self.runs.clear();
        self.private_run_ids.clear();
        self.memory_metadata.clear();
        self.pending_prompts.clear();
        self.active_attachments.clear();
        self.next_run_sequence = 0;
        Ok(value(AckResult { ok: true }))
    }

    pub fn sync_status(&self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.sync_status_result()?))
    }

    pub(crate) fn sync_status_result(&self) -> Result<SyncStatusResult, RuntimeError> {
        let device_id = self.metadata_value("device_id")?;
        let last_sync_version = self
            .metadata_value("last_sync_version")?
            .as_deref()
            .unwrap_or("0")
            .parse::<i64>()
            .unwrap_or(0);

        Ok(SyncStatusResult {
            device_id,
            last_sync_version,
            configured: self.run_store.is_some(),
        })
    }

    pub fn sync_configure(
        &mut self,
        params: SyncConfigureParams,
    ) -> Result<AppResponse, RuntimeError> {
        if let Some(device_id) = params.device_id {
            let device_id = device_id.trim();
            if device_id.is_empty() {
                return Err(RuntimeError::invalid_params("deviceId cannot be empty"));
            }
            self.set_metadata_value("device_id", device_id)?;
        }
        if let Some(last_sync_version) = params.last_sync_version {
            if last_sync_version < 0 {
                return Err(RuntimeError::invalid_params(
                    "lastSyncVersion cannot be negative",
                ));
            }
            self.set_metadata_value("last_sync_version", &last_sync_version.to_string())?;
        } // coverage:ignore-line
        self.sync_status()
    }

    pub fn sync_ensure_device(&mut self) -> Result<AppResponse, RuntimeError> {
        Ok(value(self.sync_ensure_device_result()?))
    }

    pub(crate) fn sync_ensure_device_result(&mut self) -> Result<SyncDeviceResult, RuntimeError> {
        if let Some(device_id) = self.metadata_value("device_id")? {
            if !device_id.trim().is_empty() {
                return Ok(SyncDeviceResult {
                    device_id,
                    generated: false,
                });
            } // coverage:ignore-line
        }

        let device_id = format!("taskforce-{}-{}", unix_millis(), std::process::id());
        self.set_metadata_value("device_id", &device_id)?;
        Ok(SyncDeviceResult {
            device_id,
            generated: true,
        })
    }

    pub(crate) fn expand_sync_push_params(
        &self,
        params: SyncPushParams,
    ) -> Result<SyncPushParams, RuntimeError> {
        if !params.conversations.is_empty() || !params.messages.is_empty() {
            return Ok(params);
        }
        let Some(store) = &self.run_store else {
            return Ok(params);
        };
        let conversations = store.list_conversations(250)?;
        let mut messages = Vec::new();
        for conversation in &conversations {
            messages.extend(store.list_messages(&conversation.conversation_id)?);
        }
        Ok(SyncPushParams {
            conversations,
            messages,
            deletions: params.deletions,
            new_version: params.new_version,
        })
    }

    pub async fn sync_pull(&mut self, params: SyncPullParams) -> Result<AppResponse, RuntimeError> {
        let status = self.sync_status_result()?;
        if self.config.remote_sync {
            if let (Some(token), Some(device_id)) = (self.auth_token()?, status.device_id.clone()) {
                let pulled = self
                    .api_client
                    .sync_pull(
                        &token,
                        ApiSyncPullRequest {
                            device_id: device_id.clone(),
                            last_sync_version: status.last_sync_version,
                            limit: params.limit,
                        },
                    )
                    .await?;
                let conversations = pulled
                    .conversations
                    .into_iter()
                    .map(conversation_record_from_sync_value)
                    .collect::<Result<Vec<_>, _>>()?;
                let messages = pulled
                    .messages
                    .into_iter()
                    .map(message_record_from_sync_value)
                    .collect::<Result<Vec<_>, _>>()?;
                self.apply_remote_sync_pull(
                    &conversations,
                    &messages,
                    &pulled.deletions,
                    pulled.latest_version,
                )?; // coverage:ignore-line
                return Ok(value(SyncPullResult {
                    device_id: Some(device_id),
                    latest_version: pulled.latest_version,
                    conversations,
                    messages,
                    deletions: pulled.deletions,
                    has_more: pulled.has_more,
                }));
            } // coverage:ignore-line
        }
        let limit = params.limit.unwrap_or(50);
        let conversations = match &self.run_store {
            Some(store) => store.list_conversations(limit)?,
            None => Vec::new(),
        };
        let mut messages = Vec::new();
        if let Some(store) = &self.run_store {
            for conversation in &conversations {
                messages.extend(store.list_messages(&conversation.conversation_id)?);
            }
        }
        Ok(value(SyncPullResult {
            device_id: status.device_id,
            latest_version: status.last_sync_version,
            conversations,
            messages,
            deletions: Vec::new(),
            has_more: false,
        }))
    }

    pub(crate) fn apply_remote_sync_pull(
        &mut self,
        conversations: &[ConversationRecord],
        messages: &[MessageRecord],
        deletions: &[Value],
        latest_version: i64,
    ) -> Result<(), RuntimeError> {
        let mut affected_conversation_ids = conversations
            .iter()
            .map(|conversation| conversation.conversation_id.clone())
            .chain(
                messages
                    .iter()
                    .map(|message| message.conversation_id.clone()),
            )
            .collect::<BTreeSet<_>>();
        if let Some(store) = self.run_store.clone() {
            for conversation in conversations {
                store.upsert_conversation(conversation)?;
            }
            for message in messages {
                store.upsert_message(message)?;
            }
            for deletion in deletions {
                if let Some(conversation_id) = sync_deletion_conversation_id(&store, deletion)? {
                    affected_conversation_ids.insert(conversation_id);
                }
                apply_sync_deletion(&store, deletion)?;
            }
            for conversation_id in affected_conversation_ids {
                self.refresh_synced_run_projection(&store, &conversation_id)?;
            }
        } // coverage:ignore-line
        self.set_metadata_value("last_sync_version", &latest_version.to_string())
    }

    fn refresh_synced_run_projection(
        &mut self,
        store: &taskforceai_app_store::SqliteRunStore,
        conversation_id: &str,
    ) -> Result<(), RuntimeError> {
        let Some(conversation) = store.get_conversation(conversation_id)? else {
            self.runs.remove(conversation_id);
            store.delete(conversation_id)?;
            return Ok(());
        };
        if conversation.is_deleted || conversation.is_archived {
            self.runs.remove(conversation_id);
            store.delete(conversation_id)?;
            return Ok(());
        }

        let messages = store.list_messages(conversation_id)?;
        let existing = self.runs.get(conversation_id);
        let user_message = messages
            .iter()
            .find(|message| message.role == "user" && !message.content.trim().is_empty());
        let assistant_message = messages
            .iter()
            .rev()
            .find(|message| message.role == "assistant");
        let prompt = user_message
            .map(|message| message.content.clone())
            .filter(|prompt| !prompt.trim().is_empty())
            .unwrap_or_else(|| conversation.title.clone());
        let output = assistant_message
            .map(|message| message.content.clone())
            .filter(|output| !output.trim().is_empty())
            .or_else(|| conversation.last_message_preview.clone());
        let error = assistant_message.and_then(|message| message.error.clone());
        let status = match assistant_message {
            Some(message) if message.is_streaming => RunStatus::Processing,
            Some(_) if error.is_some() => RunStatus::Failed,
            Some(_) => RunStatus::Completed,
            None => existing
                .map(|run| run.status.clone())
                .unwrap_or(RunStatus::Queued),
        };
        let run = RunRecord {
            id: conversation.conversation_id.clone(),
            prompt,
            model_id: existing.and_then(|run| run.model_id.clone()),
            project_id: conversation
                .project_id
                .or_else(|| existing.and_then(|run| run.project_id)),
            status,
            output,
            error,
            created_at: conversation.created_at,
            updated_at: conversation.updated_at,
            tool_events: assistant_message
                .map(|message| message.tool_events.clone())
                .unwrap_or_default(),
            sources: assistant_message
                .map(|message| message.sources.clone())
                .unwrap_or_default(),
            agent_statuses: assistant_message
                .map(|message| message.agent_statuses.clone())
                .unwrap_or_default(),
            pending_approval: existing.and_then(|run| run.pending_approval.clone()),
        };
        store.upsert_run(&run)?;
        self.runs.insert(run.id.clone(), run);
        Ok(())
    }

    pub(super) fn apply_remote_conversation_id_mappings(
        &self,
        mappings: &Value,
    ) -> Result<(), RuntimeError> {
        let (Some(store), Some(mappings)) = (&self.run_store, mappings.as_object()) else {
            return Ok(());
        };
        for (local_id, remote_id) in mappings {
            let remote_id = remote_id
                .as_i64()
                .map(|value| value.to_string())
                .or_else(|| remote_id.as_str().map(str::to_string));
            if let Some(remote_id) = remote_id {
                store.replace_conversation_id(local_id, &remote_id)?;
            }
        }
        Ok(())
    }

    pub async fn sync_push(&mut self, params: SyncPushParams) -> Result<AppResponse, RuntimeError> {
        let SyncPushParams {
            conversations,
            messages,
            deletions,
            new_version,
        } = self.expand_sync_push_params(params)?;
        if self.config.remote_sync {
            if let Some(token) = self.auth_token()? {
                let device = self.sync_ensure_device_result()?;
                let pushed = self
                    .api_client
                    .sync_push(
                        &token,
                        ApiSyncPushRequest {
                            conversations: conversations
                                .iter()
                                .map(conversation_sync_value)
                                .collect(),
                            messages: messages.iter().map(message_sync_value).collect(),
                            deletions: deletions.clone(),
                            device_id: device.device_id,
                        },
                    )
                    .await?;
                self.apply_remote_conversation_id_mappings(&pushed.conversation_id_mappings)?;
                self.set_metadata_value("last_sync_version", &pushed.new_version.to_string())?;
                return Ok(value(SyncPushResult {
                    accepted: pushed.accepted,
                    conflicts: pushed.conflicts,
                    new_version: pushed.new_version,
                    conversation_id_mappings: pushed.conversation_id_mappings,
                }));
            } // coverage:ignore-line
        }
        let Some(store) = &self.run_store else {
            return Err(RuntimeError::storage(
                "sync.push requires a configured run store",
            ));
        };
        let current_version = self.sync_status_result()?.last_sync_version;
        let new_version = new_version.unwrap_or_else(|| current_version.saturating_add(1));
        if new_version < current_version {
            return Err(RuntimeError::invalid_params(
                "newVersion cannot be lower than the current sync version",
            ));
        }

        let mut accepted = Vec::new();
        for conversation in &conversations {
            store.upsert_conversation(conversation)?;
            accepted.push(conversation.conversation_id.clone());
        }
        for message in &messages {
            store.upsert_message(message)?;
            accepted.push(message.message_id.clone());
        }
        for deletion in &deletions {
            apply_sync_deletion(store, deletion)?;
        }

        self.set_metadata_value("last_sync_version", &new_version.to_string())?;

        Ok(value(SyncPushResult {
            accepted,
            conflicts: Vec::new(),
            new_version,
            conversation_id_mappings: json!({}),
        }))
    }

    pub async fn desktop_sync_pull(
        &mut self,
        params: DesktopSyncPullParams,
    ) -> Result<AppResponse, RuntimeError> {
        if self.config.remote_sync {
            if let Some(token) = self.auth_token()? {
                let pulled = self
                    .api_client
                    .sync_pull(
                        &token,
                        ApiSyncPullRequest {
                            device_id: params.device_id,
                            last_sync_version: params.last_sync_version,
                            limit: params.limit,
                        },
                    )
                    .await?;
                let conversations = pulled.conversations;
                let messages = pulled.messages;
                let deletions = pulled.deletions;
                let conversation_records = conversations
                    .iter()
                    .cloned()
                    .map(conversation_record_from_sync_value)
                    .collect::<Result<Vec<_>, _>>()?;
                let message_records = messages
                    .iter()
                    .cloned()
                    .map(message_record_from_sync_value)
                    .collect::<Result<Vec<_>, _>>()?;
                self.apply_remote_sync_pull(
                    &conversation_records,
                    &message_records,
                    &deletions,
                    pulled.latest_version,
                )?; // coverage:ignore-line
                return Ok(value(DesktopSyncPullResult {
                    conversations,
                    messages,
                    deletions,
                    latest_version: pulled.latest_version,
                    has_more: Some(pulled.has_more),
                }));
            } // coverage:ignore-line
        }

        let limit = params.limit.unwrap_or(50);
        let conversations = match &self.run_store {
            Some(store) => store
                .list_conversations(limit)?
                .into_iter()
                .map(|conversation| desktop_conversation_sync_value(&conversation))
                .collect(),
            None => Vec::new(),
        };
        let mut messages = Vec::new();
        if let Some(store) = &self.run_store {
            for conversation in store.list_conversations(limit)? {
                messages.extend(
                    store
                        .list_messages(&conversation.conversation_id)?
                        .into_iter()
                        .map(|message| desktop_message_sync_value(&message)),
                );
            }
        }
        Ok(value(DesktopSyncPullResult {
            conversations,
            messages,
            deletions: Vec::new(),
            latest_version: self.sync_status_result()?.last_sync_version,
            has_more: None,
        }))
    }

    pub async fn desktop_sync_push(
        &mut self,
        params: DesktopSyncPushParams,
    ) -> Result<AppResponse, RuntimeError> {
        if self.config.remote_sync {
            if let Some(token) = self.auth_token()? {
                let pushed = self
                    .api_client
                    .sync_push(
                        &token,
                        ApiSyncPushRequest {
                            conversations: params.conversations,
                            messages: params.messages,
                            deletions: params.deletions,
                            device_id: params.device_id,
                        },
                    )
                    .await?;
                self.set_metadata_value("last_sync_version", &pushed.new_version.to_string())?;
                return Ok(value(DesktopSyncPushResult {
                    accepted: pushed.accepted,
                    conflicts: pushed.conflicts,
                    new_version: pushed.new_version,
                    conversation_id_mappings: pushed.conversation_id_mappings,
                }));
            } // coverage:ignore-line
        }

        let Some(store) = &self.run_store else {
            return Err(RuntimeError::storage(
                "desktopSync.push requires a configured run store",
            ));
        };
        let mut accepted = Vec::new();
        for conversation in params.conversations {
            let record = conversation_record_from_sync_value(conversation)?;
            accepted.push(record.conversation_id.clone());
            store.upsert_conversation(&record)?;
        }
        for message in params.messages {
            let record = message_record_from_sync_value(message)?;
            accepted.push(record.message_id.clone());
            store.upsert_message(&record)?;
        }
        for deletion in &params.deletions {
            apply_sync_deletion(store, deletion)?;
        }
        let new_version = self
            .sync_status_result()?
            .last_sync_version
            .saturating_add(1);
        self.set_metadata_value("last_sync_version", &new_version.to_string())?;
        Ok(value(DesktopSyncPushResult {
            accepted,
            conflicts: Vec::new(),
            new_version,
            conversation_id_mappings: json!({}),
        }))
    }

    pub async fn sync_realtime_poll(
        &self,
        params: SyncRealtimePollParams,
    ) -> Result<AppResponse, RuntimeError> {
        let last_event_id = params
            .last_event_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty() && *value != "$");

        if self.config.remote_sync {
            if let Some(token) = self.auth_token()? {
                let polled = self
                    .api_client
                    .sync_realtime_poll(&token, last_event_id)
                    .await?;
                let has_updates = polled.messages.iter().any(|message| {
                    let event_type = message.event_type.trim().to_ascii_lowercase();
                    event_type == "sync_required"
                        || event_type.starts_with("conversation_")
                        || event_type.starts_with("message_")
                });
                let last_event_id = if polled.last_id.trim().is_empty() {
                    last_event_id.unwrap_or_default().to_string()
                } else {
                    polled.last_id
                };
                return Ok(value(SyncRealtimePollResult {
                    has_updates,
                    last_event_id,
                }));
            } // coverage:ignore-line
        }

        Ok(value(SyncRealtimePollResult {
            has_updates: false,
            last_event_id: last_event_id.unwrap_or_default().to_string(),
        }))
    }
}

fn sync_deletion_conversation_id(
    store: &taskforceai_app_store::SqliteRunStore,
    deletion: &Value,
) -> Result<Option<String>, RuntimeError> {
    let deletion_type = deletion
        .get("type")
        .or_else(|| deletion.get("entityType"))
        .or_else(|| deletion.get("entity_type"))
        .and_then(Value::as_str)
        .map(str::to_ascii_lowercase);
    if deletion_type
        .as_deref()
        .is_some_and(|value| value.contains("message"))
        || deletion.get("messageId").is_some()
        || deletion.get("message_id").is_some()
    {
        let Some(message_id) = sync_deletion_id(
            deletion,
            &["messageId", "message_id", "entityId", "entity_id", "id"],
        ) else {
            return Ok(None);
        };
        return Ok(store
            .get_message(&message_id)?
            .map(|message| message.conversation_id));
    }
    Ok(sync_deletion_id(
        deletion,
        &[
            "conversationId",
            "conversation_id",
            "conversationLocalId",
            "conversation_local_id",
            "localId",
            "local_id",
            "entityId",
            "entity_id",
            "id",
        ],
    ))
}
