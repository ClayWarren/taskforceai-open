use crate::error::TaskForceAIError;
use crate::types::{
    SubmitTaskResponse, TaskForceAIOptions, TaskStatus, TaskStatusValue, TaskSubmissionOptions,
};
use crate::validation::{validate_submit_task_response, validate_task_status};
use base64::Engine;
use bytes::Bytes;
use std::time::Duration;
use tokio::time::sleep;

pub const DEFAULT_BASE_URL: &str = "https://taskforceai.chat/api/v1/developer";
pub const DEFAULT_TIMEOUT_SECS: u64 = 30;
pub const DEFAULT_POLL_INTERVAL_MS: u64 = 1000;
pub const DEFAULT_MAX_POLL_ATTEMPTS: u32 = 60;

pub struct TaskForceAI {
    pub(crate) api_key: String,
    pub(crate) base_url: String,
    pub(crate) mock_mode: bool,
    pub(crate) client: reqwest::Client,
    pub(crate) stream_client: reqwest::Client,
}

impl TaskForceAI {
    pub fn new(options: TaskForceAIOptions) -> Result<Self, TaskForceAIError> {
        let mock_mode = options.mock_mode.unwrap_or(false);
        let api_key = options.api_key.unwrap_or_default();

        if !mock_mode && api_key.is_empty() {
            return Err(TaskForceAIError::MissingApiKey);
        }

        let base_url = options
            .base_url
            .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
            .trim_end_matches('/')
            .to_string();

        let timeout = Duration::from_secs(options.timeout.unwrap_or(DEFAULT_TIMEOUT_SECS));

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(timeout)
            .build()?;
        let stream_client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(timeout)
            .build()?;

        Ok(Self {
            api_key,
            base_url,
            mock_mode,
            client,
            stream_client,
        })
    }

    pub(crate) fn with_sdk_headers(
        &self,
        mut request: reqwest::RequestBuilder,
    ) -> reqwest::RequestBuilder {
        if !self.api_key.is_empty() {
            request = request.header("x-api-key", &self.api_key);
        }
        request.header("X-SDK-Language", "rust")
    }

    pub(crate) async fn api_error_from_response(
        response: reqwest::Response,
        fallback_message: &'static str,
    ) -> TaskForceAIError {
        let status = response.status();
        let message = response
            .text()
            .await
            .unwrap_or_else(|_| fallback_message.to_string());
        TaskForceAIError::Api { status, message }
    }

    pub(crate) async fn request<T>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T, TaskForceAIError>
    where
        T: serde::de::DeserializeOwned,
    {
        if self.mock_mode {
            return self.mock_response(path, &method);
        }

        let url = format!("{}{}", self.base_url, path);
        let mut request = self.with_sdk_headers(self.client.request(method, &url));

        if let Some(b) = body {
            request = request.json(&b);
        }

        let response = request.send().await?;
        let status = response.status();

        if !status.is_success() {
            return Err(Self::api_error_from_response(
                response,
                "Failed to read error message from response body",
            )
            .await);
        }

        Ok(response.json().await?)
    }

    pub(crate) fn api_root_url(&self) -> String {
        self.base_url
            .strip_suffix("/developer")
            .unwrap_or(&self.base_url)
            .to_string()
    }

    fn mock_response<T>(&self, path: &str, method: &reqwest::Method) -> Result<T, TaskForceAIError>
    where
        T: serde::de::DeserializeOwned,
    {
        let val = if method == reqwest::Method::POST && path == "/run" {
            serde_json::json!({ "taskId": "mock-task-123" })
        } else if path.starts_with("/status/") {
            serde_json::json!({
                "taskId": "mock-task-123",
                "status": "completed",
                "result": "This is a mock response. Configure your API key to get real results."
            })
        } else {
            serde_json::json!({ "status": "ok" })
        };

        Ok(serde_json::from_value(val)?)
    }

    pub async fn submit_task(
        &self,
        prompt: &str,
        options: Option<TaskSubmissionOptions>,
    ) -> Result<String, TaskForceAIError> {
        if prompt.trim().is_empty() {
            return Err(TaskForceAIError::EmptyPrompt);
        }

        let mut body = serde_json::json!({ "prompt": prompt });
        if let Some(opts) = options {
            let images = opts.images.clone();
            let mut attachment_ids = opts.attachment_ids.clone().unwrap_or_default();
            let obj = body
                .as_object_mut()
                .expect("submit task request body is a JSON object");
            obj.insert("options".to_string(), serde_json::to_value(opts)?);
            if let Some(imgs) = images {
                for (index, image) in imgs.into_iter().enumerate() {
                    let encoded = image
                        .data
                        .rsplit_once(',')
                        .map(|(_, value)| value)
                        .unwrap_or(&image.data);
                    let decoded = base64::engine::general_purpose::STANDARD
                        .decode(encoded)
                        .map_err(|err| {
                            TaskForceAIError::Other(format!(
                                "Failed to decode image attachment {}: {}",
                                index, err
                            ))
                        })?;
                    let id = self
                        .upload_attachment(
                            image.name.as_deref().unwrap_or("attachment"),
                            Bytes::from(decoded),
                            Some(&image.mime_type),
                        )
                        .await?;
                    attachment_ids.push(id);
                }
            }
            if !attachment_ids.is_empty() {
                obj.insert(
                    "attachment_ids".to_string(),
                    serde_json::to_value(attachment_ids)?,
                );
            }
        }

        let response: SubmitTaskResponse = self
            .request(reqwest::Method::POST, "/run", Some(body))
            .await?;
        validate_submit_task_response(&response)?;
        Ok(response.task_id)
    }

    pub async fn get_task_status(&self, task_id: &str) -> Result<TaskStatus, TaskForceAIError> {
        if task_id.trim().is_empty() {
            return Err(TaskForceAIError::EmptyTaskId);
        }
        let status: TaskStatus = self
            .request(reqwest::Method::GET, &format!("/status/{}", task_id), None)
            .await?;
        validate_task_status(&status)?;
        Ok(status)
    }

    pub async fn wait_for_completion(
        &self,
        task_id: &str,
        poll_interval: Option<Duration>,
        max_attempts: Option<u32>,
    ) -> Result<TaskStatus, TaskForceAIError> {
        let interval = poll_interval.unwrap_or(Duration::from_millis(DEFAULT_POLL_INTERVAL_MS));
        let max = max_attempts.unwrap_or(DEFAULT_MAX_POLL_ATTEMPTS);

        for _ in 0..max {
            let status = self.get_task_status(task_id).await?;
            match status.status {
                TaskStatusValue::Completed => return Ok(status),
                TaskStatusValue::Failed => {
                    return Err(TaskForceAIError::TaskFailed(
                        status.error.unwrap_or_else(|| "Unknown error".to_string()),
                    ))
                }
                TaskStatusValue::Canceled => {
                    return Err(TaskForceAIError::TaskCanceled(
                        status.error.unwrap_or_else(|| "Task canceled".to_string()),
                    ))
                }
                TaskStatusValue::AwaitingApproval => {
                    return Err(TaskForceAIError::TaskAwaitingApproval(
                        status
                            .error
                            .unwrap_or_else(|| "Task is awaiting approval".to_string()),
                    ))
                }
                TaskStatusValue::Processing => (),
            }
            sleep(interval).await;
        }

        Err(TaskForceAIError::Timeout)
    }

    pub async fn run_task(
        &self,
        prompt: &str,
        options: Option<TaskSubmissionOptions>,
        poll_interval: Option<Duration>,
        max_attempts: Option<u32>,
    ) -> Result<TaskStatus, TaskForceAIError> {
        let task_id = self.submit_task(prompt, options).await?;
        self.wait_for_completion(&task_id, poll_interval, max_attempts)
            .await
    }
}
