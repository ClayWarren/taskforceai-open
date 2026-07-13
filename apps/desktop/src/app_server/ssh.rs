use std::net::TcpListener;
use std::process::Stdio;
use std::time::Duration;

use reqwest::StatusCode;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tracing::debug;
use url::Url;

use super::http::{generate_pairing_code, parse_http_startup_log};
use super::types::{
    DesktopHttpPairingInfo, DesktopHttpTransportInfo, DesktopRemoteAppServer,
    DesktopSshConnectError, DesktopSshConnectParams, DesktopSshConnectResult, DesktopSshProbeError,
    DesktopSshProbeResult,
};
use super::PAIRING_CODE_ENV;

const SSH_PROBE_OUTPUT_LIMIT_BYTES: usize = 64 * 1024;
const PAIRING_ATTEMPTS: usize = 10;
const PAIRING_RETRY_DELAY: Duration = Duration::from_millis(100);

pub(super) async fn probe_ssh_target(
    target: &str,
) -> Result<DesktopSshProbeResult, DesktopSshProbeError> {
    let target = normalize_ssh_target(target)?;
    let remote_script = concat!(
        "printf 'shell=%s\\n' \"${SHELL:-unknown}\"; ",
        "if command -v taskforceai-app-server >/dev/null 2>&1; then ",
        "printf 'app_server_path=%s\\n' \"$(command -v taskforceai-app-server)\"; ",
        "else printf 'app_server_path=\\n'; fi"
    );

    let mut child = Command::new("ssh")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=5")
        .arg(&target)
        .arg("sh")
        .arg("-lc")
        .arg(remote_script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(DesktopSshProbeError::Spawn)?;

    let stdout = child
        .stdout
        .take()
        .ok_or(DesktopSshProbeError::MissingStdout)?;
    let stderr = child
        .stderr
        .take()
        .ok_or(DesktopSshProbeError::MissingStderr)?;

    let output_result = tokio::time::timeout(Duration::from_secs(10), async {
        let (stdout_text, stderr_text) = tokio::try_join!(
            read_limited_to_string(stdout, SSH_PROBE_OUTPUT_LIMIT_BYTES),
            read_limited_to_string(stderr, SSH_PROBE_OUTPUT_LIMIT_BYTES)
        )?;
        let status = child.wait().await.map_err(DesktopSshProbeError::Read)?;
        Ok::<_, DesktopSshProbeError>((status, stdout_text, stderr_text))
    })
    .await;
    let output = match output_result {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            let _ = child.start_kill();
            return Err(error);
        }
        Err(_) => {
            let _ = child.start_kill();
            return Err(DesktopSshProbeError::Timeout);
        }
    };

    let (status, stdout_text, stderr_text) = output;
    if !status.success() {
        let message = stderr_text
            .lines()
            .next()
            .filter(|line| !line.trim().is_empty())
            .unwrap_or("SSH connection failed")
            .trim()
            .to_string();
        return Err(DesktopSshProbeError::Failed(message));
    }

    Ok(parse_ssh_probe_output(&target, &stdout_text))
}

pub(super) async fn read_limited_to_string<R>(
    reader: R,
    limit: usize,
) -> Result<String, DesktopSshProbeError>
where
    R: AsyncRead + Unpin,
{
    let mut limited = reader.take((limit + 1) as u64);
    let mut text = String::new();
    limited
        .read_to_string(&mut text)
        .await
        .map_err(DesktopSshProbeError::Read)?;
    if text.len() > limit {
        return Err(DesktopSshProbeError::OutputTooLarge);
    }
    Ok(text)
}

pub(super) fn normalize_ssh_target(target: &str) -> Result<String, DesktopSshProbeError> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err(DesktopSshProbeError::EmptyTarget);
    }
    if trimmed.starts_with('-') || trimmed.chars().any(char::is_whitespace) {
        return Err(DesktopSshProbeError::InvalidTarget);
    }
    Ok(trimmed.to_string())
}

pub(super) fn normalize_app_server_path(
    path: Option<String>,
) -> Result<String, DesktopSshConnectError> {
    let path = path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "taskforceai-app-server".to_string());
    if path.starts_with('-') || !path.chars().all(is_safe_remote_app_server_path_char) {
        return Err(DesktopSshConnectError::InvalidAppServerPath);
    }
    Ok(path)
}

fn is_safe_remote_app_server_path_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '/' | '.' | '_' | '-')
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(super) fn remote_app_server_command(
    app_server_path: &str,
    requested_remote_port: u16,
    pairing_code: &str,
) -> String {
    format!(
        "{}={} exec {} serve --host 127.0.0.1 --port {requested_remote_port}",
        PAIRING_CODE_ENV,
        shell_single_quote(pairing_code),
        shell_single_quote(app_server_path),
    )
}

pub(super) async fn start_remote_app_server(
    params: DesktopSshConnectParams,
) -> Result<DesktopRemoteAppServer, DesktopSshConnectError> {
    let target = normalize_ssh_target(&params.target)?;
    let app_server_path = normalize_app_server_path(params.app_server_path)?;
    let requested_remote_port = params.remote_port.unwrap_or(0);
    let pairing_code = generate_pairing_code();
    let remote_command =
        remote_app_server_command(&app_server_path, requested_remote_port, &pairing_code);

    let mut remote_child = Command::new("ssh")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=5")
        .arg(&target)
        .arg("sh")
        .arg("-lc")
        .arg(remote_command)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(DesktopSshConnectError::SpawnRemote)?;

    let stderr = remote_child
        .stderr
        .take()
        .ok_or(DesktopSshConnectError::MissingStderr)?;
    let mut lines = BufReader::new(stderr).lines();
    let startup_result = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(DesktopSshConnectError::ReadStartup)?
        {
            if let Some(startup) = parse_http_startup_log(&line)
                .map_err(|error| DesktopSshConnectError::InvalidStartup(error.to_string()))?
            {
                return Ok(startup);
            }
            debug!(target: "app_server", line = %line, "remote app-server startup log");
        }
        Err(DesktopSshConnectError::StartupFailed(
            "process exited before startup log".to_string(),
        ))
    })
    .await;
    let startup = match startup_result {
        Ok(Ok(startup)) => startup,
        Ok(Err(error)) => {
            let _ = remote_child.start_kill();
            return Err(error);
        }
        Err(_) => {
            let _ = remote_child.start_kill();
            return Err(DesktopSshConnectError::StartupTimeout);
        }
    };

    let remote_port = match port_from_url(&startup.base_url) {
        Ok(port) => port,
        Err(error) => {
            kill_child(&mut remote_child);
            return Err(error);
        }
    };
    let local_port = match allocate_local_port() {
        Ok(port) => port,
        Err(error) => {
            kill_child(&mut remote_child);
            return Err(DesktopSshConnectError::AllocateLocalPort(error));
        }
    };
    let forward_spec = format!("127.0.0.1:{local_port}:127.0.0.1:{remote_port}");
    let mut forward_child = Command::new("ssh")
        .arg("-N")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-L")
        .arg(forward_spec)
        .arg(&target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            kill_child(&mut remote_child);
            DesktopSshConnectError::SpawnForward(error)
        })?;

    tokio::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            debug!(target: "app_server", line = %line, "remote app-server log");
        }
    });

    let local_base_url = format!("http://127.0.0.1:{local_port}");
    let session_token = match pair_remote_app_server(&local_base_url, &pairing_code).await {
        Ok(session_token) => session_token,
        Err(error) => {
            kill_child(&mut forward_child);
            kill_child(&mut remote_child);
            return Err(DesktopSshConnectError::Pair(error));
        }
    };
    let pairing = DesktopHttpPairingInfo {
        base_url: local_base_url.clone(),
        pairing_code,
        rpc_path: "/rpc".to_string(),
        transport: DesktopHttpTransportInfo {
            kind: "ssh".to_string(),
            encoding: "json".to_string(),
        },
    };
    let result = DesktopSshConnectResult {
        target: target.clone(),
        remote_base_url: startup.base_url,
        local_base_url,
        local_port,
        remote_port,
        pairing,
        message: "Remote app-server is connected through a local SSH tunnel.".to_string(),
    };

    Ok(DesktopRemoteAppServer {
        target,
        remote_child,
        forward_child,
        result,
        session_token,
    })
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingResponse {
    session_token: String,
}

pub(super) async fn pair_remote_app_server(
    local_base_url: &str,
    pairing_code: &str,
) -> Result<String, reqwest::Error> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;
    for attempt in 1..=PAIRING_ATTEMPTS {
        match client
            .get(format!("{local_base_url}/pairing"))
            .header("X-Taskforce-Pairing-Code", pairing_code)
            .send()
            .await
        {
            Ok(response) => {
                let status = response.status();
                if should_retry_pairing_status(status) && attempt < PAIRING_ATTEMPTS {
                    debug!(
                        target: "app_server",
                        status = %status,
                        attempt,
                        "Waiting for SSH app-server pairing endpoint"
                    );
                    tokio::time::sleep(PAIRING_RETRY_DELAY).await;
                    continue;
                }
                let response = response
                    .error_for_status()?
                    .json::<PairingResponse>()
                    .await?;
                return Ok(response.session_token);
            }
            Err(error) => {
                if attempt == PAIRING_ATTEMPTS {
                    return Err(error);
                }
                debug!(target: "app_server", error = %error, "Waiting for SSH app-server tunnel");
                tokio::time::sleep(PAIRING_RETRY_DELAY).await;
            }
        }
    }
    unreachable!("pairing retry loop should return")
}

pub(super) fn port_from_url(base_url: &str) -> Result<u16, DesktopSshConnectError> {
    Url::parse(base_url)
        .map_err(|error| DesktopSshConnectError::InvalidStartup(error.to_string()))?
        .port()
        .ok_or_else(|| DesktopSshConnectError::InvalidStartup("missing remote port".to_string()))
}

fn allocate_local_port() -> Result<u16, std::io::Error> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

fn kill_child(child: &mut Child) {
    let _ = child.start_kill();
}

fn should_retry_pairing_status(status: StatusCode) -> bool {
    status == StatusCode::REQUEST_TIMEOUT
        || status == StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

pub(super) fn parse_ssh_probe_output(target: &str, output: &str) -> DesktopSshProbeResult {
    let mut shell = None;
    let mut app_server_path = None;

    for line in output.lines() {
        if let Some(value) = line.strip_prefix("shell=") {
            if !value.trim().is_empty() {
                shell = Some(value.trim().to_string());
            }
        } else if let Some(value) = line.strip_prefix("app_server_path=") {
            if !value.trim().is_empty() {
                app_server_path = Some(value.trim().to_string());
            }
        }
    }

    let app_server_available = app_server_path.is_some();
    let message = if app_server_available {
        "SSH target is reachable and has taskforceai-app-server on PATH.".to_string()
    } else {
        "SSH target is reachable, but taskforceai-app-server was not found on PATH.".to_string()
    };

    DesktopSshProbeResult {
        target: target.to_string(),
        reachable: true,
        app_server_available,
        app_server_path,
        shell,
        message,
    }
}
