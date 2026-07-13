use crate::protocol::*;
use serde::{de::DeserializeOwned, Serialize};

use crate::runtime::error::RuntimeError;
use crate::runtime::mcp_util::{
    keychain_delete_auth_token, keychain_get_auth_token, keychain_set_auth_token, non_empty_string,
};
use crate::runtime::records::title_from_prompt;
use crate::runtime::util::*;
use crate::runtime::{AuthTokenStorage, RuntimeConfig};

fn keychain_get_for_config(_config: &RuntimeConfig) -> Result<Option<String>, String> {
    #[cfg(test)]
    if let Some(keychain) = &_config.auth_keychain {
        return keychain.get();
    }

    keychain_get_auth_token(&_config.auth_keychain_service).map_err(|error| error.to_string())
}

fn keychain_set_for_config(_config: &RuntimeConfig, token: &str) -> Result<(), String> {
    #[cfg(test)]
    if let Some(keychain) = &_config.auth_keychain {
        return keychain.set(token);
    } // coverage:ignore-line

    // coverage:ignore-start
    keychain_set_auth_token(&_config.auth_keychain_service, token)
        .map_err(|error| error.to_string())
    // coverage:ignore-end
}

fn keychain_delete_for_config(_config: &RuntimeConfig) -> Result<(), String> {
    #[cfg(test)]
    if let Some(keychain) = &_config.auth_keychain {
        return keychain.delete();
    } // coverage:ignore-line

    // coverage:ignore-start
    keychain_delete_auth_token(&_config.auth_keychain_service).map_err(|error| error.to_string())
    // coverage:ignore-end
}

fn verify_keychain_auth_token(config: &RuntimeConfig, token: &str) -> Result<(), String> {
    match keychain_get_for_config(config) {
        Ok(Some(stored)) if stored == token => Ok(()),
        Ok(Some(_)) => Err("stored token did not match keychain read-back".to_string()), // coverage:ignore-line
        Ok(None) => Err("stored token was missing on keychain read-back".to_string()), // coverage:ignore-line
        Err(error) => Err(format!("stored token could not be read back: {error}")),
    }
}

fn persist_keychain_auth_token(config: &RuntimeConfig, token: &str) -> Result<(), String> {
    match keychain_set_for_config(config, token)
        .and_then(|()| verify_keychain_auth_token(config, token))
    {
        Ok(()) => Ok(()),
        Err(first_error) => keychain_delete_for_config(config)
            .map_err(|delete_error| {
                format!("{first_error}; failed to replace stale keychain entry: {delete_error}")
            })
            .and_then(|()| {
                keychain_set_for_config(config, token)
                    .and_then(|()| verify_keychain_auth_token(config, token))
                    .map_err(|retry_error| {
                        format!(
                            "{first_error}; retry after keychain replacement failed: {retry_error}"
                        )
                    })
            }),
    }
}

impl crate::runtime::AppRuntime {
    pub(crate) fn metadata_value(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        match &self.run_store {
            Some(store) => Ok(store.get_metadata(key)?),
            None => Ok(self.memory_metadata.get(key).cloned()),
        }
    }

    pub(crate) fn set_metadata_value(
        &mut self,
        key: &str,
        value: &str,
    ) -> Result<(), RuntimeError> {
        if let Some(store) = &self.run_store {
            store.set_metadata(key, value)?;
        } else {
            self.memory_metadata
                .insert(key.to_string(), value.to_string());
        }
        Ok(())
    }

    pub(crate) fn metadata_json<T: DeserializeOwned>(
        &self,
        key: &str,
    ) -> Result<Option<T>, RuntimeError> {
        Ok(self
            .metadata_value(key)?
            .filter(|raw| !raw.trim().is_empty())
            .map(|raw| serde_json::from_str(&raw))
            .transpose()?)
    }

    pub(crate) fn set_metadata_json<T: Serialize + ?Sized>(
        &mut self,
        key: &str,
        value: &T,
    ) -> Result<(), RuntimeError> {
        let serialized = serde_json::to_string(value)?;
        self.set_metadata_value(key, &serialized)
    }

    pub(crate) fn auth_token(&self) -> Result<Option<String>, RuntimeError> {
        if let Some(token) = self
            .auth_token_cache
            .lock()
            .expect("auth token cache should not be poisoned")
            .clone()
        {
            return Ok(token);
        }
        if let Some(token) = self
            .memory_metadata
            .get("auth_token")
            .and_then(|value| non_empty_string(value))
        {
            return Ok(Some(token)); // coverage:ignore-line
        }

        let token = match self.config.auth_token_storage {
            AuthTokenStorage::Memory => self
                .metadata_value("auth_token")?
                .and_then(|value| non_empty_string(&value)),
            AuthTokenStorage::KeyringWithMemoryFallback => {
                match keychain_get_for_config(&self.config) {
                    Ok(keychain_token) => keychain_token,
                    Err(error) => {
                        log::warn!(
                            target: "auth", // coverage:ignore-line
                            "Failed to read desktop auth token from keychain; auth token metadata fallback is disabled: {error}"
                        );
                        None
                    }
                }
            }
        };
        *self
            .auth_token_cache
            .lock()
            .expect("auth token cache should not be poisoned") = Some(token.clone());
        Ok(token)
    }

    pub(crate) fn set_auth_token(&mut self, token: Option<&str>) -> Result<(), RuntimeError> {
        match self.config.auth_token_storage {
            AuthTokenStorage::Memory => {
                let cached = token.and_then(non_empty_string);
                self.set_metadata_value("auth_token", token.unwrap_or_default())?;
                *self
                    .auth_token_cache
                    .lock()
                    .expect("auth token cache should not be poisoned") = Some(cached);
                Ok(())
            }
            AuthTokenStorage::KeyringWithMemoryFallback => match token {
                Some(token) => {
                    self.set_metadata_value("auth_token", "")?;
                    self.memory_metadata
                        .insert("auth_token".to_string(), token.to_string());
                    *self
                        .auth_token_cache
                        .lock()
                        .expect("auth token cache should not be poisoned") =
                        Some(Some(token.to_string()));
                    if let Err(error) = persist_keychain_auth_token(&self.config, token) {
                        log::warn!(
                            target: "auth", // coverage:ignore-line
                            "Failed to store desktop auth token in keychain; keeping token in memory only until restart: {error}"
                        );
                        return Ok(());
                    }
                    Ok(())
                } // coverage:ignore-line
                None => {
                    keychain_delete_for_config(&self.config).map_err(|error| {
                        RuntimeError::storage(format!(
                            "failed to delete desktop auth token from keychain: {error}"
                        ))
                    })?;
                    self.memory_metadata.remove("auth_token");
                    *self
                        .auth_token_cache
                        .lock()
                        .expect("auth token cache should not be poisoned") = Some(None);
                    self.set_metadata_value("auth_token", "")
                }
            },
        }
    }

    pub(crate) fn get_run(&self, run_id: &str) -> Result<RunRecord, RuntimeError> {
        self.runs
            .get(run_id)
            .cloned()
            .ok_or_else(|| RuntimeError::not_found("run not found"))
    }

    pub(crate) fn next_run_id(&mut self) -> String {
        let id = format!("local_run_{}", self.next_run_sequence);
        self.next_run_sequence += 1;
        id
    }

    pub(crate) fn persist_run(&self, run: &RunRecord) -> Result<(), RuntimeError> {
        if self.private_run_ids.contains(&run.id) {
            return Ok(());
        }
        if let Some(store) = &self.run_store {
            store.upsert_run(run)?;
        }

        Ok(())
    }

    pub(crate) fn queue_pending_prompt(
        &mut self,
        run: &RunRecord,
        last_error: Option<String>,
        reasoning_effort: Option<String>,
    ) -> Result<(), RuntimeError> {
        let now = unix_millis();
        let pending = PendingPromptRecord {
            id: format!("pending_{}", run.id),
            prompt: run.prompt.clone(),
            model_id: run.model_id.clone(),
            reasoning_effort,
            project_id: run.project_id,
            status: PendingPromptStatus::Queued,
            retry_count: 0,
            last_error,
            created_at: run.created_at,
            updated_at: now,
        };
        if let Some(store) = &self.run_store {
            store.upsert_pending_prompt(&pending)?;
        }
        self.pending_prompts.insert(pending.id.clone(), pending);
        Ok(())
    }

    pub(crate) fn upsert_pending_prompt(
        &mut self,
        prompt: PendingPromptRecord,
    ) -> Result<(), RuntimeError> {
        if let Some(store) = &self.run_store {
            store.upsert_pending_prompt(&prompt)?;
        }
        self.pending_prompts.insert(prompt.id.clone(), prompt);
        Ok(())
    }

    pub(crate) fn persist_run_conversation(&self, run: &RunRecord) -> Result<(), RuntimeError> {
        if self.private_run_ids.contains(&run.id) {
            return Ok(());
        }
        let Some(store) = &self.run_store else {
            return Ok(());
        };
        let conversation = ConversationRecord {
            conversation_id: run.id.clone(),
            title: title_from_prompt(&run.prompt),
            created_at: run.created_at,
            updated_at: run.updated_at,
            last_message_preview: Some(run.prompt.clone()),
            ..ConversationRecord::default()
        };
        let user_message = MessageRecord {
            message_id: format!("{}_user", run.id),
            conversation_id: run.id.clone(),
            role: "user".to_string(),
            content: run.prompt.clone(),
            created_at: run.created_at,
            updated_at: run.created_at,
            ..MessageRecord::default()
        };
        store.upsert_conversation(&conversation)?;
        store.upsert_message(&user_message)?;
        Ok(())
    }

    pub(crate) fn persist_assistant_message(&self, run: &RunRecord) -> Result<(), RuntimeError> {
        if self.private_run_ids.contains(&run.id) {
            return Ok(());
        }
        let (Some(store), Some(output)) = (&self.run_store, &run.output) else {
            return Ok(());
        };
        let conversation = ConversationRecord {
            conversation_id: run.id.clone(),
            title: title_from_prompt(&run.prompt),
            created_at: run.created_at,
            updated_at: run.updated_at,
            last_message_preview: Some(output.clone()),
            ..ConversationRecord::default()
        };
        let assistant_message = MessageRecord {
            message_id: format!("{}_assistant", run.id),
            conversation_id: run.id.clone(),
            role: "assistant".to_string(),
            content: output.clone(),
            created_at: run.updated_at,
            updated_at: run.updated_at,
            sources: run.sources.clone(),
            tool_events: run.tool_events.clone(),
            agent_statuses: run.agent_statuses.clone(),
            error: run.error.clone(),
            ..MessageRecord::default()
        };
        store.upsert_conversation(&conversation)?;
        store.upsert_message(&assistant_message)?;
        Ok(())
    }
}
