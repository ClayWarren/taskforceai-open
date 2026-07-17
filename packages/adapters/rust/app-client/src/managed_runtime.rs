use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;

use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use taskforceai_app_protocol::PROTOCOL_VERSION;
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tracing::{info, warn};

use crate::{AppServerClient, AppServerSpawnOptions};

const BUNDLED_APP_SERVER_VERSION: &str = "0.11.7";
const MAX_APP_SERVER_BYTES: u64 = 128 * 1024 * 1024;
const APP_SERVER_TEAM_ID: &str = "F2RSXQY376";
const APP_SERVER_SIGNING_IDENTIFIER: &str = "taskforceai-app-server";
const APP_SERVER_UPDATE_PUBLIC_KEY: &str =
    "RWS0FkSVGAfzmr8Z9JHtuQ3eRliIPH93cnC3GE/TlWt2ZQTuL8npReUd";

type SignatureVerifier = Arc<dyn Fn(&Path) -> Result<(), RuntimeUpdateError> + Send + Sync>;
type AsyncVerifier = Arc<
    dyn Fn(PathBuf, String) -> Pin<Box<dyn Future<Output = Result<(), RuntimeUpdateError>> + Send>>
        + Send
        + Sync,
>;
type CandidateProber = Arc<
    dyn Fn(
            PathBuf,
            AppServerSpawnOptions,
        ) -> Pin<Box<dyn Future<Output = Result<(), RuntimeUpdateError>> + Send>>
        + Send
        + Sync,
>;

pub fn default_managed_app_server_root() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let home = std::env::var_os("LOCALAPPDATA");
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME");

    managed_app_server_root_from(std::env::var_os("TASKFORCEAI_HOME"), home)
}

fn managed_app_server_root_from(
    taskforce_home: Option<std::ffi::OsString>,
    home: Option<std::ffi::OsString>,
) -> Option<PathBuf> {
    if let Some(root) = taskforce_home {
        return Some(PathBuf::from(root).join("app-server"));
    }
    home.map(PathBuf::from)
        .map(|path| path.join(".taskforceai").join("app-server"))
}

#[derive(Clone)]
pub struct ManagedAppServerRuntime {
    bundled_binary: PathBuf,
    root: PathBuf,
    update_url: String,
    client: reqwest::Client,
    max_download_bytes: u64,
    verify_release_signature: AsyncVerifier,
    verify_signature: SignatureVerifier,
    probe_candidate: CandidateProber,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeUpdate {
    version: String,
    protocol_version: String,
    url: String,
    sha256: String,
    signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSelection {
    version: String,
    protocol_version: String,
    sha256: String,
    signature: String,
}

#[derive(Debug, Error)]
pub enum RuntimeUpdateError {
    #[error("request app-server update: {0}")]
    Request(#[from] reqwest::Error),
    #[error("app-server update endpoint returned status {0}")]
    ResponseStatus(reqwest::StatusCode),
    #[error("app-server update version is invalid: {0}")]
    InvalidVersion(semver::Error),
    #[error(
        "app-server update protocol {actual} is incompatible with desktop protocol {expected}"
    )]
    IncompatibleProtocol { actual: String, expected: String },
    #[error("app-server update endpoint returned a non-newer version")]
    NonNewerVersion,
    #[error("app-server update SHA-256 is invalid")]
    InvalidSha256,
    #[error("app-server update exceeds the 128 MiB size limit")]
    DownloadTooLarge,
    #[error("app-server update SHA-256 did not match")]
    HashMismatch,
    #[error("app-server update release signature was invalid: {0}")]
    ReleaseSignature(String),
    #[error("manage app-server runtime files: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialize app-server runtime metadata: {0}")]
    Metadata(#[from] serde_json::Error),
    #[error("app-server update signature verification failed: {0}")]
    Signature(String),
    #[error("app-server update failed its initialization probe: {0}")]
    Probe(String),
}

impl ManagedAppServerRuntime {
    pub fn new(api_base_url: &str, root: PathBuf, bundled_binary: PathBuf) -> Self {
        Self {
            bundled_binary,
            root,
            update_url: update_endpoint(api_base_url),
            client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(10))
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("managed app-server HTTP client configuration is valid"),
            max_download_bytes: MAX_APP_SERVER_BYTES,
            verify_release_signature: Arc::new(|path, signature| {
                Box::pin(async move { verify_release_signature(&path, &signature).await })
            }),
            verify_signature: Arc::new(verify_platform_signature),
            probe_candidate: Arc::new(|path, options| {
                Box::pin(async move { probe_candidate(&path, &options).await })
            }),
        }
    }

    #[cfg(test)]
    fn for_test(update_url: String, root: PathBuf, bundled_binary: PathBuf) -> Self {
        Self {
            bundled_binary,
            root,
            update_url,
            client: reqwest::Client::new(),
            max_download_bytes: MAX_APP_SERVER_BYTES,
            verify_release_signature: Arc::new(|_, _| Box::pin(async { Ok(()) })),
            verify_signature: Arc::new(|_| Ok(())),
            probe_candidate: Arc::new(|_, _| Box::pin(async { Ok(()) })),
        }
    }

    pub fn bundled_binary(&self) -> &Path {
        &self.bundled_binary
    }

    pub async fn active_binary(&self) -> PathBuf {
        let Some(selection) = self.load_selection().await else {
            return self.bundled_binary.clone();
        };
        let binary = self.binary_path(&selection.version);
        match self.validate_installed(&selection, &binary).await {
            Ok(()) => binary,
            Err(error) => {
                warn!(
                    target: "app_server_update",
                    version = %selection.version,
                    error = %error,
                    "Managed app-server is invalid; reverting to bundled runtime"
                );
                self.clear_selection().await;
                self.bundled_binary.clone()
            }
        }
    }

    pub async fn check_for_update(
        &self,
        options: &AppServerSpawnOptions,
    ) -> Result<bool, RuntimeUpdateError> {
        let current_version = self.current_version().await;
        let response = self
            .client
            .get(format!("{}/{current_version}", self.update_url))
            .send()
            .await?;
        if response.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(false);
        }
        if !response.status().is_success() {
            return Err(RuntimeUpdateError::ResponseStatus(response.status()));
        }
        let update = response.json::<RuntimeUpdate>().await?;
        validate_update(&update, &current_version)?;

        tokio::fs::create_dir_all(&self.root).await?;
        let candidate = self.root.join(format!(
            ".taskforceai-app-server-{}.download-{}",
            update.version,
            rand::random::<u64>()
        ));
        let install_result = self
            .download_verify_and_install(&update, &candidate, options)
            .await;
        if install_result.is_err() {
            let _ = tokio::fs::remove_file(&candidate).await;
        }
        install_result?;
        info!(
            target: "app_server_update",
            version = %update.version,
            "Installed managed app-server update"
        );
        Ok(true)
    }

    pub async fn rollback(&self, failed_binary: &Path) {
        if failed_binary != self.bundled_binary {
            let failed_binary = failed_binary.display().to_string();
            warn!(
                target: "app_server_update",
                binary = %failed_binary,
                "Rolling back failed managed app-server runtime"
            );
            self.clear_selection().await;
        }
    }

    async fn download_verify_and_install(
        &self,
        update: &RuntimeUpdate,
        candidate: &Path,
        options: &AppServerSpawnOptions,
    ) -> Result<(), RuntimeUpdateError> {
        let mut response = self
            .client
            .get(&update.url)
            .send()
            .await?
            .error_for_status()?;
        if response
            .content_length()
            .is_some_and(|size| size > self.max_download_bytes)
        {
            return Err(RuntimeUpdateError::DownloadTooLarge);
        }
        let mut file = tokio::fs::File::create(candidate).await?;
        let mut hasher = Sha256::new();
        let mut bytes_written = 0_u64;
        while let Some(chunk) = response.chunk().await? {
            bytes_written = bytes_written.saturating_add(chunk.len() as u64);
            if bytes_written > self.max_download_bytes {
                return Err(RuntimeUpdateError::DownloadTooLarge);
            }
            hasher.update(&chunk);
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        drop(file);
        let actual_hash = format!("{:x}", hasher.finalize());
        if !actual_hash.eq_ignore_ascii_case(update.sha256.trim()) {
            return Err(RuntimeUpdateError::HashMismatch);
        }
        make_executable(candidate).await?;
        (self.verify_release_signature)(candidate.to_path_buf(), update.signature.clone()).await?;
        (self.verify_signature)(candidate)?;
        (self.probe_candidate)(candidate.to_path_buf(), options.clone()).await?;

        let version_dir = self.root.join("versions").join(&update.version);
        tokio::fs::create_dir_all(&version_dir).await?;
        let installed = version_dir.join(binary_name());
        if tokio::fs::try_exists(&installed).await? {
            tokio::fs::remove_file(&installed).await?;
        }
        tokio::fs::rename(candidate, &installed).await?;
        let selection = RuntimeSelection {
            version: update.version.clone(),
            protocol_version: update.protocol_version.clone(),
            sha256: actual_hash,
            signature: update.signature.clone(),
        };
        self.store_selection(&selection).await
    }

    async fn validate_installed(
        &self,
        selection: &RuntimeSelection,
        binary: &Path,
    ) -> Result<(), RuntimeUpdateError> {
        Version::parse(&selection.version).map_err(RuntimeUpdateError::InvalidVersion)?;
        if selection.protocol_version != PROTOCOL_VERSION {
            return Err(RuntimeUpdateError::IncompatibleProtocol {
                actual: selection.protocol_version.clone(),
                expected: PROTOCOL_VERSION.to_string(),
            });
        }
        if !is_sha256(&selection.sha256) {
            return Err(RuntimeUpdateError::InvalidSha256);
        }
        let content = tokio::fs::read(binary).await?;
        let actual = format!("{:x}", Sha256::digest(&content));
        if !actual.eq_ignore_ascii_case(&selection.sha256) {
            return Err(RuntimeUpdateError::HashMismatch);
        }
        (self.verify_release_signature)(binary.to_path_buf(), selection.signature.clone()).await?;
        (self.verify_signature)(binary)
    }

    async fn current_version(&self) -> String {
        let _ = self.active_binary().await;
        let bundled = self.bundled_version().await;
        let managed = self
            .load_selection()
            .await
            .and_then(|selection| Version::parse(&selection.version).ok());
        managed
            .filter(|version| version > &bundled)
            .unwrap_or(bundled)
            .to_string()
    }

    async fn bundled_version(&self) -> Version {
        let fallback = || {
            Version::parse(BUNDLED_APP_SERVER_VERSION)
                .expect("fallback bundled app-server version is valid semver")
        };
        let output = match tokio::process::Command::new(&self.bundled_binary)
            .arg("--version")
            .output()
            .await
        {
            Ok(output) if output.status.success() => output,
            _ => return fallback(),
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout
            .split_whitespace()
            .last()
            .and_then(|version| Version::parse(version).ok())
            .unwrap_or_else(fallback)
    }

    async fn load_selection(&self) -> Option<RuntimeSelection> {
        let content = tokio::fs::read(self.selection_path()).await.ok()?;
        serde_json::from_slice(&content).ok()
    }

    async fn store_selection(
        &self,
        selection: &RuntimeSelection,
    ) -> Result<(), RuntimeUpdateError> {
        let temporary = self
            .root
            .join(format!(".current.json-{}", rand::random::<u64>()));
        tokio::fs::write(&temporary, serde_json::to_vec(selection)?).await?;
        tokio::fs::rename(temporary, self.selection_path()).await?;
        Ok(())
    }

    async fn clear_selection(&self) {
        let _ = tokio::fs::remove_file(self.selection_path()).await;
    }

    fn selection_path(&self) -> PathBuf {
        self.root.join("current.json")
    }

    fn binary_path(&self, version: &str) -> PathBuf {
        self.root.join("versions").join(version).join(binary_name())
    }
}

fn validate_update(
    update: &RuntimeUpdate,
    current_version: &str,
) -> Result<(), RuntimeUpdateError> {
    let update_version =
        Version::parse(&update.version).map_err(RuntimeUpdateError::InvalidVersion)?;
    let current_version =
        Version::parse(current_version).map_err(RuntimeUpdateError::InvalidVersion)?;
    if update_version <= current_version {
        return Err(RuntimeUpdateError::NonNewerVersion);
    }
    if update.protocol_version != PROTOCOL_VERSION {
        return Err(RuntimeUpdateError::IncompatibleProtocol {
            actual: update.protocol_version.clone(),
            expected: PROTOCOL_VERSION.to_string(),
        });
    }
    if !is_sha256(&update.sha256) {
        return Err(RuntimeUpdateError::InvalidSha256);
    }
    minisign_verify::Signature::decode(&update.signature)
        .map_err(|error| RuntimeUpdateError::ReleaseSignature(error.to_string()))?;
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

async fn verify_release_signature(
    path: &Path,
    encoded_signature: &str,
) -> Result<(), RuntimeUpdateError> {
    let public_key = minisign_verify::PublicKey::from_base64(APP_SERVER_UPDATE_PUBLIC_KEY)
        .map_err(|error| RuntimeUpdateError::ReleaseSignature(error.to_string()))?;
    let signature = minisign_verify::Signature::decode(encoded_signature)
        .map_err(|error| RuntimeUpdateError::ReleaseSignature(error.to_string()))?;
    let content = tokio::fs::read(path).await?;
    public_key
        .verify(&content, &signature, false)
        .map_err(|error| RuntimeUpdateError::ReleaseSignature(error.to_string()))
}

fn update_endpoint(api_base_url: &str) -> String {
    match url::Url::parse(api_base_url) {
        Ok(mut url) => {
            url.set_path(&format!(
                "/api/desktop/app-server/update/{}",
                runtime_target()
            ));
            url.set_query(None);
            url.set_fragment(None);
            url.to_string().trim_end_matches('/').to_string()
        }
        Err(_) => format!(
            "{}/api/desktop/app-server/update/{}",
            api_base_url
                .trim_end_matches('/')
                .trim_end_matches("/api/v1"),
            runtime_target()
        ),
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn runtime_target() -> &'static str {
    "darwin-aarch64"
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn runtime_target() -> &'static str {
    "darwin-x86_64"
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn runtime_target() -> &'static str {
    "linux-aarch64"
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn runtime_target() -> &'static str {
    "linux-x86_64"
}

#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
fn runtime_target() -> &'static str {
    "windows-aarch64"
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn runtime_target() -> &'static str {
    "windows-x86_64"
}

#[cfg(windows)]
fn binary_name() -> &'static str {
    "taskforceai-app-server.exe"
}

#[cfg(not(windows))]
fn binary_name() -> &'static str {
    "taskforceai-app-server"
}

async fn probe_candidate(
    binary: &Path,
    options: &AppServerSpawnOptions,
) -> Result<(), RuntimeUpdateError> {
    let mut client = AppServerClient::spawn_with_options(binary, options.clone())
        .await
        .map_err(|error| RuntimeUpdateError::Probe(error.to_string()))?;
    let initialized = client
        .initialize()
        .await
        .map_err(|error| RuntimeUpdateError::Probe(error.to_string()));
    client.kill().await;
    let initialized = initialized?;
    if initialized.server.protocol_version != PROTOCOL_VERSION {
        return Err(RuntimeUpdateError::IncompatibleProtocol {
            actual: initialized.server.protocol_version,
            expected: PROTOCOL_VERSION.to_string(),
        });
    }
    Ok(())
}

#[cfg(unix)]
async fn make_executable(path: &Path) -> Result<(), std::io::Error> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = tokio::fs::metadata(path).await?.permissions();
    permissions.set_mode(0o755);
    tokio::fs::set_permissions(path, permissions).await
}

#[cfg(not(unix))]
async fn make_executable(_path: &Path) -> Result<(), std::io::Error> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn verify_platform_signature(path: &Path) -> Result<(), RuntimeUpdateError> {
    let verify = std::process::Command::new("/usr/bin/codesign")
        .args(["--verify", "--strict", "--verbose=2"])
        .arg(path)
        .output()?;
    if !verify.status.success() {
        return Err(RuntimeUpdateError::Signature(
            String::from_utf8_lossy(&verify.stderr).trim().to_string(),
        ));
    }
    let details = std::process::Command::new("/usr/bin/codesign")
        .args(["-d", "--verbose=4"])
        .arg(path)
        .output()?;
    let output = String::from_utf8_lossy(&details.stderr);
    validate_codesign_details(details.status.success(), &output)
}

#[cfg(target_os = "macos")]
fn validate_codesign_details(success: bool, output: &str) -> Result<(), RuntimeUpdateError> {
    if !success
        || !output.contains(&format!("TeamIdentifier={APP_SERVER_TEAM_ID}"))
        || !output.contains(&format!("Identifier={APP_SERVER_SIGNING_IDENTIFIER}"))
    {
        return Err(RuntimeUpdateError::Signature(
            "unexpected Developer ID team or signing identifier".to_string(),
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn verify_platform_signature(_path: &Path) -> Result<(), RuntimeUpdateError> {
    Ok(())
}

#[cfg(test)]
#[path = "managed_runtime_tests.rs"]
mod tests;
