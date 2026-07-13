use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};

use tokio::sync::mpsc;

use crate::api::{ApiClient, DEFAULT_API_BASE_URL};
use crate::interactions::InteractionBroker;
use crate::mcp::AppServerMcpManager;
use crate::ollama::DEFAULT_OLLAMA_BASE_URL;
use crate::protocol::{
    AppServerEvent, AttachmentRecord, PendingPromptRecord, RunRecord, ServerInfo,
};
use taskforceai_app_store::SqliteRunStore;

pub(crate) const DEFAULT_KEYCHAIN_SERVICE: &str = "com.taskforceai.app-server.auth";
pub(crate) const KEYCHAIN_AUTH_USER: &str = "auth_token";
pub(crate) const MOCK_SERVER_PORT: u16 = 4321;
pub(crate) const MOCK_RESULT: &str =
    "This is a mock response. Configure your API key to get real results.";
pub(crate) const HYBRID_ROLE: &str = "Skeptic";
pub(crate) const AGENT_SESSIONS_METADATA_KEY: &str = "agent_sessions";
pub(crate) const THREADS_METADATA_KEY: &str = "threads_v2";
pub(crate) const CHANNELS_METADATA_KEY: &str = "channels";
pub(crate) const SCHEDULES_METADATA_KEY: &str = "schedules";
pub(crate) const WORKFLOWS_METADATA_KEY: &str = "workflows";
pub(crate) const WORKFLOW_RUNS_METADATA_KEY: &str = "workflow_runs";

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub server_info: ServerInfo,
    pub run_store_path: Option<PathBuf>,
    pub simulate_run_progress: bool,
    pub api_base_url: String,
    pub auth_token_storage: AuthTokenStorage,
    pub auth_keychain_service: String,
    #[cfg(test)]
    pub(crate) auth_keychain: Option<TestAuthKeychain>,
    pub remote_model_catalog: bool,
    pub live_mcp_adapter: bool,
    pub remote_sync: bool,
    pub ollama_base_url: String,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            server_info: ServerInfo {
                version: env!("CARGO_PKG_VERSION").to_string(),
                ..ServerInfo::default()
            },
            run_store_path: None,
            simulate_run_progress: false,
            api_base_url: DEFAULT_API_BASE_URL.to_string(),
            auth_token_storage: AuthTokenStorage::Memory,
            auth_keychain_service: DEFAULT_KEYCHAIN_SERVICE.to_string(),
            #[cfg(test)]
            auth_keychain: None,
            remote_model_catalog: false,
            live_mcp_adapter: false,
            remote_sync: false,
            ollama_base_url: DEFAULT_OLLAMA_BASE_URL.to_string(),
        }
    }
}

impl RuntimeConfig {
    pub fn from_env() -> Self {
        Self {
            run_store_path: util::default_run_store_path(),
            simulate_run_progress: true,
            api_base_url: util::api_base_url_from_env(),
            auth_token_storage: AuthTokenStorage::KeyringWithMemoryFallback,
            auth_keychain_service: std::env::var("TASKFORCE_APP_SERVER_KEYCHAIN_SERVICE")
                .ok()
                .filter(|service| !service.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_KEYCHAIN_SERVICE.to_string()),
            remote_model_catalog: true,
            live_mcp_adapter: true,
            remote_sync: true,
            ollama_base_url: util::ollama_base_url_from_env(),
            ..Self::default()
        }
    }

    pub fn with_run_store_path(mut self, path: impl Into<PathBuf>) -> Self {
        self.run_store_path = Some(path.into());
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthTokenStorage {
    Memory,
    KeyringWithMemoryFallback,
}

#[cfg(test)]
#[derive(Debug, Clone)]
pub(crate) struct TestAuthKeychain {
    token: Arc<StdMutex<Option<String>>>,
    fail_get: bool,
    fail_set: bool,
    fail_delete: bool,
}

#[cfg(test)]
impl TestAuthKeychain {
    pub(crate) fn new(token: Option<&str>) -> Self {
        Self::with_failures(token, false, false, false)
    }

    pub(crate) fn with_failures(
        token: Option<&str>,
        fail_get: bool,
        fail_set: bool,
        fail_delete: bool,
    ) -> Self {
        Self {
            token: Arc::new(StdMutex::new(token.map(str::to_string))),
            fail_get,
            fail_set,
            fail_delete,
        }
    }

    pub(crate) fn get(&self) -> Result<Option<String>, String> {
        if self.fail_get {
            Err("test keychain get failed".to_string())
        } else {
            Ok(self
                .token
                .lock()
                .expect("test keychain should not be poisoned")
                .clone())
        }
    }

    pub(crate) fn set(&self, token: &str) -> Result<(), String> {
        if self.fail_set {
            Err("test keychain set failed".to_string())
        } else {
            *self
                .token
                .lock()
                .expect("test keychain should not be poisoned") = Some(token.to_string());
            Ok(())
        }
    }

    pub(crate) fn delete(&self) -> Result<(), String> {
        if self.fail_delete {
            Err("test keychain delete failed".to_string())
        } else {
            *self
                .token
                .lock()
                .expect("test keychain should not be poisoned") = None;
            Ok(())
        }
    }
}

#[derive(Debug)]
pub struct AppRuntime {
    pub(crate) config: RuntimeConfig,
    pub(crate) run_store: Option<SqliteRunStore>,
    pub(crate) runs: BTreeMap<String, RunRecord>,
    pub(crate) private_run_ids: HashSet<String>,
    pub(crate) pending_prompts: BTreeMap<String, PendingPromptRecord>,
    pub(crate) active_attachments: Vec<AttachmentRecord>,
    pub(crate) memory_metadata: BTreeMap<String, String>,
    pub(crate) auth_token_cache: StdMutex<Option<Option<String>>>,
    pub(crate) next_run_sequence: u64,
    pub(crate) event_sender: Option<mpsc::Sender<AppServerEvent>>,
    pub(crate) interaction_broker: Option<InteractionBroker>,
    pub(crate) api_client: ApiClient,
    pub(crate) mcp_manager: Arc<AppServerMcpManager>,
    pub(crate) mock_server: Option<MockServerHandle>,
}

mod approval;
mod error;
mod format;
mod mcp_util;
mod orchestration;
mod run_events;
mod settings_util;
mod util;

mod impl_channels_schedules;
mod impl_commands;
mod impl_commands_account;
mod impl_commands_artifacts;
mod impl_commands_models;
mod impl_commands_modes;
mod impl_commands_ops;
mod impl_commands_orchestration;
mod impl_commands_queue;
mod impl_commands_settings;
mod impl_commands_sync;
mod impl_conversations;
mod impl_git_review;
mod impl_goals_agents;
mod impl_history_status;
mod impl_lifecycle;
mod impl_remote;
mod impl_runs;
mod impl_settings;
mod impl_state;
mod impl_sync;
mod impl_voice;
mod impl_workflows;

mod mock_server;
mod models;
mod platform;
mod records;

pub use error::RuntimeError;

#[cfg(test)]
pub(super) use approval::new_mcp_approval;
pub(super) use mock_server::MockServerHandle;
#[cfg(test)]
pub(crate) static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[cfg(test)]
pub(super) use models::ollama_memory_recommendation;
#[cfg(test)]
pub(super) use orchestration::{
    apply_hybrid_local_review, hybrid_local_reviewer, orchestration_role_models,
    remote_orchestration_role_models, HybridLocalReviewer,
};
#[cfg(test)]
pub(super) use run_events::apply_stream_event_to_run;
#[cfg(test)]
pub(super) use util::{unix_millis, MAX_DOCUMENT_SIZE, MAX_VIDEO_SIZE};

#[cfg(test)]
mod git_review_tests;
#[cfg(test)]
mod mock_server_tests;
#[cfg(test)]
mod models_command_tests;
#[cfg(test)]
mod platform_tests;
#[cfg(test)]
mod settings_tests;
#[cfg(test)]
mod tests;
