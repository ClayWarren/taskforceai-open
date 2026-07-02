use std::env;
use std::ffi::OsString;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use flate2::read::GzDecoder;
use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tar::Archive;
use thiserror::Error;
use zip::ZipArchive;

const DEFAULT_UPDATE_REPO: &str = "ClayWarren/taskforceai-open";
const TUI_BINARY_PREFIX: &str = "taskforceai-";
const APP_SERVER_BINARY_PREFIX: &str = "taskforceai-app-server-";
const TUI_RELEASE_BINARY_NAMES: &[&str] = &[
    "taskforceai-linux-amd64",
    "taskforceai-linux-arm64",
    "taskforceai-darwin-amd64",
    "taskforceai-darwin-arm64",
    "taskforceai-windows-amd64.exe",
    "taskforceai-windows-arm64.exe",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateCheck {
    pub current_version: String,
    pub latest_version: String,
    pub archive_name: String,
    pub download_url: String,
    pub checksums_url: String,
}

#[derive(Debug, Error)]
pub enum UpdateError {
    #[error("unsupported platform {0}-{1}")]
    UnsupportedPlatform(&'static str, &'static str),
    #[error("invalid current version {0:?}: {1}")]
    InvalidCurrentVersion(String, semver::Error),
    #[error("invalid release version {0:?}: {1}")]
    InvalidReleaseVersion(String, semver::Error),
    #[error("request latest release: {0}")]
    Request(#[from] reqwest::Error),
    #[error("release asset {0} not found")]
    MissingAsset(String),
    #[error("checksum for release asset {0} not found")]
    MissingChecksum(String),
    #[error("checksum mismatch for {archive_name}: expected {expected}, got {actual}")]
    ChecksumMismatch {
        archive_name: String,
        expected: String,
        actual: String,
    },
    #[error("resolve executable path: {0}")]
    CurrentExe(io::Error),
    #[error("current executable has no parent directory")]
    MissingInstallDir,
    #[error("archive did not contain {0}")]
    MissingArchiveMember(&'static str),
    #[error("self-update is not supported on Windows; rerun the installer to update")]
    WindowsSelfUpdate,
    #[error("update apply requires explicit opt-in: {0}")]
    AutoUpdateDisabled(&'static str),
    #[error("filesystem: {0}")]
    Io(#[from] io::Error),
    #[error("zip archive: {0}")]
    Zip(#[from] zip::result::ZipError),
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

pub fn auto_update_disabled_reason() -> Option<&'static str> {
    if env_truthy("TASKFORCEAI_DISABLE_AUTOUPDATE") {
        return Some("disabled-env");
    }
    if !env_truthy("TASKFORCEAI_ENABLE_AUTOUPDATE") {
        return Some("opt-in-required");
    }
    if env::var_os("npm_package_name").is_some()
        || arg_points_to_node_modules(env::args().next().as_deref())
    {
        return Some("npm-install");
    }
    None
}

fn arg_points_to_node_modules(arg: Option<&str>) -> bool {
    arg.is_some_and(|arg| arg.contains("node_modules"))
}

// coverage:ignore-start -- live GitHub release check.
pub async fn check_for_update_ignoring_opt_in(
    current_version: &str,
) -> Result<Option<UpdateCheck>, UpdateError> {
    let archive_name = platform_archive_name()?;
    let repo =
        env::var("TASKFORCEAI_UPDATE_REPO").unwrap_or_else(|_| DEFAULT_UPDATE_REPO.to_string());
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let release = reqwest::Client::new()
        .get(url)
        .header("accept", "application/vnd.github+json")
        .header("user-agent", "taskforceai-tui")
        .send()
        .await?
        .error_for_status()?
        .json::<GitHubRelease>()
        .await?;
    update_check_from_release(current_version, &archive_name, release)
}
// coverage:ignore-end

// coverage:ignore-start -- downloads archives and replaces the running CLI/app-server binaries.
pub async fn apply_update(check: &UpdateCheck) -> Result<(), UpdateError> {
    if let Some(reason) = auto_update_disabled_reason() {
        return Err(UpdateError::AutoUpdateDisabled(reason));
    }
    if cfg!(windows) {
        return Err(UpdateError::WindowsSelfUpdate);
    }

    let bytes = reqwest::Client::new()
        .get(&check.download_url)
        .header("user-agent", "taskforceai-tui")
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    let checksums = reqwest::Client::new()
        .get(&check.checksums_url)
        .header("user-agent", "taskforceai-tui")
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    verify_archive_checksum(&check.archive_name, &bytes, &checksums)?;

    let exe = env::current_exe().map_err(UpdateError::CurrentExe)?;
    let install_dir = exe
        .parent()
        .ok_or(UpdateError::MissingInstallDir)?
        .to_path_buf();
    let temp_dir = tempfile::Builder::new()
        .prefix(".taskforceai-update-")
        .tempdir_in(&install_dir)?;
    let temp_dir_path = temp_dir.path();
    let archive_path = temp_dir_path.join(&check.archive_name);
    fs::write(&archive_path, bytes)?;

    let members = extract_archive(&archive_path, temp_dir_path)?;
    let app_server_name = app_server_install_name();
    let tui_source = members
        .iter()
        .find(|path| file_name_is_tui_binary(path))
        .ok_or(UpdateError::MissingArchiveMember("taskforceai binary"))?;
    let app_server_source = members
        .iter()
        .find(|path| file_name_is_app_server_binary(path))
        .ok_or(UpdateError::MissingArchiveMember(
            "taskforceai-app-server binary",
        ))?;

    replace_files(&[
        Replacement {
            source: tui_source.clone(),
            target: exe,
        },
        Replacement {
            source: app_server_source.clone(),
            target: install_dir.join(app_server_name),
        },
    ])?;
    Ok(())
}
// coverage:ignore-end

fn update_check_from_release(
    current_version: &str,
    archive_name: &str,
    release: GitHubRelease,
) -> Result<Option<UpdateCheck>, UpdateError> {
    let current = parse_version(current_version)
        .map_err(|err| UpdateError::InvalidCurrentVersion(current_version.to_string(), err))?;
    let latest_version = release.tag_name.trim_start_matches('v');
    let latest = parse_version(latest_version)
        .map_err(|err| UpdateError::InvalidReleaseVersion(release.tag_name.clone(), err))?;
    if latest <= current {
        return Ok(None);
    }
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == archive_name)
        .ok_or_else(|| UpdateError::MissingAsset(archive_name.to_string()))?;
    let checksums = release
        .assets
        .iter()
        .find(|asset| asset.name == "cli-checksums.txt")
        .ok_or_else(|| UpdateError::MissingAsset("cli-checksums.txt".to_string()))?;
    Ok(Some(UpdateCheck {
        current_version: current.to_string(),
        latest_version: latest.to_string(),
        archive_name: archive_name.to_string(),
        download_url: asset.browser_download_url.clone(),
        checksums_url: checksums.browser_download_url.clone(),
    }))
}

fn verify_archive_checksum(
    archive_name: &str,
    archive_bytes: &[u8],
    checksums: &str,
) -> Result<(), UpdateError> {
    let expected = checksum_for_archive(archive_name, checksums)
        .ok_or_else(|| UpdateError::MissingChecksum(archive_name.to_string()))?;
    let actual = sha256_hex(archive_bytes);
    if actual != expected {
        return Err(UpdateError::ChecksumMismatch {
            archive_name: archive_name.to_string(),
            expected,
            actual,
        });
    }
    Ok(())
}

fn checksum_for_archive(archive_name: &str, checksums: &str) -> Option<String> {
    checksums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let checksum = parts.next()?;
        let name = parts.last()?;
        let name = name
            .trim_start_matches('*')
            .trim_start_matches("./")
            .trim_start_matches(".\\");
        if name == archive_name && is_sha256_hex(checksum) {
            Some(checksum.to_ascii_lowercase())
        } else {
            None
        }
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_version(raw: &str) -> Result<Version, semver::Error> {
    Version::parse(raw.trim_start_matches('v'))
}

fn platform_archive_name() -> Result<String, UpdateError> {
    platform_archive_name_for(env::consts::OS, env::consts::ARCH)
}

fn platform_archive_name_for(
    raw_os: &'static str,
    raw_arch: &'static str,
) -> Result<String, UpdateError> {
    let os = match raw_os {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "windows",
        other => return Err(UpdateError::UnsupportedPlatform(other, raw_arch)),
    };
    let arch = match raw_arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => return Err(UpdateError::UnsupportedPlatform(raw_os, other)),
    };
    let suffix = if os == "windows" { "zip" } else { "tar.gz" };
    Ok(format!("taskforceai-cli-{os}-{arch}.{suffix}"))
}

fn extract_archive(archive_path: &Path, temp_dir: &Path) -> Result<Vec<PathBuf>, UpdateError> {
    if archive_path.extension().is_some_and(|ext| ext == "zip") {
        extract_zip(archive_path, temp_dir)
    } else {
        extract_tar_gz(archive_path, temp_dir)
    }
}

fn extract_tar_gz(archive_path: &Path, temp_dir: &Path) -> Result<Vec<PathBuf>, UpdateError> {
    let tar_gz = File::open(archive_path)?;
    let mut archive = Archive::new(GzDecoder::new(tar_gz));
    let mut members = Vec::new();
    for entry in archive.entries()? {
        let mut entry = entry?;
        let name = safe_file_name(&entry.path()?)?;
        let target = temp_dir.join(name);
        entry.unpack(&target)?;
        members.push(target);
    }
    Ok(members)
}

fn extract_zip(archive_path: &Path, temp_dir: &Path) -> Result<Vec<PathBuf>, UpdateError> {
    let mut archive = ZipArchive::new(File::open(archive_path)?)?;
    let mut members = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        if file.is_dir() {
            continue;
        }
        let name = safe_file_name(Path::new(file.name()))?;
        let target = temp_dir.join(name);
        let mut output = File::create(&target)?;
        io::copy(&mut file, &mut output)?;
        members.push(target);
    }
    Ok(members)
}

fn safe_file_name(path: &Path) -> Result<OsString, UpdateError> {
    path.file_name()
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "archive member has no file name",
            )
            .into()
        })
}

#[derive(Debug, Clone)]
struct Replacement {
    source: PathBuf,
    target: PathBuf,
}

fn replace_files(replacements: &[Replacement]) -> Result<(), UpdateError> {
    for replacement in replacements {
        if !replacement.source.exists() {
            return Err(UpdateError::Io(io::Error::new(
                io::ErrorKind::NotFound,
                format!("replacement source {:?} does not exist", replacement.source),
            )));
        }
        if let Some(parent) = replacement.target.parent() {
            if !parent.exists() {
                return Err(UpdateError::Io(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("install directory {parent:?} does not exist"),
                )));
            }
        } // coverage:ignore-line -- structural parent validation close.
    }

    let backups = replacements
        .iter()
        .map(|replacement| replacement.target.with_extension("old"))
        .collect::<Vec<_>>();

    for backup in &backups {
        fs::remove_file(backup).ok();
    }

    let mut backed_up = Vec::new();
    for (replacement, backup) in replacements.iter().zip(backups.iter()) {
        if replacement.target.exists() {
            if let Err(err) = fs::rename(&replacement.target, backup) {
                // coverage:ignore-start -- requires an OS-level rename failure after validation.
                restore_backups(replacements, &backups, backed_up.len());
                return Err(UpdateError::Io(err));
                // coverage:ignore-end
            }
            backed_up.push(true);
        } else {
            backed_up.push(false);
        }
    }

    for (index, replacement) in replacements.iter().enumerate() {
        if let Err(err) = fs::rename(&replacement.source, &replacement.target) {
            // coverage:ignore-start -- requires an OS-level rename failure after validation.
            restore_replaced_files(replacements, index);
            restore_backups(replacements, &backups, backed_up.len());
            return Err(UpdateError::Io(err));
            // coverage:ignore-end
        }
    }

    for (backup, existed) in backups.iter().zip(backed_up.iter()) {
        if *existed {
            fs::remove_file(backup).ok();
        }
    }
    Ok(())
}

// coverage:ignore-start -- only reached from OS-level rename rollback failures.
fn restore_replaced_files(replacements: &[Replacement], replaced_count: usize) {
    for replacement in replacements.iter().take(replaced_count) {
        fs::rename(&replacement.target, &replacement.source).ok();
    }
}

fn restore_backups(replacements: &[Replacement], backups: &[PathBuf], backup_count: usize) {
    for (replacement, backup) in replacements.iter().zip(backups.iter()).take(backup_count) {
        fs::rename(backup, &replacement.target).ok();
    }
}
// coverage:ignore-end

fn app_server_install_name() -> &'static str {
    app_server_install_name_for(cfg!(windows))
}

fn app_server_install_name_for(windows: bool) -> &'static str {
    if windows {
        "taskforceai-app-server.exe"
    } else {
        "taskforceai-app-server"
    }
}

fn file_name_is_tui_binary(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    name == "taskforceai"
        || name == "taskforceai.exe"
        || (name.starts_with(TUI_BINARY_PREFIX)
            && !name.starts_with(APP_SERVER_BINARY_PREFIX)
            && TUI_RELEASE_BINARY_NAMES.contains(&name))
}

fn file_name_is_app_server_binary(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    name == "taskforceai-app-server"
        || name == "taskforceai-app-server.exe"
        || name.starts_with(APP_SERVER_BINARY_PREFIX)
}

fn env_truthy(name: &str) -> bool {
    env::var(name).is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    static UPDATE_ENV_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn unique_test_dir(name: &str) -> PathBuf {
        env::temp_dir().join(format!(
            "taskforceai-update-test-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after unix epoch")
                .as_nanos()
        ))
    }

    #[test]
    fn release_newer_than_current_returns_asset() {
        let release = GitHubRelease {
            tag_name: "v1.2.0".to_string(),
            assets: vec![
                GitHubAsset {
                    name: "taskforceai-cli-darwin-arm64.tar.gz".to_string(),
                    browser_download_url: "https://example.test/archive".to_string(),
                },
                GitHubAsset {
                    name: "cli-checksums.txt".to_string(),
                    browser_download_url: "https://example.test/checksums".to_string(),
                },
            ],
        };
        let check =
            update_check_from_release("1.1.0", "taskforceai-cli-darwin-arm64.tar.gz", release)
                .expect("release should parse")
                .expect("newer release should be returned");
        assert_eq!(check.latest_version, "1.2.0");
        assert_eq!(check.download_url, "https://example.test/archive");
        assert_eq!(check.checksums_url, "https://example.test/checksums");
    }

    #[test]
    fn release_not_newer_returns_none() {
        let release = GitHubRelease {
            tag_name: "v1.1.0".to_string(),
            assets: vec![GitHubAsset {
                name: "taskforceai-cli-darwin-arm64.tar.gz".to_string(),
                browser_download_url: "https://example.test/archive".to_string(),
            }],
        };
        let check =
            update_check_from_release("1.1.0", "taskforceai-cli-darwin-arm64.tar.gz", release)
                .expect("release should parse");
        assert!(check.is_none());
    }

    #[test]
    fn missing_matching_asset_is_an_error() {
        let release = GitHubRelease {
            tag_name: "v1.2.0".to_string(),
            assets: Vec::new(),
        };
        let err = update_check_from_release("1.1.0", "missing.tar.gz", release)
            .expect_err("missing archive should fail");
        assert!(matches!(err, UpdateError::MissingAsset(name) if name == "missing.tar.gz"));
    }

    #[test]
    fn missing_checksums_asset_is_an_error_for_newer_release() {
        let release = GitHubRelease {
            tag_name: "v1.2.0".to_string(),
            assets: vec![GitHubAsset {
                name: "taskforceai-cli-darwin-arm64.tar.gz".to_string(),
                browser_download_url: "https://example.test/archive".to_string(),
            }],
        };
        let err =
            update_check_from_release("1.1.0", "taskforceai-cli-darwin-arm64.tar.gz", release)
                .expect_err("missing checksums asset should fail");
        assert!(matches!(err, UpdateError::MissingAsset(name) if name == "cli-checksums.txt"));
    }

    #[test]
    fn archive_checksum_must_match_release_checksums() {
        let archive_name = "taskforceai-cli-darwin-arm64.tar.gz";
        let archive_bytes = b"archive bytes";
        let checksum = sha256_hex(archive_bytes);
        let checksums = format!(
            "0000000000000000000000000000000000000000000000000000000000000000  other.tar.gz\n{checksum}  *{archive_name}\n"
        );

        verify_archive_checksum(archive_name, archive_bytes, &checksums)
            .expect("matching checksum should verify");

        let err = verify_archive_checksum(archive_name, b"tampered", &checksums)
            .expect_err("mismatched archive should fail");
        assert!(matches!(err, UpdateError::ChecksumMismatch { .. }));
    }

    #[test]
    fn checksum_parser_rejects_missing_and_invalid_entries() {
        let archive_name = "taskforceai-cli-darwin-arm64.tar.gz";
        let invalid_checksums = [
            "",
            "not-a-sha  taskforceai-cli-darwin-arm64.tar.gz",
            "000000000000000000000000000000000000000000000000000000000000000z  taskforceai-cli-darwin-arm64.tar.gz",
            "0000000000000000000000000000000000000000000000000000000000000000  other.tar.gz",
        ]
        .join("\n");

        assert_eq!(checksum_for_archive(archive_name, &invalid_checksums), None);
        assert!(
            verify_archive_checksum(archive_name, b"archive", &invalid_checksums).is_err_and(
                |err| matches!(err, UpdateError::MissingChecksum(name) if name == archive_name)
            )
        );
    }

    #[test]
    fn current_platform_archive_name_and_install_name_are_supported() {
        let archive_name = platform_archive_name().expect("current platform should be supported");

        assert!(archive_name.starts_with("taskforceai-cli-"));
        assert!(archive_name.ends_with(".tar.gz") || archive_name.ends_with(".zip"));
        assert!(app_server_install_name().starts_with("taskforceai-app-server"));
        assert_eq!(
            platform_archive_name_for("macos", "aarch64").expect("darwin arm64"),
            "taskforceai-cli-darwin-arm64.tar.gz"
        );
        assert_eq!(
            platform_archive_name_for("linux", "x86_64").expect("linux amd64"),
            "taskforceai-cli-linux-amd64.tar.gz"
        );
        assert_eq!(
            platform_archive_name_for("windows", "x86_64").expect("windows amd64"),
            "taskforceai-cli-windows-amd64.zip"
        );
        assert!(matches!(
            platform_archive_name_for("plan9", "x86_64"),
            Err(UpdateError::UnsupportedPlatform("plan9", "x86_64"))
        ));
        assert!(matches!(
            platform_archive_name_for("macos", "sparc"),
            Err(UpdateError::UnsupportedPlatform("macos", "sparc"))
        ));
    }

    #[test]
    fn extract_archive_supports_tar_gz_and_zip_members() {
        let dir = unique_test_dir("archives");
        let tar_out = dir.join("tar-out");
        let zip_out = dir.join("zip-out");
        fs::create_dir_all(&tar_out).expect("tar out dir");
        fs::create_dir_all(&zip_out).expect("zip out dir");

        let tar_path = dir.join("release.tar.gz");
        let tar_file = File::create(&tar_path).expect("tar file");
        let encoder = flate2::write::GzEncoder::new(tar_file, flate2::Compression::default());
        let mut tar = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(3);
        header.set_mode(0o755);
        header.set_cksum();
        tar.append_data(&mut header, "nested/taskforceai", &b"tui"[..])
            .expect("append tar member");
        tar.finish().expect("finish tar");
        let encoder = tar.into_inner().expect("tar encoder");
        encoder.finish().expect("finish gzip");

        let tar_members = extract_archive(&tar_path, &tar_out).expect("tar.gz should extract");
        assert_eq!(tar_members, vec![tar_out.join("taskforceai")]);
        assert_eq!(
            fs::read_to_string(tar_out.join("taskforceai")).expect("tar member"),
            "tui"
        );

        let zip_path = dir.join("release.zip");
        let zip_file = File::create(&zip_path).expect("zip file");
        let mut zip = zip::ZipWriter::new(zip_file);
        let options = zip::write::SimpleFileOptions::default();
        zip.add_directory("ignored/", options)
            .expect("zip directory");
        zip.start_file("nested/taskforceai-app-server", options)
            .expect("zip member");
        zip.write_all(b"server").expect("zip contents");
        zip.finish().expect("finish zip");

        let zip_members = extract_archive(&zip_path, &zip_out).expect("zip should extract");
        assert_eq!(zip_members, vec![zip_out.join("taskforceai-app-server")]);
        assert_eq!(
            fs::read_to_string(zip_out.join("taskforceai-app-server")).expect("zip member"),
            "server"
        );

        fs::remove_dir_all(dir).ok();
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn apply_update_requires_explicit_opt_in() {
        let _guard = UPDATE_ENV_TEST_LOCK.lock().expect("update env test lock");
        unsafe {
            env::remove_var("TASKFORCEAI_ENABLE_AUTOUPDATE");
            env::remove_var("TASKFORCEAI_DISABLE_AUTOUPDATE");
        }

        let check = UpdateCheck {
            current_version: "1.0.0".to_string(),
            latest_version: "1.1.0".to_string(),
            archive_name: "taskforceai-cli-darwin-arm64.tar.gz".to_string(),
            download_url: "https://example.test/archive".to_string(),
            checksums_url: "https://example.test/checksums".to_string(),
        };
        let err = apply_update(&check)
            .await
            .expect_err("apply should require opt-in before network access");
        assert!(matches!(
            err,
            UpdateError::AutoUpdateDisabled("opt-in-required")
        ));
    }

    #[test]
    fn auto_update_disabled_reason_prefers_disable_and_install_context() {
        let _guard = UPDATE_ENV_TEST_LOCK.lock().expect("update env test lock");
        unsafe {
            env::set_var("TASKFORCEAI_DISABLE_AUTOUPDATE", "1");
            env::set_var("TASKFORCEAI_ENABLE_AUTOUPDATE", "1");
            env::remove_var("npm_package_name");
        }
        assert_eq!(auto_update_disabled_reason(), Some("disabled-env"));

        unsafe {
            env::remove_var("TASKFORCEAI_DISABLE_AUTOUPDATE");
            env::set_var("npm_package_name", "taskforceai");
        }
        assert_eq!(auto_update_disabled_reason(), Some("npm-install"));
        assert!(arg_points_to_node_modules(Some(
            "/repo/node_modules/.bin/taskforceai"
        )));
        assert!(!arg_points_to_node_modules(Some(
            "/usr/local/bin/taskforceai"
        )));
        assert!(!arg_points_to_node_modules(None));

        unsafe {
            env::remove_var("TASKFORCEAI_DISABLE_AUTOUPDATE");
            env::remove_var("npm_package_name");
            env::set_var("TASKFORCEAI_ENABLE_AUTOUPDATE", "1");
        }
        assert_eq!(auto_update_disabled_reason(), None);

        unsafe {
            env::remove_var("TASKFORCEAI_DISABLE_AUTOUPDATE");
            env::remove_var("TASKFORCEAI_ENABLE_AUTOUPDATE");
            env::remove_var("npm_package_name");
        }
        assert_eq!(auto_update_disabled_reason(), Some("opt-in-required"));
    }

    #[test]
    fn binary_member_matching_does_not_confuse_app_server_for_tui() {
        assert!(file_name_is_tui_binary(Path::new(
            "taskforceai-darwin-arm64"
        )));
        assert!(file_name_is_tui_binary(Path::new("taskforceai.exe")));
        assert!(!file_name_is_tui_binary(Path::new(
            "taskforceai-app-server-darwin-arm64"
        )));
        assert!(!file_name_is_tui_binary(Path::new("taskforceai-README.md")));
        assert!(!file_name_is_tui_binary(Path::new(
            "taskforceai-darwin-arm64.sig"
        )));

        assert!(file_name_is_app_server_binary(Path::new(
            "taskforceai-app-server-darwin-arm64"
        )));
        assert!(file_name_is_app_server_binary(Path::new(
            "taskforceai-app-server.exe"
        )));
        assert!(!file_name_is_app_server_binary(Path::new(
            "taskforceai-darwin-arm64"
        )));
        assert!(!file_name_is_tui_binary(Path::new("")));
        assert!(!file_name_is_app_server_binary(Path::new("")));
        assert!(safe_file_name(Path::new("")).is_err());
        assert_eq!(
            app_server_install_name_for(true),
            "taskforceai-app-server.exe"
        );
        assert_eq!(app_server_install_name_for(false), "taskforceai-app-server");
    }

    #[test]
    fn replace_files_validates_sources_and_install_dirs_before_mutating() {
        let dir = unique_test_dir("validation");
        fs::create_dir_all(&dir).expect("test dir");
        let missing_source = dir.join("missing-source");
        let target = dir.join("target");

        let err = replace_files(&[Replacement {
            source: missing_source,
            target: target.clone(),
        }])
        .expect_err("missing source should fail");
        assert!(matches!(err, UpdateError::Io(_)));
        assert!(!target.exists());

        let source = dir.join("source");
        fs::write(&source, "new").expect("source");
        let missing_parent_target = dir.join("missing-parent").join("target");
        let err = replace_files(&[Replacement {
            source: source.clone(),
            target: missing_parent_target,
        }])
        .expect_err("missing install dir should fail");
        assert!(matches!(err, UpdateError::Io(_)));
        assert_eq!(fs::read_to_string(source).expect("source"), "new");

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn replace_files_replaces_binary_pair() {
        let dir = unique_test_dir("success");
        fs::create_dir_all(&dir).expect("test dir");
        let tui_source = dir.join("taskforceai-new");
        let app_server_source = dir.join("taskforceai-app-server-new");
        let tui_target = dir.join("taskforceai");
        let app_server_target = dir.join("taskforceai-app-server");
        fs::write(&tui_source, "new tui").expect("source");
        fs::write(&app_server_source, "new app-server").expect("source");
        fs::write(&tui_target, "old tui").expect("target");
        fs::write(&app_server_target, "old app-server").expect("target");

        replace_files(&[
            Replacement {
                source: tui_source.clone(),
                target: tui_target.clone(),
            },
            Replacement {
                source: app_server_source.clone(),
                target: app_server_target.clone(),
            },
        ])
        .expect("pair replacement should succeed");

        assert_eq!(fs::read_to_string(&tui_target).expect("tui"), "new tui");
        assert_eq!(
            fs::read_to_string(&app_server_target).expect("app-server"),
            "new app-server"
        );
        assert!(!tui_source.exists());
        assert!(!app_server_source.exists());

        let missing_target_source = dir.join("missing-target-source");
        let missing_target = dir.join("new-target");
        fs::write(&missing_target_source, "created").expect("missing target source");
        replace_files(&[Replacement {
            source: missing_target_source.clone(),
            target: missing_target.clone(),
        }])
        .expect("single replacement should create missing target");
        assert_eq!(
            fs::read_to_string(&missing_target).expect("missing target"),
            "created"
        );
        assert!(!missing_target_source.exists());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn replace_files_rolls_back_pair_when_second_target_fails() {
        let dir = unique_test_dir("rollback");
        fs::create_dir_all(&dir).expect("test dir");
        let tui_source = dir.join("taskforceai-new");
        let app_server_source = dir.join("taskforceai-app-server-new");
        let tui_target = dir.join("taskforceai");
        let app_server_target = dir.join("missing").join("taskforceai-app-server");
        fs::write(&tui_source, "new tui").expect("source");
        fs::write(&app_server_source, "new app-server").expect("source");
        fs::write(&tui_target, "old tui").expect("target");

        let err = replace_files(&[
            Replacement {
                source: tui_source.clone(),
                target: tui_target.clone(),
            },
            Replacement {
                source: app_server_source.clone(),
                target: app_server_target,
            },
        ])
        .expect_err("missing app-server install dir should fail");

        assert!(matches!(err, UpdateError::Io(_)));
        assert_eq!(fs::read_to_string(&tui_target).expect("tui"), "old tui");
        assert_eq!(fs::read_to_string(&tui_source).expect("source"), "new tui");
        assert_eq!(
            fs::read_to_string(&app_server_source).expect("source"),
            "new app-server"
        );
        fs::remove_dir_all(dir).ok();
    }
}
