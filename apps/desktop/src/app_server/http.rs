use std::net::{IpAddr, Ipv4Addr, UdpSocket};
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

const ALLOW_INSECURE_LAN_PAIRING_ENV: &str = "TASKFORCEAI_DESKTOP_ALLOW_INSECURE_LAN_PAIRING";

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
    command.arg("serve");
    let lan_address = insecure_lan_pairing_enabled()
        .then(local_network_address)
        .flatten();
    configure_network_binding(&mut command, lan_address);
    command
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

fn insecure_lan_pairing_enabled() -> bool {
    insecure_lan_pairing_value_enabled(
        std::env::var(ALLOW_INSECURE_LAN_PAIRING_ENV)
            .ok()
            .as_deref(),
    )
}

fn insecure_lan_pairing_value_enabled(value: Option<&str>) -> bool {
    value.is_some_and(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true"))
}

fn configure_network_binding(command: &mut Command, advertise_host: Option<IpAddr>) {
    if let Some(advertise_host) = advertise_host {
        tracing::warn!(
            target: "app_server",
            %advertise_host,
            "Insecure plaintext LAN pairing explicitly enabled"
        );
        command
            .arg("--host")
            .arg(Ipv4Addr::UNSPECIFIED.to_string())
            .arg("--allow-non-loopback")
            .arg("--advertise-host")
            .arg(advertise_host.to_string());
    }
}

fn apply_spawn_options(command: &mut Command, options: &AppServerSpawnOptions) {
    if let Some(path) = &options.run_store_path {
        command.env("TASKFORCE_APP_SERVER_RUN_STORE", path);
    }
    if let Some(base_url) = &options.api_base_url {
        command.env("TASKFORCE_APP_SERVER_API_BASE_URL", base_url);
    }
    if let Some(service) = &options.keychain_service {
        command.env("TASKFORCE_APP_SERVER_KEYCHAIN_SERVICE", service);
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

pub(super) fn local_network_address() -> Option<IpAddr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    let address = socket.local_addr().ok()?.ip();
    (!address.is_loopback() && !address.is_unspecified()).then_some(address)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lan_pairing_requires_explicit_insecure_opt_in() {
        assert!(!insecure_lan_pairing_value_enabled(None));
        assert!(!insecure_lan_pairing_value_enabled(Some("false")));
        assert!(!insecure_lan_pairing_value_enabled(Some("0")));
        assert!(insecure_lan_pairing_value_enabled(Some("true")));
        assert!(insecure_lan_pairing_value_enabled(Some(" 1 ")));
    }

    #[test]
    fn lan_binding_arguments_are_only_added_by_the_opt_in_path() {
        let mut loopback_command = Command::new("taskforceai-app-server");
        loopback_command.arg("serve");
        configure_network_binding(&mut loopback_command, None);
        loopback_command.arg("--port").arg("0");
        let loopback_args = loopback_command
            .as_std()
            .get_args()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(!loopback_args
            .iter()
            .any(|value| value == "--allow-non-loopback"));

        let mut lan_command = Command::new("taskforceai-app-server");
        lan_command.arg("serve");
        configure_network_binding(
            &mut lan_command,
            Some("192.0.2.5".parse().expect("test IP")),
        );
        let lan_args = lan_command
            .as_std()
            .get_args()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            lan_args,
            [
                "serve",
                "--host",
                "0.0.0.0",
                "--allow-non-loopback",
                "--advertise-host",
                "192.0.2.5",
            ]
        );
    }
}
