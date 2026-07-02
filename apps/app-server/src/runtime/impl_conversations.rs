use crate::protocol::*;
use crate::store::SqliteRunStore;

use super::error::RuntimeError;
use super::records::{
    validate_conversation_record, validate_message_record, validate_pending_change_record,
    validate_prompt_queue_record,
};
use super::util::*;

impl super::AppRuntime {
    pub fn conversation_list(
        &self,
        params: ConversationListParams,
    ) -> Result<AppResponse, RuntimeError> {
        let limit = params.limit.clamp(1, 200);
        let conversations = match &self.run_store {
            Some(store) => store.list_conversations(limit)?,
            None => Vec::new(),
        };
        Ok(value(ConversationListResult { conversations }))
    }

    pub fn conversation_get(
        &self,
        params: ConversationIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        if params.conversation_id.trim().is_empty() {
            return Err(RuntimeError::invalid_params("conversationId is required"));
        }
        let conversation = match &self.run_store {
            Some(store) => store.get_conversation(&params.conversation_id)?,
            None => None,
        };
        Ok(value(ConversationResult { conversation }))
    }

    pub fn conversation_upsert(
        &self,
        conversation: ConversationRecord,
    ) -> Result<AppResponse, RuntimeError> {
        validate_conversation_record(&conversation)?;
        if let Some(store) = &self.run_store {
            store.upsert_conversation(&conversation)?;
        }
        Ok(value(ConversationResult {
            conversation: Some(conversation),
        }))
    }

    pub fn conversation_delete(
        &self,
        params: ConversationIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        if params.conversation_id.trim().is_empty() {
            return Err(RuntimeError::invalid_params("conversationId is required"));
        }
        if let Some(store) = &self.run_store {
            store.delete_conversation(&params.conversation_id)?;
        }
        Ok(value(AckResult { ok: true }))
    }

    pub fn conversation_delete_all(&self) -> Result<AppResponse, RuntimeError> {
        if let Some(store) = &self.run_store {
            store.delete_all_conversations()?;
        }
        Ok(value(AckResult { ok: true }))
    }

    pub fn conversation_replace_id(
        &self,
        params: ConversationReplaceIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        if params.old_conversation_id.trim().is_empty() {
            return Err(RuntimeError::invalid_params(
                "oldConversationId is required",
            ));
        }
        if params.new_conversation_id.trim().is_empty() {
            return Err(RuntimeError::invalid_params(
                "newConversationId is required",
            ));
        }
        if let Some(store) = &self.run_store {
            store.replace_conversation_id(
                &params.old_conversation_id,
                &params.new_conversation_id,
            )?; // coverage:ignore-line
        }
        Ok(value(AckResult { ok: true }))
    }

    pub fn message_list(&self, params: ConversationIDParams) -> Result<AppResponse, RuntimeError> {
        if params.conversation_id.trim().is_empty() {
            return Err(RuntimeError::invalid_params("conversationId is required"));
        }
        let messages = match &self.run_store {
            Some(store) => store.list_messages(&params.conversation_id)?,
            None => Vec::new(),
        };
        Ok(value(MessageListResult { messages }))
    }

    pub fn message_get(&self, params: MessageIDParams) -> Result<AppResponse, RuntimeError> {
        if params.message_id.trim().is_empty() {
            return Err(RuntimeError::invalid_params("messageId is required"));
        }
        let message = match &self.run_store {
            Some(store) => store.get_message(&params.message_id)?,
            None => None,
        };
        Ok(value(MessageResult { message }))
    }

    pub fn message_upsert(&self, message: MessageRecord) -> Result<AppResponse, RuntimeError> {
        validate_message_record(&message)?;
        if let Some(store) = &self.run_store {
            store.upsert_message(&message)?;
        }
        Ok(value(MessageResult {
            message: Some(message),
        }))
    }

    pub fn message_delete(&self, params: MessageIDParams) -> Result<AppResponse, RuntimeError> {
        if params.message_id.trim().is_empty() {
            return Err(RuntimeError::invalid_params("messageId is required"));
        }
        if let Some(store) = &self.run_store {
            store.delete_message(&params.message_id)?; // coverage:ignore-line
        }
        Ok(value(AckResult { ok: true }))
    }

    pub fn pending_change_list(&self) -> Result<AppResponse, RuntimeError> {
        let pending_changes = match &self.run_store {
            Some(store) => store.list_pending_changes()?,
            None => Vec::new(),
        };
        Ok(value(PendingChangeListResult { pending_changes }))
    }

    pub fn pending_change_add(
        &self,
        change: PendingChangeRecord,
    ) -> Result<AppResponse, RuntimeError> {
        validate_pending_change_record(&change)?;
        let pending_change = match &self.run_store {
            Some(store) => store.add_pending_change(&change)?,
            None => change,
        };
        Ok(value(PendingChangeResult { pending_change }))
    }

    pub fn pending_change_update_data(
        &self,
        params: PendingChangeUpdateDataParams,
    ) -> Result<AppResponse, RuntimeError> {
        if params.id <= 0 {
            return Err(RuntimeError::invalid_params("id must be positive"));
        }
        if let Some(store) = &self.run_store {
            store.update_pending_change_data(params.id, &params.data)?;
        }
        Ok(value(AckResult { ok: true }))
    }

    pub fn pending_change_delete(
        &self,
        params: PendingChangeIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        if params.id <= 0 {
            return Err(RuntimeError::invalid_params("id must be positive"));
        }
        if let Some(store) = &self.run_store {
            store.delete_pending_change(params.id)?;
        }
        Ok(value(AckResult { ok: true }))
    }

    pub fn pending_change_clear(&self) -> Result<AppResponse, RuntimeError> {
        if let Some(store) = &self.run_store {
            store.clear_pending_changes()?;
        }
        Ok(value(AckResult { ok: true }))
    }

    pub fn prompt_queue_list(&self) -> Result<AppResponse, RuntimeError> {
        let queued_prompts = match &self.run_store {
            Some(store) => store.list_prompt_queue()?,
            None => Vec::new(),
        };
        Ok(value(PromptQueueListResult { queued_prompts }))
    }

    pub async fn prompt_queue_add(
        &mut self,
        prompt: PromptQueueRecord,
    ) -> Result<AppResponse, RuntimeError> {
        validate_prompt_queue_record(&prompt)?;
        let queued_prompt = match &self.run_store {
            Some(store) => store.add_prompt_queue(&prompt)?,
            None => prompt,
        };
        if queued_prompt.dispatch_timing != "immediate" {
            return Ok(value(PromptQueueResult {
                queued_prompt,
                run: None,
            }));
        }

        let (run, events) = self.dispatch_prompt_queue_record(&queued_prompt).await?;
        if let (Some(store), Some(id)) = (&self.run_store, queued_prompt.id) {
            store.delete_prompt_queue(id)?;
        } // coverage:ignore-line
        Ok(AppResponse::WithEvents {
            result: to_value(PromptQueueResult {
                queued_prompt,
                run: Some(run),
            }),
            events,
        })
    }

    pub async fn prompt_queue_dispatch_after_response(
        &mut self,
        params: PromptQueueDispatchAfterResponseParams,
    ) -> Result<AppResponse, RuntimeError> {
        let Some(store) = &self.run_store else {
            return Ok(value(PromptQueueDispatchResult {
                dispatched: false,
                queued_prompt: None,
                run: None,
                remaining: 0,
                message: "No prompt queue store is configured.".to_string(),
            }));
        };
        let conversation_id = params
            .conversation_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let queued_prompts = store.list_prompt_queue()?;
        let Some(queued_prompt) = queued_prompts
            .iter()
            .find(|prompt| {
                prompt.status == "queued"
                    && prompt.dispatch_timing == "after_response"
                    && conversation_id.is_none_or(|id| prompt.conversation_id == id)
            })
            .cloned()
        else {
            // coverage:ignore-start
            return Ok(value(PromptQueueDispatchResult {
                dispatched: false,
                queued_prompt: None,
                run: None,
                remaining: queued_prompts.len(),
                message: "No after-response queued prompt is ready.".to_string(),
            }));
            // coverage:ignore-end
        };

        let (run, events) = self.dispatch_prompt_queue_record(&queued_prompt).await?;
        if run.status != RunStatus::Failed {
            if let Some(id) = queued_prompt.id {
                if let Some(store) = &self.run_store {
                    // coverage:ignore-line
                    store.delete_prompt_queue(id)?; // coverage:ignore-line
                                                    // coverage:ignore-start
                }
            }
        }
        // coverage:ignore-end
        let remaining = self
            .run_store
            .as_ref()
            .map(SqliteRunStore::list_prompt_queue)
            .transpose()?
            .map_or(0, |prompts| prompts.len());

        Ok(AppResponse::WithEvents {
            result: to_value(PromptQueueDispatchResult {
                dispatched: true,
                queued_prompt: Some(queued_prompt),
                run: Some(run),
                remaining,
                message: "Dispatched after-response queued prompt.".to_string(),
            }),
            events,
        })
    }

    pub fn prompt_queue_delete(
        &self,
        params: PromptQueueIDParams,
    ) -> Result<AppResponse, RuntimeError> {
        if params.id <= 0 {
            return Err(RuntimeError::invalid_params("id must be positive"));
        }
        if let Some(store) = &self.run_store {
            store.delete_prompt_queue(params.id)?;
        }
        Ok(value(AckResult { ok: true }))
    }

    pub fn prompt_queue_clear(&self) -> Result<AppResponse, RuntimeError> {
        if let Some(store) = &self.run_store {
            store.clear_prompt_queue()?;
        }
        Ok(value(AckResult { ok: true }))
    }
}
