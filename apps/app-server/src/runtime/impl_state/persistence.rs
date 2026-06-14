use crate::protocol::*;

use crate::runtime::error::RuntimeError;
use crate::runtime::mcp_util::{
    keychain_delete_auth_token, keychain_get_auth_token, keychain_set_auth_token, non_empty_string,
};
use crate::runtime::records::title_from_prompt;
use crate::runtime::util::*;
use crate::runtime::AuthTokenStorage;

impl crate::runtime::AppRuntime {
    pub(crate) fn metadata_value(&self, key: &str) -> Result<Option<String>, RuntimeError> {
        match &self.run_store {
            Some(store) => store.get_metadata(key),
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
            return Ok(Some(token));
        }

        let token = match self.config.auth_token_storage {
            AuthTokenStorage::Memory => self
                .metadata_value("auth_token")?
                .and_then(|value| non_empty_string(&value)),
            AuthTokenStorage::KeyringWithMetadataFallback => match keychain_get_auth_token() {
                Ok(Some(token)) => Some(token),
                Ok(None) | Err(_) => self
                    .metadata_value("auth_token")?
                    .and_then(|value| non_empty_string(&value)),
            },
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
                self.set_metadata_value("auth_token", token.unwrap_or_default())
            }
            AuthTokenStorage::KeyringWithMetadataFallback => match token {
                Some(token) => {
                    self.memory_metadata
                        .insert("auth_token".to_string(), token.to_string());
                    *self
                        .auth_token_cache
                        .lock()
                        .expect("auth token cache should not be poisoned") =
                        Some(Some(token.to_string()));
                    let _ = keychain_set_auth_token(token);
                    self.set_metadata_value("auth_token", "")
                }
                None => {
                    self.memory_metadata.remove("auth_token");
                    *self
                        .auth_token_cache
                        .lock()
                        .expect("auth token cache should not be poisoned") = Some(None);
                    let _ = keychain_delete_auth_token();
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
        if let Some(store) = &self.run_store {
            store.upsert_run(run)?;
        }

        Ok(())
    }

    pub(crate) fn queue_pending_prompt(
        &mut self,
        run: &RunRecord,
        last_error: Option<String>,
    ) -> Result<(), RuntimeError> {
        let now = unix_millis();
        let pending = PendingPromptRecord {
            id: format!("pending_{}", run.id),
            prompt: run.prompt.clone(),
            model_id: run.model_id.clone(),
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
        store.upsert_message(&user_message)
    }

    pub(crate) fn persist_assistant_message(&self, run: &RunRecord) -> Result<(), RuntimeError> {
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
        store.upsert_message(&assistant_message)
    }
}
