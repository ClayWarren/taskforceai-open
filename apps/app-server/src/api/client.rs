use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, SET_COOKIE};
use serde::de::DeserializeOwned;
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

async fn decode_json_response<T: DeserializeOwned>(
    response: reqwest::Response,
    context: &str,
) -> Result<T, ApiClientError> {
    let status = response.status().as_u16();
    let body = response.text().await?;
    serde_json::from_str(&body).map_err(|err| {
        let preview = preview_body(&body);
        log::warn!(
            target: "api", // coverage:ignore-line
            "Invalid API JSON response context={} status={} error={} body_preview={}",
            context,
            status,
            err,
            preview
        );
        ApiClientError::UnexpectedResponse {
            context: context.to_string(),
            reason: err.to_string(),
            preview,
        }
    })
}

fn ensure_success(response: &reqwest::Response) -> Result<(), ApiClientError> {
    if response.status().is_success() {
        return Ok(());
    }
    Err(ApiClientError::Status {
        status: response.status().as_u16(),
    })
}

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

    pub async fn request_json(
        &self,
        token: &str,
        request: taskforceai_app_protocol::ApiRequestParams,
    ) -> Result<taskforceai_app_protocol::ApiRequestResult, ApiClientError> {
        let method = reqwest::Method::from_bytes(request.method.trim().as_bytes())
            .map_err(|error| ApiClientError::InvalidUrl(error.to_string()))?;
        let suffix = request
            .path
            .trim()
            .strip_prefix("/api/v1")
            .ok_or_else(|| ApiClientError::InvalidUrl(request.path.clone()))?;
        let url = format!("{}{}", self.base_url, suffix);
        let mut builder = self.authenticated_request(token, method, url).await?;
        if let Some(body) = request.body {
            builder = builder.json(&body);
        }
        let response = builder.send().await?;
        let status = response.status().as_u16();
        let text = response.text().await?;
        let body = if text.trim().is_empty() {
            None
        } else {
            Some(serde_json::from_str(&text).map_err(|error| {
                ApiClientError::UnexpectedResponse {
                    context: "desktop api bridge".to_string(),
                    reason: error.to_string(),
                    preview: preview_body(&text),
                }
            })?)
        };
        Ok(taskforceai_app_protocol::ApiRequestResult { status, body })
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
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .json(&request.to_body())
            .timeout(API_RUN_SUBMIT_TIMEOUT)
            .send()
            .await?;
        ensure_success(&response)?;
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
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .multipart(form)
            .timeout(API_ATTACHMENT_UPLOAD_TIMEOUT)
            .send()
            .await?;
        ensure_success(&response)?;
        decode_json_response(response, "attachment upload").await
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
            .send()
            .await?;
        ensure_success(&response)?;

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
                } // coverage:ignore-line
            }
        }
        if !pending.is_empty() {
            let frame = String::from_utf8_lossy(&pending);
            if let Some(event) = parse_sse_frame(&frame)? {
                let _ = sender.send(event).await;
            } // coverage:ignore-line
        }
        Ok(())
    }

    pub async fn cancel_run(&self, token: &str, task_id: &str) -> Result<(), ApiClientError> {
        let url = format!("{}/tasks/{}/cancel", self.base_url, path_escape(task_id));
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .send()
            .await?;
        ensure_success(&response)?;
        Ok(())
    }

    pub async fn respond_to_run_approval(
        &self,
        token: &str,
        task_id: &str,
        approved: bool,
        result: Option<Value>,
        error: Option<String>,
    ) -> Result<(), ApiClientError> {
        let url = format!("{}/tasks/{}/approve", self.base_url, path_escape(task_id));
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .json(&json!({
                "approved": approved,
                "result": result,
                "error": error,
            }))
            .send()
            .await?;
        ensure_success(&response)?;
        Ok(())
    }

    pub async fn steer_run(
        &self,
        token: &str,
        task_id: &str,
        input: &str,
    ) -> Result<(), ApiClientError> {
        let url = format!("{}/tasks/{}/steer", self.base_url, path_escape(task_id));
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .json(&json!({ "input": input }))
            .send()
            .await?;
        ensure_success(&response)?;
        Ok(())
    }

    pub async fn start_device_login(&self) -> Result<ApiDeviceLoginStart, ApiClientError> {
        let url = format!("{}/auth/device/start", self.base_url);
        let csrf_headers = self.csrf_headers().await?;
        log::info!(
            target: "auth", // coverage:ignore-line
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
                target: "auth", // coverage:ignore-line
                "Device login start failed status={}",
                response.status().as_u16() // coverage:ignore-line
            );
            return Err(ApiClientError::Status {
                status: response.status().as_u16(),
            });
        }
        let started: ApiDeviceLoginStart =
            decode_json_response(response, "device login start").await?;
        log::info!(
            target: "auth", // coverage:ignore-line
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
        let status = response.status();
        let has_device_login_outcome = matches!(status.as_u16(), 404 | 409 | 410 | 429);
        if !status.is_success() && !has_device_login_outcome {
            log::warn!(
                target: "auth", // coverage:ignore-line
                "Device login poll failed status={}",
                status.as_u16() // coverage:ignore-line
            );
            return Err(ApiClientError::Status {
                status: status.as_u16(),
            });
        }
        let polled: ApiDeviceLoginPoll =
            decode_json_response(response, "device login poll").await?;
        log::info!(
            target: "auth", // coverage:ignore-line
            "Device login poll completed status={} token_present={}",
            polled.status,
            polled.access_token.as_deref().is_some_and(|token| !token.is_empty()) // coverage:ignore-line
        );
        Ok(polled)
    }

    pub async fn list_models(&self) -> Result<ApiModelSelectorResponse, ApiClientError> {
        let url = format!("{}/models", self.base_url);
        let response = self
            .http
            .get(url)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        ensure_success(&response)?;
        decode_json_response(response, "model list").await
    }

    pub async fn sync_pull(
        &self,
        token: &str,
        request: ApiSyncPullRequest,
    ) -> Result<ApiSyncPullResponse, ApiClientError> {
        let url = format!("{}/sync/pull", self.base_url);
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .json(&request)
            .send()
            .await?;
        ensure_success(&response)?;
        decode_json_response(response, "sync pull").await
    }

    pub async fn sync_push(
        &self,
        token: &str,
        request: ApiSyncPushRequest,
    ) -> Result<ApiSyncPushResponse, ApiClientError> {
        let url = format!("{}/sync/push", self.base_url);
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .json(&request)
            .send()
            .await?;
        ensure_success(&response)?;
        decode_json_response(response, "sync push").await
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
        self.authenticated_get_json(token, url, "sync realtime poll")
            .await
    }

    pub async fn remote_upsert_target(
        &self,
        token: &str,
        device_id: &str,
        device_credential: &str,
        device_name: &str,
        allow_connections: bool,
        keep_awake: bool,
    ) -> Result<ApiRemoteTarget, ApiClientError> {
        let url = format!("{}/remote/target", self.base_url);
        let response = self
            .authenticated_request(token, reqwest::Method::PUT, url)
            .await?
            .header("X-Device-Id", device_id)
            .header("X-Device-Credential", device_credential)
            .json(&json!({
                "deviceName": device_name,
                "allowConnections": allow_connections,
                "keepAwake": keep_awake,
            }))
            .send()
            .await?;
        ensure_success(&response)?;
        decode_json_response(response, "remote target update").await
    }

    pub async fn remote_create_pairing_code(
        &self,
        token: &str,
        device_id: &str,
        device_credential: &str,
        device_name: &str,
    ) -> Result<ApiRemotePairingCode, ApiClientError> {
        let url = format!("{}/remote/pairing-code", self.base_url);
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .header("X-Device-Id", device_id)
            .header("X-Device-Credential", device_credential)
            .json(&json!({ "deviceName": device_name }))
            .send()
            .await?;
        ensure_success(&response)?;
        decode_json_response(response, "remote pairing code").await
    }

    pub async fn remote_list_controllers(
        &self,
        token: &str,
        device_id: &str,
        device_credential: &str,
    ) -> Result<ApiRemoteControllers, ApiClientError> {
        let url = format!("{}/remote/controllers", self.base_url);
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("X-Device-Id", device_id)
            .header("X-Device-Credential", device_credential)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        ensure_success(&response)?;
        decode_json_response(response, "remote controllers").await
    }

    pub async fn remote_revoke_controller(
        &self,
        token: &str,
        device_id: &str,
        device_credential: &str,
        controller_device_id: &str,
    ) -> Result<(), ApiClientError> {
        let url = format!(
            "{}/remote/controllers/{}",
            self.base_url,
            path_escape(controller_device_id)
        );
        let response = self
            .authenticated_request(token, reqwest::Method::DELETE, url)
            .await?
            .header("X-Device-Id", device_id)
            .header("X-Device-Credential", device_credential)
            .send()
            .await?;
        ensure_success(&response)
    }

    pub async fn remote_poll_commands(
        &self,
        token: &str,
        device_id: &str,
        device_credential: &str,
        last_id: &str,
    ) -> Result<ApiRemoteCommandPoll, ApiClientError> {
        let mut url = reqwest::Url::parse(&format!(
            "{}/remote/devices/{}/commands",
            self.base_url,
            path_escape(device_id)
        ))
        .map_err(|err| ApiClientError::InvalidUrl(err.to_string()))?;
        url.query_pairs_mut()
            .append_pair("lastId", last_id)
            .append_pair("waitMs", "5000");
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("X-Device-Id", device_id)
            .header("X-Device-Credential", device_credential)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        ensure_success(&response)?;
        decode_json_response(response, "remote command poll").await
    }

    pub async fn remote_submit_result(
        &self,
        token: &str,
        device_id: &str,
        device_credential: &str,
        command_id: &str,
        controller_device_id: &str,
        response_body: &Value,
    ) -> Result<(), ApiClientError> {
        let url = format!(
            "{}/remote/devices/{}/commands/{}/result",
            self.base_url,
            path_escape(device_id),
            path_escape(command_id)
        );
        // This is a native bearer-authenticated request. Sending a freshly
        // minted browser CSRF cookie first adds a full network round trip and
        // is unnecessary for clients that do not carry a browser session.
        let response = self
            .http
            .put(url)
            .bearer_auth(token)
            .header("X-Device-Id", device_id)
            .header("X-Device-Credential", device_credential)
            .json(&json!({
                "response": {
                    "controllerDeviceId": controller_device_id,
                    "response": response_body,
                }
            }))
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        ensure_success(&response)
    }

    pub async fn list_projects(&self, token: &str) -> Result<Vec<ApiProject>, ApiClientError> {
        let url = format!("{}/projects", self.base_url);
        self.authenticated_get_json(token, url, "project list")
            .await
    }

    pub async fn list_artifacts(
        &self,
        token: &str,
        limit: usize,
    ) -> Result<Vec<ApiArtifact>, ApiClientError> {
        let mut url = reqwest::Url::parse(&format!("{}/artifacts", self.base_url))
            .map_err(|err| ApiClientError::InvalidUrl(err.to_string()))?;
        url.query_pairs_mut()
            .append_pair("limit", &limit.to_string())
            .append_pair("offset", "0")
            .append_pair("include", "currentVersion");
        self.authenticated_get_json(token, url, "artifact list")
            .await
    }

    pub async fn get_artifact(
        &self,
        token: &str,
        artifact_id: &str,
    ) -> Result<ApiArtifact, ApiClientError> {
        let url = format!("{}/artifacts/{}", self.base_url, path_escape(artifact_id));
        self.authenticated_get_json(token, url, "artifact detail")
            .await
    }

    pub async fn list_artifact_versions(
        &self,
        token: &str,
        artifact_id: &str,
    ) -> Result<Vec<ApiArtifactVersion>, ApiClientError> {
        let url = format!(
            "{}/artifacts/{}/versions",
            self.base_url,
            path_escape(artifact_id)
        );
        self.authenticated_get_json(token, url, "artifact versions")
            .await
    }

    pub async fn create_artifact_public_link(
        &self,
        token: &str,
        artifact_id: &str,
    ) -> Result<ApiArtifactShare, ApiClientError> {
        let url = format!(
            "{}/artifacts/{}/share/public",
            self.base_url,
            path_escape(artifact_id)
        );
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .send()
            .await?;
        ensure_success(&response)?;
        decode_json_response(response, "artifact public link").await
    }

    pub async fn delete_artifact(
        &self,
        token: &str,
        artifact_id: &str,
    ) -> Result<(), ApiClientError> {
        let url = format!("{}/artifacts/{}", self.base_url, path_escape(artifact_id));
        let response = self
            .authenticated_request(token, reqwest::Method::DELETE, url)
            .await?
            .send()
            .await?;
        ensure_success(&response)?;
        Ok(())
    }

    pub async fn download_file_content(
        &self,
        token: &str,
        file_id: &str,
    ) -> Result<Vec<u8>, ApiClientError> {
        let url = format!(
            "{}/developer/files/{}/content?disposition=attachment",
            self.base_url,
            path_escape(file_id)
        );
        let response = self.authenticated_get(token, url).await?;
        response
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(ApiClientError::Request)
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
        let response = self
            .authenticated_request(token, reqwest::Method::PUT, url)
            .await?
            .json(&patch)
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
        let response = self
            .authenticated_request(token, reqwest::Method::DELETE, url)
            .await?
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
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .send()
            .await?;
        self.message_response(response, "Subscription canceled")
            .await
    }

    pub async fn reactivate_subscription(&self, token: &str) -> Result<String, ApiClientError> {
        let url = format!("{}/payments/reactivate-subscription", self.base_url);
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .send()
            .await?;
        self.message_response(response, "Subscription reactivated")
            .await
    }

    pub async fn upgrade_plan(&self, token: &str, plan: &str) -> Result<String, ApiClientError> {
        let url = format!("{}/auth/upgrade?plan={}", self.base_url, query_escape(plan));
        let response = self
            .authenticated_request(token, reqwest::Method::PUT, url)
            .await?
            .send()
            .await?;
        self.message_response(response, "Plan updated").await
    }

    pub async fn export_gdpr_data(&self, token: &str) -> Result<String, ApiClientError> {
        let url = format!("{}/gdpr/export", self.base_url);
        let response = self.authenticated_get(token, url).await?;
        response.text().await.map_err(ApiClientError::Request)
    }

    pub async fn delete_account(
        &self,
        token: &str,
        confirm_email: &str,
    ) -> Result<String, ApiClientError> {
        let url = format!("{}/gdpr/delete-account", self.base_url);
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .json(&json!({ "confirmEmail": confirm_email }))
            .send()
            .await?;
        self.message_response(response, "Account deleted").await
    }

    async fn get_value(&self, token: &str, path: &str) -> Result<Value, ApiClientError> {
        let url = format!("{}{}", self.base_url, path);
        self.authenticated_get_json(token, url, path).await
    }

    async fn authenticated_get(
        &self,
        token: &str,
        url: impl reqwest::IntoUrl,
    ) -> Result<reqwest::Response, ApiClientError> {
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        ensure_success(&response)?;
        Ok(response)
    }

    async fn authenticated_get_json<T>(
        &self,
        token: &str,
        url: impl reqwest::IntoUrl,
        context: &str,
    ) -> Result<T, ApiClientError>
    where
        T: DeserializeOwned,
    {
        let response = self.authenticated_get(token, url).await?;
        decode_json_response(response, context).await
    }

    async fn authenticated_request(
        &self,
        token: &str,
        method: reqwest::Method,
        url: impl reqwest::IntoUrl,
    ) -> Result<reqwest::RequestBuilder, ApiClientError> {
        Ok(self
            .http
            .request(method, url)
            .bearer_auth(token)
            .headers(self.csrf_headers().await?)
            .timeout(API_REQUEST_TIMEOUT))
    }

    async fn message_response(
        &self,
        response: reqwest::Response,
        fallback: &str,
    ) -> Result<String, ApiClientError> {
        ensure_success(&response)?;
        let text = response.text().await?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Ok(fallback.to_string()); // coverage:ignore-line
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            if let Some(message) = message_from_json_response(&value, fallback) {
                return Ok(message);
                // coverage:ignore-start
            }
        }
        Ok(trimmed.to_string())
        // coverage:ignore-end
    }

    pub async fn create_project(
        &self,
        token: &str,
        request: ApiCreateProjectRequest,
    ) -> Result<ApiProject, ApiClientError> {
        let url = format!("{}/projects", self.base_url);
        let response = self
            .authenticated_request(token, reqwest::Method::POST, url)
            .await?
            .json(&request)
            .send()
            .await?;
        ensure_success(&response)?;
        decode_json_response(response, "project create").await
    }

    pub async fn delete_project(&self, token: &str, project_id: i64) -> Result<(), ApiClientError> {
        let url = format!("{}/projects/{}", self.base_url, project_id);
        let response = self
            .authenticated_request(token, reqwest::Method::DELETE, url)
            .await?
            .send()
            .await?;
        ensure_success(&response)?;
        Ok(())
    }

    async fn csrf_headers(&self) -> Result<HeaderMap, ApiClientError> {
        let response = self
            .http
            .get(csrf_url_for_base(&self.base_url)?)
            .timeout(API_REQUEST_TIMEOUT)
            .send()
            .await?;
        ensure_success(&response)?;

        let cookie = response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|header| header.to_str().ok())
            .find_map(csrf_cookie_from_set_cookie)
            .ok_or(ApiClientError::MissingCsrfCookie)?;
        let body: ApiCsrfResponse = decode_json_response(response, "csrf").await?;

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
