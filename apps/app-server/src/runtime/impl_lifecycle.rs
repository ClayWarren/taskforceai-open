use std::collections::BTreeMap;
use std::sync::{Arc, Mutex as StdMutex};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::Deserialize;
use serde_json::json;
use serde_json::Value;
use tokio::sync::mpsc;

use crate::api::ApiClient;
use crate::mcp::AppServerMcpManager;
use crate::protocol::*;
use taskforceai_app_store::SqliteRunStore;

use super::error::RuntimeError;
use super::util::*;
use super::{AuthTokenStorage, RuntimeConfig};

#[derive(Debug, Deserialize)]
struct TokenDisplayClaims {
    #[serde(default)]
    sub: Option<String>,
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    full_name: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    picture: Option<String>,
}

fn value_to_string(value: Option<Value>) -> Option<String> {
    match value {
        Some(Value::String(value)) if !value.trim().is_empty() => Some(value),
        Some(Value::Number(value)) => Some(value.to_string()),
        _ => None,
    }
}

fn auth_user_from_token(token: &str) -> Option<AuthUserStatus> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let claims: TokenDisplayClaims = serde_json::from_slice(&decoded).ok()?;
    let id = value_to_string(claims.id).or(claims.sub);
    let full_name = claims.full_name.or(claims.name);
    let image = claims.image.or(claims.picture);
    if id.is_none() && claims.email.is_none() && full_name.is_none() && image.is_none() {
        return None;
    }
    Some(AuthUserStatus {
        id,
        email: claims.email,
        full_name,
        image,
    })
}

impl super::AppRuntime {
    pub fn new(config: RuntimeConfig) -> Self {
        Self::try_new(config).expect("app runtime should initialize")
    }

    pub fn try_new(config: RuntimeConfig) -> Result<Self, RuntimeError> {
        let run_store = config.run_store_path.clone().map(SqliteRunStore::new);
        let loaded_runs = match &run_store {
            Some(store) => store.load()?,
            None => Vec::new(),
        };
        let loaded_pending_prompts = match &run_store {
            Some(store) => store.list_pending_prompts()?,
            None => Vec::new(),
        };
        if matches!(
            config.auth_token_storage,
            AuthTokenStorage::KeyringWithMemoryFallback
        ) {
            if let Some(store) = &run_store {
                store.set_metadata("auth_token", "")?;
            }
        }
        let next_run_sequence = next_run_sequence(&loaded_runs);

        let api_client = ApiClient::new(config.api_base_url.clone());

        Ok(Self {
            config,
            run_store,
            runs: loaded_runs
                .into_iter()
                .map(|run| (run.id.clone(), run))
                .collect(),
            private_run_ids: Default::default(),
            pending_prompts: loaded_pending_prompts
                .into_iter()
                .map(|prompt| (prompt.id.clone(), prompt))
                .collect(),
            active_attachments: Vec::new(),
            memory_metadata: BTreeMap::new(),
            auth_token_cache: StdMutex::new(None),
            next_run_sequence,
            event_sender: None,
            interaction_broker: None,
            api_client,
            mcp_manager: Arc::new(AppServerMcpManager::default()),
            mock_server: None,
        })
    }

    pub fn set_event_sender(&mut self, sender: mpsc::Sender<AppServerEvent>) {
        self.event_sender = Some(sender);
    }

    pub(crate) fn set_interaction_broker(
        &mut self,
        broker: crate::interactions::InteractionBroker,
    ) {
        self.mcp_manager.set_interaction_broker(broker.clone());
        self.interaction_broker = Some(broker);
    }

    pub fn initialize(&self, params: InitializeParams) -> AppResponse {
        self.initialize_with_transport("stdio", "jsonl", params)
    }

    pub fn initialize_with_transport(
        &self,
        kind: &str,
        encoding: &str,
        params: InitializeParams,
    ) -> AppResponse {
        let client = params.capabilities;
        value(InitializeResult {
            server: self.config.server_info.clone(),
            transport: TransportInfo {
                kind: kind.to_string(),
                encoding: encoding.to_string(),
            },
            capabilities: Capabilities {
                auth: true,
                runs: true,
                history: true,
                pending_prompts: true,
                projects: true,
                attachments: true,
                context: true,
                memory: true,
                mcp: true,
                sync: true,
                events: true,
                skills: true,
                plugins: true,
                computer_use: true,
                browser: true,
                agent_sessions: true,
                threads: true,
                turns: true,
                diagnostics: true,
                channels: true,
                schedules: true,
                workflows: true,
                voice: true,
                git_review: true,
            },
            negotiated: NegotiatedCapabilities {
                experimental_api: client.experimental_api,
                bidirectional_requests: client.bidirectional_requests,
                request_user_input: client.bidirectional_requests && client.request_user_input,
                mcp_elicitation: client.bidirectional_requests && client.mcp_elicitation,
                dynamic_tools: client.experimental_api
                    && client.bidirectional_requests
                    && client.dynamic_tools,
            },
        })
    }

    pub fn ping(&self) -> AppResponse {
        AppResponse::Value(json!({"ok": true}))
    }

    pub fn shutdown(&self) -> AppResponse {
        AppResponse::Shutdown(to_value(AckResult { ok: true }))
    }

    pub fn config_get(&self) -> AppResponse {
        value(ConfigResult {
            runtime: RuntimeInfo { local: true },
        })
    }

    pub async fn api_health(&self) -> Result<AppResponse, RuntimeError> {
        let health = self.api_client.check_health().await?;
        Ok(value(ApiHealthResult {
            healthy: health.healthy,
            status: health.status,
            base_url: self.api_client.base_url().to_string(),
        }))
    }

    pub fn auth_status(&self) -> AppResponse {
        let token = self.auth_token().ok().flatten();
        value(AuthStatus {
            authenticated: token.is_some(),
            user: token.as_deref().and_then(auth_user_from_token),
        })
    }

    pub fn auth_logout(&mut self) -> Result<AppResponse, RuntimeError> {
        self.set_auth_token(None)?;
        self.remote_disable_on_logout()?;
        Ok(value(AuthStatus {
            authenticated: false,
            user: None,
        }))
    }

    pub async fn auth_device_start(&self) -> Result<AppResponse, RuntimeError> {
        let started = self.api_client.start_device_login().await?;
        Ok(value(DeviceLoginStartResult {
            device_code: started.device_code,
            user_code: started.user_code,
            verification_uri: started.verification_uri,
            verification_uri_complete: started.verification_uri_complete,
            expires_in: started.expires_in,
            interval: started.interval,
        }))
    }

    pub async fn auth_device_poll(
        &mut self,
        params: DeviceLoginPollParams,
    ) -> Result<AppResponse, RuntimeError> {
        let polled = self
            .api_client
            .poll_device_login(&params.device_code)
            .await?;
        log::info!(
            target: "auth", // coverage:ignore-line
            "Runtime received device login poll result status={} token_present={}",
            polled.status,
            polled.access_token.as_deref().is_some_and(|token| !token.is_empty()) // coverage:ignore-line
        );
        if polled.status == "approved" {
            if let Some(token) = polled
                .access_token
                .as_deref()
                .filter(|token| !token.is_empty())
            {
                self.set_auth_token(Some(token))?;
                log::info!(target: "auth", "Stored desktop auth token from device login");
            } else {
                log::warn!(
                    target: "auth", // coverage:ignore-line
                    "Device login approved without an access token"
                );
            }
        }
        Ok(value(DeviceLoginPollResult {
            status: polled.status,
            token: polled.access_token,
            expires_in: polled.expires_in,
            interval: polled.interval,
            message: polled.message,
        }))
    }
}
