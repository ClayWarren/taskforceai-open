use std::process::Stdio;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use taskforceai_app_client::{default_app_server_binary, AppServerSpawnOptions};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tracing::{debug, info};

use super::types::{
    DesktopHttpAppServer, DesktopHttpAppServerError, DesktopHttpPairingInfo,
    DesktopHttpTransportInfo, HttpStartupLog,
};
use super::PAIRING_CODE_ENV;

pub(super) async fn start_http_app_server(
    options: &AppServerSpawnOptions,
) -> Result<DesktopHttpAppServer, DesktopHttpAppServerError> {
    let binary = default_app_server_binary();
    info!(
        target: "app_server",
        binary = %binary.display(),
        "Starting app-server http transport for desktop pairing"
    );

    let pairing_code = generate_pairing_code();
    let mut command = Command::new(binary);
    command
        .arg("serve")
        .arg("--port")
        .arg("0")
        .env(PAIRING_CODE_ENV, &pairing_code)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    apply_spawn_options(&mut command, options);

    let mut child = command.spawn().map_err(DesktopHttpAppServerError::Spawn)?;
    let stderr = child
        .stderr
        .take()
        .ok_or(DesktopHttpAppServerError::MissingStderr)?;
    let mut lines = BufReader::new(stderr).lines();
    let startup_result = tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(DesktopHttpAppServerError::ReadStartup)?
        {
            if let Some(startup) = parse_http_startup_log(&line)? {
                return Ok(startup);
            }
            debug!(target: "app_server", line = %line, "app-server http startup log");
        }
        Err(DesktopHttpAppServerError::InvalidStartup(
            "process exited before startup log".to_string(),
        ))
    })
    .await;
    let startup = match startup_result {
        Ok(Ok(startup)) => startup,
        Ok(Err(error)) => {
            let _ = child.start_kill();
            return Err(error);
        }
        Err(_) => {
            let _ = child.start_kill();
            return Err(DesktopHttpAppServerError::StartupTimeout);
        }
    };

    tokio::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            debug!(target: "app_server", line = %line, "app-server http log");
        }
    });

    Ok(DesktopHttpAppServer {
        child,
        pairing_info: DesktopHttpPairingInfo {
            base_url: startup.base_url,
            pairing_code,
            rpc_path: "/rpc".to_string(),
            transport: DesktopHttpTransportInfo {
                kind: "http".to_string(),
                encoding: "json".to_string(),
            },
        },
    })
}

fn apply_spawn_options(command: &mut Command, options: &AppServerSpawnOptions) {
    if let Some(path) = &options.run_store_path {
        command.env("TASKFORCE_APP_SERVER_RUN_STORE", path);
    }
    if let Some(base_url) = &options.api_base_url {
        command.env("TASKFORCE_APP_SERVER_API_BASE_URL", base_url);
    }
}

pub(super) fn parse_http_startup_log(
    line: &str,
) -> Result<Option<HttpStartupLog>, DesktopHttpAppServerError> {
    let value = match serde_json::from_str::<serde_json::Value>(line) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    if value.get("target").and_then(|value| value.as_str()) != Some("taskforceai_app_server") {
        return Ok(None);
    }
    if value.get("baseUrl").is_none() {
        return Ok(None);
    }
    serde_json::from_value(value).map(Some).map_err(|error| {
        DesktopHttpAppServerError::InvalidStartup(format!("parse startup log: {error}"))
    })
}

pub(super) fn generate_pairing_code() -> String {
    let bytes: [u8; 32] = rand::random();
    URL_SAFE_NO_PAD.encode(bytes)
}
