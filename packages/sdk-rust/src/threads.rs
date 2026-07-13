use crate::client::TaskForceAI;
use crate::error::TaskForceAIError;
use crate::validation::{
    validate_thread, validate_thread_list, validate_thread_messages, validate_thread_run,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Represents a conversation thread.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thread {
    pub id: i64,
    pub timestamp: String,
    pub user_input: String,
    pub result: String,
    pub execution_time: i64,
    pub model: String,
    pub agent_count: i64,
    pub sources: Option<Vec<serde_json::Value>>,
    #[serde(rename = "agentStatuses")]
    pub agent_statuses: Option<Vec<serde_json::Value>>,
    #[serde(rename = "toolEvents")]
    pub tool_events: Option<Vec<serde_json::Value>>,
}

/// Represents a message within a thread.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadMessage {
    pub id: i64,
    pub thread_id: i64,
    pub role: String, // "user" or "assistant"
    pub content: String,
    #[serde(default)]
    pub message_id: Option<String>,
    #[serde(default)]
    pub is_agent_status: bool,
    #[serde(default)]
    pub elapsed_seconds: Option<f64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub sources: Option<serde_json::Value>,
    #[serde(default)]
    pub tool_events: Option<serde_json::Value>,
    #[serde(default)]
    pub agent_statuses: Option<serde_json::Value>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub rating: i32,
}

/// Options for creating a thread.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CreateThreadOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing)]
    pub messages: Option<Vec<ThreadMessage>>,
    #[serde(skip_serializing)]
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

/// Response containing a list of threads.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadListResponse {
    pub conversations: Vec<Thread>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
    pub has_more: bool,
}

/// Response containing messages from a thread.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadMessagesResponse {
    pub messages: Vec<ThreadMessage>,
    #[serde(default)]
    pub truncated: bool,
}

/// Options for running a prompt in a thread.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRunOptions {
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    #[serde(skip_serializing)]
    pub options: Option<HashMap<String, serde_json::Value>>,
}

/// Response from running in a thread.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadRunResponse {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub status: String,
}

impl TaskForceAI {
    /// Creates a new conversation thread.
    pub async fn create_thread(
        &self,
        options: Option<CreateThreadOptions>,
    ) -> Result<Thread, TaskForceAIError> {
        let body = options
            .map(serde_json::to_value)
            .transpose()?
            .unwrap_or_else(|| serde_json::json!({}));

        let thread: Thread = self
            .request(reqwest::Method::POST, "/threads", Some(body))
            .await?;
        validate_thread(&thread, "thread")?;
        Ok(thread)
    }

    /// Retrieves a list of threads.
    pub async fn list_threads(
        &self,
        limit: i32,
        offset: i32,
    ) -> Result<ThreadListResponse, TaskForceAIError> {
        let path = format!("/threads?limit={}&offset={}", limit, offset);
        let response: ThreadListResponse = self.request(reqwest::Method::GET, &path, None).await?;
        validate_thread_list(&response)?;
        Ok(response)
    }

    /// Retrieves a specific thread by ID.
    pub async fn get_thread(&self, thread_id: i64) -> Result<Thread, TaskForceAIError> {
        let path = format!("/threads/{}", thread_id);
        let thread: Thread = self.request(reqwest::Method::GET, &path, None).await?;
        validate_thread(&thread, "thread")?;
        Ok(thread)
    }

    /// Returns an error because deleting threads is not currently supported by the Developer API.
    pub async fn delete_thread(&self, thread_id: i64) -> Result<(), TaskForceAIError> {
        Err(TaskForceAIError::Other(format!(
            "delete_thread is not supported by the current Developer API (thread_id={})",
            thread_id
        )))
    }

    /// Retrieves messages from a thread.
    pub async fn get_thread_messages(
        &self,
        thread_id: i64,
        limit: i32,
        offset: i32,
    ) -> Result<ThreadMessagesResponse, TaskForceAIError> {
        let path = format!(
            "/threads/{}/messages?limit={}&offset={}",
            thread_id, limit, offset
        );
        let response: ThreadMessagesResponse =
            self.request(reqwest::Method::GET, &path, None).await?;
        validate_thread_messages(&response)?;
        Ok(response)
    }

    /// Submits a prompt within a thread context.
    pub async fn run_in_thread(
        &self,
        thread_id: i64,
        options: ThreadRunOptions,
    ) -> Result<ThreadRunResponse, TaskForceAIError> {
        if options.prompt.trim().is_empty() {
            return Err(TaskForceAIError::EmptyPrompt);
        }

        let path = format!("/threads/{}/runs", thread_id);
        let body = serde_json::to_value(options)?;

        let response: ThreadRunResponse = self
            .request(reqwest::Method::POST, &path, Some(body))
            .await?;
        validate_thread_run(&response)?;
        Ok(response)
    }
}
