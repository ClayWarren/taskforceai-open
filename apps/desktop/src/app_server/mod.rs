use std::sync::Arc;

use taskforceai_app_client::{
    default_app_server_binary, AppClientError, AppServerClient, AppServerSpawnOptions,
};
use tokio::sync::Mutex;
use tracing::{info, warn};

mod http;
mod ssh;
mod types;

pub use types::{
    DesktopAppServerEnvironmentStatus, DesktopHttpAppServerError, DesktopHttpPairingInfo,
    DesktopSshConnectError, DesktopSshConnectParams, DesktopSshConnectResult, DesktopSshProbeError,
    DesktopSshProbeParams, DesktopSshProbeResult,
};

use self::http::start_http_app_server;
use self::ssh::{normalize_ssh_target, probe_ssh_target, start_remote_app_server};
use self::types::{DesktopActiveEnvironment, DesktopHttpAppServer, DesktopRemoteAppServer};

const PAIRING_CODE_ENV: &str = "TASKFORCE_APP_SERVER_PAIRING_CODE";

#[derive(Clone)]
pub struct DesktopAppServer {
    client: Arc<Mutex<Option<AppServerClient>>>,
    http_server: Arc<Mutex<Option<DesktopHttpAppServer>>>,
    remote_server: Arc<Mutex<Option<DesktopRemoteAppServer>>>,
    active_environment: Arc<Mutex<DesktopActiveEnvironment>>,
    options: AppServerSpawnOptions,
}

impl DesktopAppServer {
    pub fn new(api_base_url: String) -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            http_server: Arc::new(Mutex::new(None)),
            remote_server: Arc::new(Mutex::new(None)),
            active_environment: Arc::new(Mutex::new(DesktopActiveEnvironment::Local)),
            options: AppServerSpawnOptions {
                api_base_url: Some(api_base_url),
                run_store_path: None,
                inherit_stderr: cfg!(debug_assertions),
            },
        }
    }

    pub async fn initialize(
        &self,
    ) -> Result<taskforceai_app_protocol::InitializeResult, AppClientError> {
        self.with_client(|client| Box::pin(async move { client.initialize().await }))
            .await
    }

    pub async fn http_pairing_info(
        &self,
    ) -> Result<DesktopHttpPairingInfo, DesktopHttpAppServerError> {
        let mut guard = self.http_server.lock().await;
        if let Some(server) = guard.as_mut() {
            match server.child.try_wait() {
                Ok(None) => return Ok(server.pairing_info.clone()),
                Ok(Some(status)) => {
                    warn!(
                        target: "app_server",
                        status = %status,
                        "Restarting stopped app-server http transport"
                    );
                    *guard = None;
                }
                Err(error) => {
                    warn!(
                        target: "app_server",
                        error = %error,
                        "Restarting app-server http transport after status check failed"
                    );
                    *guard = None;
                }
            }
        }

        let server = start_http_app_server(&self.options).await?;
        let pairing_info = server.pairing_info.clone();
        *guard = Some(server);
        Ok(pairing_info)
    }

    pub async fn ssh_probe(
        &self,
        params: DesktopSshProbeParams,
    ) -> Result<DesktopSshProbeResult, DesktopSshProbeError> {
        probe_ssh_target(&params.target).await
    }

    pub async fn ssh_connect(
        &self,
        params: DesktopSshConnectParams,
    ) -> Result<DesktopSshConnectResult, DesktopSshConnectError> {
        let target = normalize_ssh_target(&params.target)?;
        let mut guard = self.remote_server.lock().await;
        if let Some(server) = guard.as_mut() {
            let remote_running = matches!(server.remote_child.try_wait(), Ok(None));
            let forward_running = matches!(server.forward_child.try_wait(), Ok(None));
            if server.target == target && remote_running && forward_running {
                return Ok(server.result.clone());
            }
            *guard = None;
        }

        let server = start_remote_app_server(params).await?;
        let result = server.result.clone();
        *self.active_environment.lock().await = DesktopActiveEnvironment::Remote {
            target: result.target.clone(),
        };
        *guard = Some(server);
        Ok(result)
    }

    pub async fn use_local_environment(&self) {
        *self.active_environment.lock().await = DesktopActiveEnvironment::Local;
        *self.remote_server.lock().await = None;
    }

    pub async fn disconnect_remote_environment(&self) {
        self.use_local_environment().await;
    }

    pub async fn environment_status(&self) -> DesktopAppServerEnvironmentStatus {
        let active = self.active_environment.lock().await.clone();
        let mut remote = self.remote_server.lock().await;
        if remote.as_mut().is_some_and(|server| !server.is_running()) {
            *remote = None;
            if matches!(active, DesktopActiveEnvironment::Remote { .. }) {
                *self.active_environment.lock().await = DesktopActiveEnvironment::Local;
                return DesktopAppServerEnvironmentStatus {
                    active: "local".to_string(),
                    target: None,
                    local_base_url: None,
                    remote_base_url: None,
                    local_port: None,
                    remote_port: None,
                    remote_connected: false,
                };
            }
        }
        match active {
            DesktopActiveEnvironment::Local => DesktopAppServerEnvironmentStatus {
                active: "local".to_string(),
                target: None,
                local_base_url: None,
                remote_base_url: remote
                    .as_ref()
                    .map(|server| server.result.remote_base_url.clone()),
                local_port: remote.as_ref().map(|server| server.result.local_port),
                remote_port: remote.as_ref().map(|server| server.result.remote_port),
                remote_connected: remote.is_some(),
            },
            DesktopActiveEnvironment::Remote { target } => {
                let matching_remote = remote.as_ref().filter(|server| server.target == target);
                DesktopAppServerEnvironmentStatus {
                    active: "remote".to_string(),
                    target: Some(target),
                    local_base_url: matching_remote
                        .map(|server| server.result.local_base_url.clone()),
                    remote_base_url: matching_remote
                        .map(|server| server.result.remote_base_url.clone()),
                    local_port: matching_remote.map(|server| server.result.local_port),
                    remote_port: matching_remote.map(|server| server.result.remote_port),
                    remote_connected: matching_remote.is_some(),
                }
            }
        }
    }

    pub async fn with_client<T>(
        &self,
        run: impl for<'a> FnOnce(
            &'a mut AppServerClient,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<T, AppClientError>> + Send + 'a>,
        >,
    ) -> Result<T, AppClientError> {
        if let DesktopActiveEnvironment::Remote { target } =
            self.active_environment.lock().await.clone()
        {
            let mut remote = self.remote_server.lock().await;
            if remote.as_mut().is_some_and(|server| !server.is_running()) {
                *remote = None;
                *self.active_environment.lock().await = DesktopActiveEnvironment::Local;
            }
            if let Some(server) = remote.as_ref().filter(|server| server.target == target) {
                let mut client = AppServerClient::connect_http(
                    server.result.local_base_url.clone(),
                    server.session_token.clone(),
                )?;
                return run(&mut client).await;
            }
        }

        let mut guard = self.client.lock().await;
        if guard.is_none() {
            let binary = default_app_server_binary();
            info!(
                target: "app_server",
                binary = %binary.display(),
                "Starting shared app-server for desktop"
            );
            let mut client =
                AppServerClient::spawn_with_options(binary, self.options.clone()).await?;
            client.initialize().await?;
            *guard = Some(client);
        }

        let result = {
            let client = guard.as_mut().expect("client initialized");
            run(client).await
        };

        if let Err(error) = &result {
            if should_restart_client(error) {
                if let Some(client) = guard.as_mut() {
                    client.kill().await;
                }
                *guard = None;
                warn!(
                    target: "app_server",
                    error = %error,
                    "Reset shared app-server client after transport failure"
                );
            }
        }

        result
    }
}

fn should_restart_client(error: &AppClientError) -> bool {
    matches!(
        error,
        AppClientError::Closed
            | AppClientError::Read(_)
            | AppClientError::Write(_)
            | AppClientError::RequestTimeout { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::http::parse_http_startup_log;
    use super::ssh::{
        normalize_app_server_path, normalize_ssh_target, parse_ssh_probe_output, port_from_url,
        read_limited_to_string, remote_app_server_command,
    };
    use super::types::DesktopHttpTransportInfo;
    use super::{
        DesktopAppServer, DesktopAppServerEnvironmentStatus, DesktopHttpAppServerError,
        DesktopHttpPairingInfo, DesktopSshConnectError, DesktopSshProbeError,
    };

    #[test]
    fn desktop_app_server_stores_api_base_url_option() {
        let server = DesktopAppServer::new("https://api.example.test".to_string());
        assert!(server.options.api_base_url.is_some());
        assert!(server.options.run_store_path.is_none());
    }

    #[test]
    fn transport_failures_reset_cached_client() {
        assert!(super::should_restart_client(
            &taskforceai_app_client::AppClientError::Closed
        ));
        assert!(super::should_restart_client(
            &taskforceai_app_client::AppClientError::RequestTimeout {
                method: "status.summary".to_string(),
                timeout_ms: 60_000,
            }
        ));
        assert!(!super::should_restart_client(
            &taskforceai_app_client::AppClientError::Rpc {
                code: -32601,
                message: "unsupported".to_string(),
            }
        ));
    }

    #[test]
    fn parses_http_startup_log() {
        let parsed = parse_http_startup_log(
            r#"{"baseUrl":"http://127.0.0.1:12345","level":"info","message":"listening","target":"taskforceai_app_server"}"#,
        )
        .expect("startup log should parse")
        .expect("startup log should match");

        assert_eq!(parsed.base_url, "http://127.0.0.1:12345");
    }

    #[test]
    fn ignores_unrelated_startup_logs() {
        let parsed = parse_http_startup_log(r#"{"target":"other","baseUrl":"http://x"}"#)
            .expect("unrelated log should be valid");
        assert!(parsed.is_none());
    }

    #[test]
    fn ssh_probe_target_validation_rejects_shell_like_values() {
        assert_eq!(
            normalize_ssh_target(" user@example.com ").expect("target should normalize"),
            "user@example.com"
        );
        assert!(matches!(
            normalize_ssh_target(""),
            Err(DesktopSshProbeError::EmptyTarget)
        ));
        assert!(matches!(
            normalize_ssh_target("-oProxyCommand=bad"),
            Err(DesktopSshProbeError::InvalidTarget)
        ));
        assert!(matches!(
            normalize_ssh_target("user@example.com whoami"),
            Err(DesktopSshProbeError::InvalidTarget)
        ));
    }

    #[test]
    fn ssh_connect_app_server_path_validation_rejects_shell_like_values() {
        assert_eq!(
            normalize_app_server_path(None).expect("default path should be valid"),
            "taskforceai-app-server"
        );
        assert_eq!(
            normalize_app_server_path(Some("/usr/local/bin/taskforceai-app-server".to_string()))
                .expect("absolute path should be valid"),
            "/usr/local/bin/taskforceai-app-server"
        );
        assert!(matches!(
            normalize_app_server_path(Some("-bad".to_string())),
            Err(DesktopSshConnectError::InvalidAppServerPath)
        ));
        assert!(matches!(
            normalize_app_server_path(Some("taskforceai-app-server --bad".to_string())),
            Err(DesktopSshConnectError::InvalidAppServerPath)
        ));
        for path in [
            "/usr/local/bin/taskforceai-app-server;id",
            "/usr/local/bin/taskforceai-app-server$(id)",
            "/usr/local/bin/taskforceai-app-server`id`",
            "/usr/local/bin/taskforceai-app-server>/tmp/out",
            "/usr/local/bin/taskforceai-app-server|id",
        ] {
            assert!(
                matches!(
                    normalize_app_server_path(Some(path.to_string())),
                    Err(DesktopSshConnectError::InvalidAppServerPath)
                ),
                "path should reject shell metacharacters: {path}"
            );
        }
    }

    #[test]
    fn ssh_connect_remote_command_quotes_app_server_path() {
        assert_eq!(
            remote_app_server_command("/usr/local/bin/taskforceai-app-server", 4123, "pair-me"),
            "TASKFORCE_APP_SERVER_PAIRING_CODE='pair-me' exec '/usr/local/bin/taskforceai-app-server' serve --host 127.0.0.1 --port 4123"
        );
    }

    #[test]
    fn parses_remote_app_server_port_from_url() {
        assert_eq!(
            port_from_url("http://127.0.0.1:4111").expect("port should parse"),
            4111
        );
        assert!(matches!(
            port_from_url("http://127.0.0.1"),
            Err(DesktopSshConnectError::InvalidStartup(_))
        ));
    }

    #[test]
    fn parses_ssh_probe_output() {
        let available = parse_ssh_probe_output(
            "user@example.com",
            "shell=/bin/zsh\napp_server_path=/usr/local/bin/taskforceai-app-server\n",
        );
        assert!(available.reachable);
        assert!(available.app_server_available);
        assert_eq!(available.shell.as_deref(), Some("/bin/zsh"));
        assert_eq!(
            available.app_server_path.as_deref(),
            Some("/usr/local/bin/taskforceai-app-server")
        );

        let missing =
            parse_ssh_probe_output("user@example.com", "shell=/bin/sh\napp_server_path=\n");
        assert!(missing.reachable);
        assert!(!missing.app_server_available);
        assert!(missing.message.contains("not found"));
    }

    #[tokio::test]
    async fn ssh_probe_output_reader_rejects_oversized_output() {
        let output = vec![b'a'; 9];
        let result = read_limited_to_string(std::io::Cursor::new(output), 8).await;
        assert!(matches!(result, Err(DesktopSshProbeError::OutputTooLarge)));
    }

    #[test]
    fn pairing_info_serializes_for_tauri() {
        let value = serde_json::to_value(DesktopHttpPairingInfo {
            base_url: "http://127.0.0.1:12345".to_string(),
            pairing_code: "pair-me".to_string(),
            rpc_path: "/rpc".to_string(),
            transport: DesktopHttpTransportInfo {
                kind: "http".to_string(),
                encoding: "json".to_string(),
            },
        })
        .expect("pairing info should serialize");

        assert_eq!(value["baseUrl"], "http://127.0.0.1:12345");
        assert_eq!(value["pairingCode"], "pair-me");
        assert_eq!(value["rpcPath"], "/rpc");
        assert_eq!(value["transport"]["kind"], "http");
    }

    #[test]
    fn environment_status_serializes_remote_diagnostics_for_tauri() {
        let value = serde_json::to_value(DesktopAppServerEnvironmentStatus {
            active: "remote".to_string(),
            target: Some("dev@example.com".to_string()),
            local_base_url: Some("http://127.0.0.1:9222".to_string()),
            remote_base_url: Some("http://127.0.0.1:4111".to_string()),
            local_port: Some(9222),
            remote_port: Some(4111),
            remote_connected: true,
        })
        .expect("environment status should serialize");

        assert_eq!(value["localBaseUrl"], "http://127.0.0.1:9222");
        assert_eq!(value["remoteBaseUrl"], "http://127.0.0.1:4111");
        assert_eq!(value["localPort"], 9222);
        assert_eq!(value["remotePort"], 4111);
        assert_eq!(value["remoteConnected"], true);
    }

    #[test]
    fn invalid_startup_log_reports_error() {
        let error =
            parse_http_startup_log(r#"{"target":"taskforceai_app_server","baseUrl":false}"#)
                .expect_err("invalid startup log should fail");
        assert!(matches!(
            error,
            DesktopHttpAppServerError::InvalidStartup(_)
        ));
    }
}
