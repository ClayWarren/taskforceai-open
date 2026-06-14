use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, SET_COOKIE};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::errors::ApiClientError;
use super::models::*;
use super::sse::{find_sse_boundary, parse_sse_frame};
use super::utils::{
    csrf_cookie_from_set_cookie, csrf_url_for_base, message_from_json_response, normalize_base_url,
    path_escape, preview_body, query_escape,
};

const APP_SERVER_USER_AGENT: &str = concat!("TaskForceAI-Desktop/", env!("CARGO_PKG_VERSION"));
const API_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub(super) const API_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const API_RUN_SUBMIT_TIMEOUT: Duration = Duration::from_secs(180);
pub(super) const API_ATTACHMENT_UPLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const API_STREAM_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Debug, Clone)]
pub struct ApiClient {
    base_url: String,
    http: reqwest::Client,
}

impl ApiClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: normalize_base_url(&base_url.into()),
            http: reqwest::Client::builder()
                .user_agent(APP_SERVER_USER_AGENT)
                .connect_timeout(API_CONNECT_TIMEOUT)
                .build()
                .expect("static app-server user agent should build"),
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub async fn check_health(&self) -> Result<ApiHealth, ApiClientError> {
        let url = format!("{}/health", self.base_url);
        let response = self
            .http
            .get(url)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        Ok(ApiHealth {
            healthy: response.status().is_success(),
            status: response.status().as_u16(),
        })
    }

    pub async fn submit_run(
        &self,
        token: &str,
        request: ApiSubmitRunRequest,
    ) -> Result<ApiSubmitRunResponse, ApiClientError> {
        let url = format!("{}/run", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .json(&request.to_body())
            .timeout(API_RUN_SUBMIT_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        let body = response.text().await?;
        serde_json::from_str(&body).map_err(|err| ApiClientError::UnexpectedResponse {
            context: "run submit".to_string(),
            reason: err.to_string(),
            preview: preview_body(&body),
        })
    }

    pub async fn upload_attachment(
        &self,
        token: &str,
        name: &str,
        data: Vec<u8>,
    ) -> Result<ApiAttachmentUploadResponse, ApiClientError> {
        let url = format!("{}/attachments/upload", self.base_url);
        let part = reqwest::multipart::Part::bytes(data).file_name(name.to_string());
        let form = reqwest::multipart::Form::new().part("file", part);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .multipart(form)
            .timeout(API_ATTACHMENT_UPLOAD_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        response.json().await.map_err(ApiClientError::Request)
    }

    pub async fn stream_run_events_to_sender(
        &self,
        token: &str,
        task_id: &str,
        sender: mpsc::Sender<ApiStreamEvent>,
    ) -> Result<(), ApiClientError> {
        let url = format!("{}/stream/{}", self.base_url, path_escape(task_id));
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("accept", "text/event-stream")
            .timeout(API_STREAM_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }

        let mut pending = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            pending.extend_from_slice(&chunk);
            while let Some((index, boundary_len)) = find_sse_boundary(&pending) {
                let frame = String::from_utf8_lossy(&pending[..index]).into_owned();
                pending.drain(..index + boundary_len);
                if let Some(event) = parse_sse_frame(&frame)? {
                    if sender.send(event).await.is_err() {
                        return Ok(());
                    }
                }
            }
        }
        if !pending.is_empty() {
            let frame = String::from_utf8_lossy(&pending);
            if let Some(event) = parse_sse_frame(&frame)? {
                let _ = sender.send(event).await;
            }
        }
        Ok(())
    }

    pub async fn cancel_run(&self, token: &str, task_id: &str) -> Result<(), ApiClientError> {
        let url = format!("{}/tasks/{}/cancel", self.base_url, path_escape(task_id));
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        Ok(())
    }

    pub async fn start_device_login(&self) -> Result<ApiDeviceLoginStart, ApiClientError> {
        let url = format!("{}/auth/device/start", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        log::info!(
            target: "auth",
            "Starting device login base_url={}",
            self.base_url
        );
        let response = self
            .http
            .post(url)
            .headers(csrf_headers)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            log::warn!(
                target: "auth",
                "Device login start failed status={}",
                response.status().as_u16()
            );
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        let started: ApiDeviceLoginStart =
            response.json().await.map_err(ApiClientError::Request)?;
        log::info!(
            target: "auth",
            "Device login started user_code={} verification_uri={}",
            started.user_code,
            started.verification_uri
        );
        Ok(started)
    }

    pub async fn poll_device_login(
        &self,
        device_code: &str,
    ) -> Result<ApiDeviceLoginPoll, ApiClientError> {
        let url = format!("{}/auth/device/token", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        log::info!(target: "auth", "Polling device login");
        let response = self
            .http
            .post(url)
            .headers(csrf_headers)
            .json(&json!({ "device_code": device_code }))
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            log::warn!(
                target: "auth",
                "Device login poll failed status={}",
                response.status().as_u16()
            );
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        let polled: ApiDeviceLoginPoll = response.json().await.map_err(ApiClientError::Request)?;
        log::info!(
            target: "auth",
            "Device login poll completed status={} token_present={}",
            polled.status,
            polled.access_token.as_deref().is_some_and(|token| !token.is_empty())
        );
        Ok(polled)
    }

    pub async fn list_models(&self) -> Result<ApiModelSelectorResponse, ApiClientError> {
        let url = format!("{}/api/v1/models", self.base_url);
        let response = self
            .http
            .get(url)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        response.json().await.map_err(ApiClientError::Request)
    }

    pub async fn sync_pull(
        &self,
        token: &str,
        request: ApiSyncPullRequest,
    ) -> Result<ApiSyncPullResponse, ApiClientError> {
        let url = format!("{}/api/v1/sync/pull", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .json(&request)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        response.json().await.map_err(ApiClientError::Request)
    }

    pub async fn sync_push(
        &self,
        token: &str,
        request: ApiSyncPushRequest,
    ) -> Result<ApiSyncPushResponse, ApiClientError> {
        let url = format!("{}/api/v1/sync/push", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .json(&request)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        response.json().await.map_err(ApiClientError::Request)
    }

    pub async fn sync_realtime_poll(
        &self,
        token: &str,
        last_event_id: Option<&str>,
    ) -> Result<ApiSyncRealtimePollResponse, ApiClientError> {
        let mut url = reqwest::Url::parse(&format!("{}/sync/realtime", self.base_url))
            .map_err(|err| ApiClientError::InvalidUrl(err.to_string()))?;
        if let Some(last_event_id) = last_event_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            url.query_pairs_mut().append_pair("last_id", last_event_id);
        }
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        response.json().await.map_err(ApiClientError::Request)
    }

    pub async fn list_projects(&self, token: &str) -> Result<Vec<ApiProject>, ApiClientError> {
        let url = format!("{}/projects", self.base_url);
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        response.json().await.map_err(ApiClientError::Request)
    }

    pub async fn current_user(&self, token: &str) -> Result<Value, ApiClientError> {
        self.get_value(token, "/auth/me").await
    }

    pub async fn update_settings(
        &self,
        token: &str,
        patch: Value,
    ) -> Result<String, ApiClientError> {
        let url = format!("{}/auth/settings", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .put(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .json(&patch)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        self.message_response(response, "Settings updated").await
    }

    pub async fn integrations(&self, token: &str) -> Result<Value, ApiClientError> {
        self.get_value(token, "/integrations").await
    }

    pub async fn disconnect_integration(
        &self,
        token: &str,
        provider: &str,
    ) -> Result<String, ApiClientError> {
        let provider = path_escape(provider);
        let url = format!("{}/integrations/{}", self.base_url, provider);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .delete(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        self.message_response(response, "Integration disconnected")
            .await
    }

    pub async fn subscription(&self, token: &str) -> Result<Value, ApiClientError> {
        self.get_value(token, "/payments").await
    }

    pub async fn billing_balance(&self, token: &str) -> Result<Value, ApiClientError> {
        self.get_value(token, "/billing/balance").await
    }

    pub async fn cancel_subscription(&self, token: &str) -> Result<String, ApiClientError> {
        let url = format!("{}/payments/cancel-subscription", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        self.message_response(response, "Subscription canceled")
            .await
    }

    pub async fn reactivate_subscription(&self, token: &str) -> Result<String, ApiClientError> {
        let url = format!("{}/payments/reactivate-subscription", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        self.message_response(response, "Subscription reactivated")
            .await
    }

    pub async fn upgrade_plan(&self, token: &str, plan: &str) -> Result<String, ApiClientError> {
        let url = format!("{}/auth/upgrade?plan={}", self.base_url, query_escape(plan));
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .put(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        self.message_response(response, "Plan updated").await
    }

    pub async fn export_gdpr_data(&self, token: &str) -> Result<String, ApiClientError> {
        let url = format!("{}/gdpr/export", self.base_url);
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        response.text().await.map_err(ApiClientError::Request)
    }

    pub async fn delete_account(
        &self,
        token: &str,
        confirm_email: &str,
    ) -> Result<String, ApiClientError> {
        let url = format!("{}/gdpr/delete-account", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .json(&json!({ "confirmEmail": confirm_email }))
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        self.message_response(response, "Account deleted").await
    }

    async fn get_value(&self, token: &str, path: &str) -> Result<Value, ApiClientError> {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        response.json().await.map_err(ApiClientError::Request)
    }

    async fn message_response(
        &self,
        response: reqwest::Response,
        fallback: &str,
    ) -> Result<String, ApiClientError> {
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        let text = response.text().await?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Ok(fallback.to_string());
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            if let Some(message) = message_from_json_response(&value, fallback) {
                return Ok(message);
            }
        }
        Ok(trimmed.to_string())
    }

    pub async fn create_project(
        &self,
        token: &str,
        request: ApiCreateProjectRequest,
    ) -> Result<ApiProject, ApiClientError> {
        let url = format!("{}/projects", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .post(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .json(&request)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        response.json().await.map_err(ApiClientError::Request)
    }

    pub async fn delete_project(&self, token: &str, project_id: i64) -> Result<(), ApiClientError> {
        let url = format!("{}/projects/{}", self.base_url, project_id);
        let csrf_headers = self.csrf_headers().await?;
        let response = self
            .http
            .delete(url)
            .bearer_auth(token)
            .headers(csrf_headers)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        Ok(())
    }

    async fn csrf_headers(&self) -> Result<HeaderMap, ApiClientError> {
        let response = self
            .http
            .get(csrf_url_for_base(&self.base_url)?)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }

        let cookie = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|header| header.to_str().ok())
            .find_map(csrf_cookie_from_set_cookie)
            .ok_or(ApiClientError::MissingCsrfCookie)?;
        let body: ApiCsrfResponse = response.json().await.map_err(ApiClientError::Request)?;

        let mut headers = HeaderMap::new();
        headers.insert(
            "X-CSRF-Token",
            HeaderValue::from_str(&body.csrf_token)
                .map_err(|err| ApiClientError::InvalidHeader(err.to_string()))?,
        );
        headers.insert(
            COOKIE,
            HeaderValue::from_str(&cookie)
                .map_err(|err| ApiClientError::InvalidHeader(err.to_string()))?,
        );
        Ok(headers)
    }
}
