use crate::protocol::*;
use serde::{de::DeserializeOwned, Serialize};

use crate::runtime::error::RuntimeError;
use crate::runtime::mcp_util::{
    keychain_delete_auth_token, keychain_get_auth_token, keychain_set_auth_token, non_empty_string,
};
use crate::runtime::records::title_from_prompt;
use crate::runtime::util::*;
use crate::runtime::{
    AuthTokenStorage, RuntimeConfig, DEFAULT_KEYCHAIN_SERVICE, DESKTOP_KEYCHAIN_SERVICE,
    LEGACY_KEYCHAIN_SERVICE,
};

const AUTH_KEYCHAIN_MIGRATION_SERVICES: [&str; 2] =
    [DEFAULT_KEYCHAIN_SERVICE, DESKTOP_KEYCHAIN_SERVICE];

fn keychain_get_for_service(
    _config: &RuntimeConfig,
    service: &str,
) -> Result<Option<String>, String> {
    #[cfg(test)]
    if let Some(keychain) = &_config.auth_keychain {
        return keychain.get(service);
    }

    // coverage:ignore-start -- platform Keychain I/O is exercised by desktop integration tests.
    keychain_get_auth_token(service).map_err(|error| error.to_string())
    // coverage:ignore-end
}

fn keychain_get_for_config(config: &RuntimeConfig) -> Result<Option<String>, String> {
    let current = keychain_get_for_service(config, &config.auth_keychain_service)?;
    if current.is_some()
        || !AUTH_KEYCHAIN_MIGRATION_SERVICES.contains(&config.auth_keychain_service.as_str())
    {
        return Ok(current);
    }

    let Some(legacy_token) = keychain_get_for_service(config, LEGACY_KEYCHAIN_SERVICE)? else {
        return Ok(None);
    };
    for service in AUTH_KEYCHAIN_MIGRATION_SERVICES {
        if let Err(error) = persist_keychain_auth_token_for_service(config, service, &legacy_token)
        {
            log::warn!(
                target: "auth", // coverage:ignore-line
                "Failed to migrate legacy desktop auth token to {service}; using the legacy token for this session: {error}"
            );
            return Ok(Some(legacy_token));
        }
    }
    if let Err(error) = keychain_delete_for_service(config, LEGACY_KEYCHAIN_SERVICE) {
        log::warn!(
            target: "auth", // coverage:ignore-line
            "Migrated desktop auth token but failed to delete the legacy keychain entry: {error}"
        );
    }
    Ok(Some(legacy_token))
}

fn keychain_set_for_service(
    _config: &RuntimeConfig,
    service: &str,
    token: &str,
) -> Result<(), String> {
    #[cfg(test)]
    if let Some(keychain) = &_config.auth_keychain {
        return keychain.set(service, token);
    } // coverage:ignore-line

    // coverage:ignore-start
    keychain_set_auth_token(service, token).map_err(|error| error.to_string())
    // coverage:ignore-end
}

fn keychain_delete_for_service(_config: &RuntimeConfig, service: &str) -> Result<(), String> {
    #[cfg(test)]
    if let Some(keychain) = &_config.auth_keychain {
        return keychain.delete(service);
    } // coverage:ignore-line

    // coverage:ignore-start
    keychain_delete_auth_token(service).map_err(|error| error.to_string())
    // coverage:ignore-end
}

fn keychain_delete_all_for_config(config: &RuntimeConfig) -> Result<(), String> {
    let candidates = [
        config.auth_keychain_service.as_str(),
        DEFAULT_KEYCHAIN_SERVICE,
        DESKTOP_KEYCHAIN_SERVICE,
        LEGACY_KEYCHAIN_SERVICE,
    ];
    let mut deleted_services = Vec::with_capacity(candidates.len());
    let mut failures = Vec::new();
    for service in candidates {
        if deleted_services.contains(&service) {
            continue;
        }
        deleted_services.push(service);
        if let Err(error) = keychain_delete_for_service(config, service) {
            failures.push(format!("{service}: {error}"));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "failed to delete keychain service(s): {}",
            failures.join("; ")
        ))
    }
}

fn verify_keychain_auth_token_for_service(
    config: &RuntimeConfig,
    service: &str,
    token: &str,
) -> Result<(), String> {
    match keychain_get_for_service(config, service) {
        Ok(Some(stored)) if stored == token => Ok(()),
        Ok(Some(_)) => Err("stored token did not match keychain read-back".to_string()), // coverage:ignore-line
        Ok(None) => Err("stored token was missing on keychain read-back".to_string()), // coverage:ignore-line
        Err(error) => Err(format!("stored token could not be read back: {error}")),
    }
}

fn persist_keychain_auth_token_for_service(
    config: &RuntimeConfig,
    service: &str,
    token: &str,
) -> Result<(), String> {
    match keychain_set_for_service(config, service, token)
        .and_then(|()| verify_keychain_auth_token_for_service(config, service, token))
    {
        Ok(()) => Ok(()),
        Err(first_error) => keychain_delete_for_service(config, service)
            .map_err(|delete_error| {
                format!("{first_error}; failed to replace stale keychain entry: {delete_error}")
            })
            .and_then(|()| {
                keychain_set_for_service(config, service, token)
                    .and_then(|()| verify_keychain_auth_token_for_service(config, service, token))
                    .map_err(|retry_error| {
                        format!(
                            "{first_error}; retry after keychain replacement failed: {retry_error}"
                        )
                    })
            }),
    }
}

fn persist_keychain_auth_token(config: &RuntimeConfig, token: &str) -> Result<(), String> {
    persist_keychain_auth_token_for_service(config, &config.auth_keychain_service, token)
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
                    keychain_delete_all_for_config(&self.config).map_err(|error| {
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

#[cfg(test)]
mod keychain_delete_tests {
    use super::*;
    use crate::runtime::{
        TestAuthKeychain, DEFAULT_KEYCHAIN_SERVICE, DESKTOP_KEYCHAIN_SERVICE,
        LEGACY_KEYCHAIN_SERVICE,
    };

    #[test]
    fn delete_all_reports_current_and_legacy_service_failures() {
        let current_failure = RuntimeConfig {
            auth_keychain_service: LEGACY_KEYCHAIN_SERVICE.to_string(),
            auth_keychain: Some(TestAuthKeychain::with_failures(None, false, false, true)),
            ..RuntimeConfig::default()
        };
        assert_eq!(
            keychain_delete_all_for_config(&current_failure)
                .expect_err("current service deletion should fail"),
            "failed to delete keychain service(s): taskforceai: test keychain delete failed; com.taskforceai.app-server.auth: test keychain delete failed; com.taskforceai.desktop.auth: test keychain delete failed"
        );

        let legacy_failure = RuntimeConfig {
            auth_keychain_service: DEFAULT_KEYCHAIN_SERVICE.to_string(),
            auth_keychain: Some(TestAuthKeychain::with_delete_failure_for_service(
                LEGACY_KEYCHAIN_SERVICE,
            )),
            ..RuntimeConfig::default()
        };
        assert_eq!(
            keychain_delete_all_for_config(&legacy_failure)
                .expect_err("legacy service deletion should fail"),
            "failed to delete keychain service(s): taskforceai: test keychain delete failed"
        );

        let keychain = TestAuthKeychain::new(None);
        for service in [
            "com.taskforceai.custom.auth",
            DEFAULT_KEYCHAIN_SERVICE,
            DESKTOP_KEYCHAIN_SERVICE,
            LEGACY_KEYCHAIN_SERVICE,
        ] {
            keychain.set(service, "token").expect("token should seed");
        }
        let custom_service = RuntimeConfig {
            auth_keychain_service: "com.taskforceai.custom.auth".to_string(),
            auth_keychain: Some(keychain.clone()),
            ..RuntimeConfig::default()
        };
        keychain_delete_all_for_config(&custom_service).expect("all services should be deleted");
        for service in [
            "com.taskforceai.custom.auth",
            DEFAULT_KEYCHAIN_SERVICE,
            DESKTOP_KEYCHAIN_SERVICE,
            LEGACY_KEYCHAIN_SERVICE,
        ] {
            assert_eq!(
                keychain.get(service).expect("keychain read should work"),
                None
            );
        }
    }
}
