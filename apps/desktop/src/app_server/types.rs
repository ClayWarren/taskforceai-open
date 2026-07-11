use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::process::Child;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopHttpPairingInfo {
    pub base_url: String,
    pub pairing_code: String,
    pub rpc_path: String,
    pub transport: DesktopHttpTransportInfo,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopHttpTransportInfo {
    pub kind: String,
    pub encoding: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSshProbeParams {
    pub target: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSshProbeResult {
    pub target: String,
    pub reachable: bool,
    pub app_server_available: bool,
    pub app_server_path: Option<String>,
    pub shell: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSshConnectParams {
    pub target: String,
    pub app_server_path: Option<String>,
    pub remote_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSshConnectResult {
    pub target: String,
    pub remote_base_url: String,
    pub local_base_url: String,
    pub local_port: u16,
    pub remote_port: u16,
    pub pairing: DesktopHttpPairingInfo,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAppServerEnvironmentStatus {
    pub active: String,
    pub target: Option<String>,
    pub local_base_url: Option<String>,
    pub remote_base_url: Option<String>,
    pub local_port: Option<u16>,
    pub remote_port: Option<u16>,
    pub remote_connected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum DesktopActiveEnvironment {
    Local,
    Remote { target: String },
}

#[derive(Debug)]
pub(super) struct DesktopHttpAppServer {
    pub(super) child: Child,
    pub(super) pairing_info: DesktopHttpPairingInfo,
}

#[derive(Debug)]
pub(super) struct DesktopRemoteAppServer {
    pub(super) target: String,
    pub(super) remote_child: Child,
    pub(super) forward_child: Child,
    pub(super) result: DesktopSshConnectResult,
    pub(super) session_token: String,
}

impl DesktopRemoteAppServer {
    pub(super) fn is_running(&mut self) -> bool {
        matches!(self.remote_child.try_wait(), Ok(None))
            && matches!(self.forward_child.try_wait(), Ok(None))
    }
}

#[derive(Debug, Error)]
pub enum DesktopHttpAppServerError {
    #[error("spawn app-server http transport: {0}")]
    Spawn(std::io::Error),
    #[error("app-server http stderr unavailable")]
    MissingStderr,
    #[error("read app-server http startup: {0}")]
    ReadStartup(std::io::Error),
    #[error("app-server http startup timed out")]
    StartupTimeout,
    #[error("app-server http startup log was invalid: {0}")]
    InvalidStartup(String),
}

#[derive(Debug, Error)]
pub enum DesktopSshProbeError {
    #[error("SSH target is required")]
    EmptyTarget,
    #[error("SSH target cannot include whitespace or command-line options")]
    InvalidTarget,
    #[error("spawn ssh probe: {0}")]
    Spawn(std::io::Error),
    #[error("ssh probe stdout unavailable")]
    MissingStdout,
    #[error("ssh probe stderr unavailable")]
    MissingStderr,
    #[error("read ssh probe output: {0}")]
    Read(std::io::Error),
    #[error("ssh probe output exceeded limit")]
    OutputTooLarge,
    #[error("ssh probe timed out")]
    Timeout,
    #[error("ssh probe failed: {0}")]
    Failed(String),
}

#[derive(Debug, Error)]
pub enum DesktopSshConnectError {
    #[error("{0}")]
    Target(#[from] DesktopSshProbeError),
    #[error("app-server path cannot include whitespace or command-line options")]
    InvalidAppServerPath,
    #[error("remote app-server startup timed out")]
    StartupTimeout,
    #[error("remote app-server startup failed: {0}")]
    StartupFailed(String),
    #[error("remote app-server startup log was invalid: {0}")]
    InvalidStartup(String),
    #[error("allocate local forwarding port: {0}")]
    AllocateLocalPort(std::io::Error),
    #[error("spawn ssh remote app-server: {0}")]
    SpawnRemote(std::io::Error),
    #[error("spawn ssh port forward: {0}")]
    SpawnForward(std::io::Error),
    #[error("pair remote app-server: {0}")]
    Pair(reqwest::Error),
    #[error("read remote app-server startup: {0}")]
    ReadStartup(std::io::Error),
    #[error("remote app-server stderr unavailable")]
    MissingStderr,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HttpStartupLog {
    pub(super) base_url: String,
}

impl Drop for DesktopHttpAppServer {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl Drop for DesktopRemoteAppServer {
    fn drop(&mut self) {
        let _ = self.forward_child.start_kill();
        let _ = self.remote_child.start_kill();
    }
}
