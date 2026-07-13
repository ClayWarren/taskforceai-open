use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

use taskforceai_app_client::{
    default_app_server_binary, AppClientError, AppServerClient, AppServerRequestHandle,
    AppServerSpawnOptions,
};
use tokio::sync::Mutex;
use tracing::{info, warn};

mod http;
mod ssh;
mod types;

pub use types::{
    DesktopAppServerEnvironmentStatus, DesktopHttpAppServerError, DesktopHttpPairingInfo,
    DesktopSshConnectError, DesktopSshConnectParams, DesktopSshConnectResult, DesktopSshProbeError,
    DesktopSshProbeParams, DesktopSshProbeResult, DesktopThreadHandoffParams,
    DesktopThreadHandoffResult, DesktopThreadLocation,
};

use self::http::start_http_app_server;
use self::ssh::{normalize_ssh_target, probe_ssh_target, start_remote_app_server};
use self::types::{DesktopActiveEnvironment, DesktopHttpAppServer, DesktopRemoteAppServer};

const PAIRING_CODE_ENV: &str = "TASKFORCE_APP_SERVER_PAIRING_CODE";

#[derive(Clone)]
pub struct DesktopAppServer {
    client: Arc<Mutex<Option<ManagedAppServerClient>>>,
    workspace_operation: Arc<Mutex<()>>,
    next_client_generation: Arc<AtomicU64>,
    http_server: Arc<Mutex<Option<DesktopHttpAppServer>>>,
    remote_server: Arc<Mutex<Option<DesktopRemoteAppServer>>>,
    active_environment: Arc<Mutex<DesktopActiveEnvironment>>,
    options: AppServerSpawnOptions,
}

struct ManagedAppServerClient {
    generation: u64,
    client: AppServerClient,
}

impl DesktopAppServer {
    pub fn new(api_base_url: String) -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            workspace_operation: Arc::new(Mutex::new(())),
            next_client_generation: Arc::new(AtomicU64::new(1)),
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

    #[cfg(test)]
    fn with_local_client(client: AppServerClient) -> Self {
        let mut server = Self::new("https://api.example.test".to_string());
        server.client = Arc::new(Mutex::new(Some(ManagedAppServerClient {
            generation: 1,
            client,
        })));
        server.next_client_generation = Arc::new(AtomicU64::new(2));
        server
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

    pub async fn thread_handoff(
        &self,
        params: DesktopThreadHandoffParams,
    ) -> Result<DesktopThreadHandoffResult, String> {
        use taskforceai_app_protocol::{
            ThreadIDParams, ThreadImportParams, TurnInterruptParams, TurnStatus,
        };

        if params.source == params.target {
            return Err("Thread handoff source and target must be different.".to_string());
        }
        let thread_id = params.thread_id.trim();
        if thread_id.is_empty() {
            return Err("Thread id is required.".to_string());
        }

        let local = self
            .local_request_handle()
            .await
            .map_err(|error| format!("Start local app-server: {error}"))?;
        let (remote, remote_target) = self.remote_request_handle().await?;
        let (source, target) = match params.source {
            DesktopThreadLocation::Local => (local, remote),
            DesktopThreadLocation::Remote => (remote, local),
        };

        let exported = source
            .thread_read(ThreadIDParams {
                thread_id: thread_id.to_string(),
            })
            .await
            .map_err(|error| format!("Read source thread: {error}"))?;
        let imported = target
            .thread_import(ThreadImportParams {
                thread: exported.thread.clone(),
                overwrite: false,
            })
            .await
            .map_err(|error| format!("Import destination thread: {error}"))?;

        let has_active_turn = exported
            .thread
            .turns
            .iter()
            .any(|turn| matches!(turn.status, TurnStatus::Queued | TurnStatus::InProgress));
        if has_active_turn {
            if let Err(error) = source
                .turn_interrupt(TurnInterruptParams {
                    thread_id: thread_id.to_string(),
                })
                .await
            {
                return Ok(DesktopThreadHandoffResult {
                    thread: imported.thread,
                    source: params.source,
                    target: params.target,
                    source_archived: false,
                    warning: Some(format!(
                        "The destination copy is ready, but the source turn could not be interrupted and remains active: {error}"
                    )),
                });
            }
        }

        let source_archived = source
            .thread_archive(ThreadIDParams {
                thread_id: thread_id.to_string(),
            })
            .await;
        let warning = source_archived.as_ref().err().map(|error| {
            format!(
                "The destination copy is ready, but the source thread could not be archived: {error}"
            )
        });

        match params.target {
            DesktopThreadLocation::Local => {
                *self.active_environment.lock().await = DesktopActiveEnvironment::Local;
            }
            DesktopThreadLocation::Remote => {
                *self.active_environment.lock().await = DesktopActiveEnvironment::Remote {
                    target: remote_target,
                };
            }
        }

        Ok(DesktopThreadHandoffResult {
            thread: imported.thread,
            source: params.source,
            target: params.target,
            source_archived: source_archived.is_ok(),
            warning,
        })
    }

    async fn local_request_handle(&self) -> Result<AppServerRequestHandle, AppClientError> {
        let mut guard = self.client.lock().await;
        if guard.is_none() {
            let binary = default_app_server_binary();
            info!(
                target: "app_server",
                binary = %binary.display(),
                "Starting shared app-server for desktop"
            );
            let client = AppServerClient::spawn_with_options(binary, self.options.clone()).await?;
            client.initialize().await?;
            *guard = Some(ManagedAppServerClient {
                generation: self.next_client_generation.fetch_add(1, Ordering::Relaxed),
                client,
            });
        }
        Ok(guard
            .as_ref()
            .expect("client initialized")
            .client
            .request_handle())
    }

    async fn remote_request_handle(&self) -> Result<(AppServerRequestHandle, String), String> {
        let connection = {
            let mut remote = self.remote_server.lock().await;
            let server = remote.as_mut().ok_or_else(|| {
                "Connect a remote environment before handing off a thread.".to_string()
            })?;
            if !server.is_running() {
                *remote = None;
                return Err("The remote environment is no longer connected.".to_string());
            }
            (
                server.result.local_base_url.clone(),
                server.session_token.clone(),
                server.target.clone(),
            )
        };
        let client = AppServerClient::connect_http(connection.0, connection.1)
            .map_err(|error| format!("Connect remote app-server: {error}"))?;
        Ok((client.request_handle(), connection.2))
    }

    pub async fn with_client<T>(
        &self,
        run: impl FnOnce(
            AppServerRequestHandle,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<T, AppClientError>> + Send>,
        >,
    ) -> Result<T, AppClientError> {
        if let DesktopActiveEnvironment::Remote { target } =
            self.active_environment.lock().await.clone()
        {
            let remote_connection = {
                let mut remote = self.remote_server.lock().await;
                if remote.as_mut().is_some_and(|server| !server.is_running()) {
                    *remote = None;
                    *self.active_environment.lock().await = DesktopActiveEnvironment::Local;
                }
                remote
                    .as_ref()
                    .filter(|server| server.target == target)
                    .map(|server| {
                        (
                            server.result.local_base_url.clone(),
                            server.session_token.clone(),
                        )
                    })
            };
            if let Some((base_url, session_token)) = remote_connection {
                let client = AppServerClient::connect_http(base_url, session_token)?;
                return run(client.request_handle()).await;
            }
        }

        let (request_handle, generation) = {
            let mut guard = self.client.lock().await;
            if guard.is_none() {
                let binary = default_app_server_binary();
                info!(
                    target: "app_server",
                    binary = %binary.display(),
                    "Starting shared app-server for desktop"
                );
                let client =
                    AppServerClient::spawn_with_options(binary, self.options.clone()).await?;
                client.initialize().await?;
                *guard = Some(ManagedAppServerClient {
                    generation: self.next_client_generation.fetch_add(1, Ordering::Relaxed),
                    client,
                });
            }
            let managed = guard.as_ref().expect("client initialized");
            (managed.client.request_handle(), managed.generation)
        };
        let result = run(request_handle).await;

        if let Err(error) = &result {
            if should_restart_client(error) {
                let mut guard = self.client.lock().await;
                if let Some(managed) = guard
                    .as_mut()
                    .filter(|client| client.generation == generation)
                {
                    managed.client.kill().await;
                    *guard = None;
                    warn!(
                        target: "app_server",
                        error = %error,
                        "Reset shared app-server client after transport failure"
                    );
                }
            }
        }

        result
    }

    pub async fn with_workspace_client<T>(
        &self,
        run: impl FnOnce(
            AppServerRequestHandle,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<T, AppClientError>> + Send>,
        >,
    ) -> Result<T, AppClientError> {
        let _workspace_operation = self.workspace_operation.lock().await;
        self.with_client(run).await
    }
}

fn should_restart_client(error: &AppClientError) -> bool {
    matches!(
        error,
        AppClientError::Closed | AppClientError::Read(_) | AppClientError::Write(_)
    )
}

#[cfg(test)]
mod tests {
    use super::http::parse_http_startup_log;
    use super::ssh::{
        normalize_app_server_path, normalize_ssh_target, pair_remote_app_server,
        parse_ssh_probe_output, port_from_url, read_limited_to_string, remote_app_server_command,
    };
    use super::types::DesktopHttpTransportInfo;
    use super::{
        DesktopAppServer, DesktopAppServerEnvironmentStatus, DesktopHttpAppServerError,
        DesktopHttpPairingInfo, DesktopSshConnectError, DesktopSshProbeError,
    };

    #[cfg(unix)]
    #[tokio::test]
    async fn local_app_server_requests_are_not_serialized_behind_client_lifecycle_lock() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;
        use std::time::Duration;

        use taskforceai_app_client::AppServerClient;
        use taskforceai_app_protocol::VoiceTranscribeParams;

        let script_path = std::env::temp_dir().join(format!(
            "taskforceai-desktop-concurrent-client-{}-{}",
            std::process::id(),
            super::http::generate_pairing_code()
        ));
        fs::write(
            &script_path,
            concat!(
                "#!/bin/sh\n",
                "read -r _first\n",
                "read -r _second\n",
                "printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"text\":\"second\"}}'\n",
                "printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"text\":\"first\"}}'\n"
            ),
        )
        .expect("write concurrent app-server fixture");
        let mut permissions = fs::metadata(&script_path)
            .expect("fixture metadata")
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script_path, permissions).expect("mark fixture executable");

        let client = AppServerClient::spawn(&script_path)
            .await
            .expect("spawn concurrent app-server fixture");
        let server = DesktopAppServer::with_local_client(client);
        let first = server.with_client(|client| {
            Box::pin(async move {
                client
                    .voice_transcribe(VoiceTranscribeParams {
                        audio_base64: "Zmlyc3Q=".to_string(),
                        media_type: "audio/webm".to_string(),
                        file_name: None,
                    })
                    .await
            })
        });
        let second = server.with_client(|client| {
            Box::pin(async move {
                client
                    .voice_transcribe(VoiceTranscribeParams {
                        audio_base64: "c2Vjb25k".to_string(),
                        media_type: "audio/webm".to_string(),
                        file_name: None,
                    })
                    .await
            })
        });

        let (first, second) = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(first, second)
        })
        .await
        .expect("desktop requests should reach the transport concurrently");
        assert_eq!(first.expect("first response").text, "first");
        assert_eq!(second.expect("second response").text, "second");

        let _ = fs::remove_file(script_path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn local_workspace_operations_are_serialized() {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        use std::time::Duration;

        use taskforceai_app_client::{AppClientError, AppServerClient};
        use tokio::sync::Notify;

        let script_path = std::env::temp_dir().join(format!(
            "taskforceai-desktop-workspace-client-{}-{}",
            std::process::id(),
            super::http::generate_pairing_code()
        ));
        fs::write(&script_path, "#!/bin/sh\nsleep 2\n").expect("write workspace fixture");
        let mut permissions = fs::metadata(&script_path)
            .expect("fixture metadata")
            .permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&script_path, permissions).expect("mark fixture executable");

        let client = AppServerClient::spawn(&script_path)
            .await
            .expect("spawn workspace app-server fixture");
        let server = DesktopAppServer::with_local_client(client);
        let first_started = Arc::new(Notify::new());
        let release_first = Arc::new(Notify::new());
        let second_started = Arc::new(AtomicBool::new(false));

        let first_server = server.clone();
        let first_started_for_run = first_started.clone();
        let release_first_for_run = release_first.clone();
        let first = tokio::spawn(async move {
            first_server
                .with_workspace_client(|_| {
                    Box::pin(async move {
                        first_started_for_run.notify_one();
                        release_first_for_run.notified().await;
                        Ok::<(), AppClientError>(())
                    })
                })
                .await
        });
        first_started.notified().await;

        let second_server = server.clone();
        let second_started_for_run = second_started.clone();
        let second = tokio::spawn(async move {
            second_server
                .with_workspace_client(|_| {
                    Box::pin(async move {
                        second_started_for_run.store(true, Ordering::SeqCst);
                        Ok::<(), AppClientError>(())
                    })
                })
                .await
        });

        tokio::time::sleep(Duration::from_millis(25)).await;
        assert!(!second_started.load(Ordering::SeqCst));
        release_first.notify_one();
        first.await.expect("first task").expect("first operation");
        second
            .await
            .expect("second task")
            .expect("second operation");
        assert!(second_started.load(Ordering::SeqCst));

        let _ = fs::remove_file(script_path);
    }

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
        assert!(!super::should_restart_client(
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

    #[tokio::test]
    async fn pairing_retries_transient_http_statuses() {
        let (base_url, handle) = start_pairing_sequence_server(vec![
            ("503 Service Unavailable", "{}"),
            ("200 OK", r#"{"sessionToken":"session-ok"}"#),
        ]);

        let token = pair_remote_app_server(&base_url, "pair-me")
            .await
            .expect("pairing should retry warmup status");

        assert_eq!(token, "session-ok");
        handle.join().expect("pairing fixture should stop");
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

    fn start_pairing_sequence_server(
        responses: Vec<(&'static str, &'static str)>,
    ) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("pairing fixture should bind");
        let address = listener
            .local_addr()
            .expect("pairing fixture address should be readable");
        let handle = std::thread::spawn(move || {
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().expect("pairing request should arrive");
                let mut buffer = [0_u8; 1024];
                let _ = stream
                    .read(&mut buffer)
                    .expect("pairing request should read");
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .expect("pairing response should write");
            }
        });
        (format!("http://{address}"), handle)
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
