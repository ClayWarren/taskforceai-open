use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
#[cfg(not(coverage))]
use tauri::Manager;
#[cfg(all(target_os = "macos", not(coverage)))]
use tokio::process::Command;
#[cfg(not(coverage))]
use tracing::{debug, warn};

const SETTINGS_FILE_NAME: &str = "screen-memory.json";
const MEMORY_FILE_RELATIVE_PATH: &[&str] = &[".taskforceai", "screen-memory", "MEMORY.md"];
#[cfg(not(coverage))]
const TEMP_ROOT: &str = "taskforceai-screen-memory";
#[cfg(not(coverage))]
const CAPTURE_DIR: &str = "screen_recording";
const CAPTURE_TTL: Duration = Duration::from_secs(6 * 60 * 60);
#[cfg(not(coverage))]
const BACKGROUND_CAPTURE_INTERVAL: Duration = Duration::from_secs(5 * 60);
#[cfg(not(coverage))]
const BACKGROUND_CAPTURE_INITIAL_DELAY: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenMemorySettings {
    enabled: bool,
    paused: bool,
}

impl Default for ScreenMemorySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            paused: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenMemoryStatus {
    pub supported: bool,
    pub enabled: bool,
    pub paused: bool,
    pub capture_directory: String,
    pub memory_path: Option<String>,
    pub latest_capture_path: Option<String>,
    pub latest_capture_at: Option<u64>,
    pub capture_count: usize,
    pub bytes: u64,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct ScreenMemoryManager {
    settings_path: Option<PathBuf>,
    capture_dir: PathBuf,
    memory_path: Option<PathBuf>,
}

impl ScreenMemoryManager {
    #[cfg(not(coverage))]
    pub fn with_app_handle(app: &tauri::AppHandle) -> Self {
        let settings_path = app
            .path()
            .app_config_dir()
            .ok()
            .map(|dir| dir.join(SETTINGS_FILE_NAME));
        Self {
            settings_path,
            capture_dir: std::env::temp_dir().join(TEMP_ROOT).join(CAPTURE_DIR),
            memory_path: home_dir().map(screen_memory_file_path),
        }
    }

    #[cfg(test)]
    pub fn with_paths(
        settings_path: Option<PathBuf>,
        capture_dir: PathBuf,
        memory_path: Option<PathBuf>,
    ) -> Self {
        Self {
            settings_path,
            capture_dir,
            memory_path,
        }
    }

    pub fn status(&self) -> ScreenMemoryStatus {
        let _ = self.prune_expired_captures();
        let settings = self.load_settings();
        self.status_with_settings(settings, None)
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<ScreenMemoryStatus, String> {
        let mut settings = self.load_settings();
        settings.enabled = enabled;
        settings.paused = !enabled;
        self.save_settings(&settings)?;
        self.write_memory_source(&settings, None)?;
        Ok(self.status_with_settings(settings, None))
    }

    pub fn set_paused(&self, paused: bool) -> Result<ScreenMemoryStatus, String> {
        let mut settings = self.load_settings();
        if paused {
            settings.paused = true;
        } else {
            settings.enabled = true;
            settings.paused = false;
        }
        self.save_settings(&settings)?;
        self.write_memory_source(&settings, None)?;
        Ok(self.status_with_settings(settings, None))
    }

    pub async fn capture_now(&self) -> Result<ScreenMemoryStatus, String> {
        let settings = self.load_settings();
        if !settings.enabled {
            return Err("Screen Memory is disabled.".to_string());
        }
        if settings.paused {
            return Err("Screen Memory is paused.".to_string());
        }
        #[cfg(not(target_os = "macos"))]
        if !screen_capture_supported() {
            return Err("Screen Memory capture is only available on macOS.".to_string());
        }

        fs::create_dir_all(&self.capture_dir).map_err(|error| {
            format!(
                "Failed to create Screen Memory capture directory {}: {error}",
                self.capture_dir.display()
            )
        })?;
        let capture_path = self
            .capture_dir
            .join(format!("screen-{}.png", unix_millis_now()));
        run_screencapture(&capture_path).await?;
        self.prune_expired_captures()?;
        self.write_memory_source(&settings, Some(&capture_path))?;
        Ok(self.status_with_settings(settings, Some("Captured current screen.")))
    }

    fn load_settings(&self) -> ScreenMemorySettings {
        let Some(path) = &self.settings_path else {
            return ScreenMemorySettings::default();
        };
        let Ok(raw) = fs::read_to_string(path) else {
            return ScreenMemorySettings::default();
        };
        serde_json::from_str(&raw).unwrap_or_default()
    }

    fn save_settings(&self, settings: &ScreenMemorySettings) -> Result<(), String> {
        let Some(path) = &self.settings_path else {
            return Err("Screen Memory settings path is unavailable.".to_string());
        };
        let parent = path
            .parent()
            .expect("screen memory settings path should include a parent directory");
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create Screen Memory settings directory {}: {error}",
                parent.display()
            )
        })?;
        let raw = serde_json::to_string_pretty(settings)
            .expect("screen memory settings should serialize");
        fs::write(path, raw).map_err(|error| {
            format!(
                "Failed to write Screen Memory settings {}: {error}",
                path.display()
            )
        })
    }

    fn status_with_settings(
        &self,
        settings: ScreenMemorySettings,
        message_override: Option<&str>,
    ) -> ScreenMemoryStatus {
        let captures = self.capture_summary().unwrap_or_default();
        let latest = captures.latest.as_ref();
        let supported = screen_capture_supported();
        let message = message_override
            .map(ToString::to_string)
            .unwrap_or_else(|| screen_memory_message(supported, settings.enabled, settings.paused));
        ScreenMemoryStatus {
            supported,
            enabled: settings.enabled,
            paused: settings.paused,
            capture_directory: self.capture_dir.display().to_string(),
            memory_path: self
                .memory_path
                .as_ref()
                .map(|path| path.display().to_string()),
            latest_capture_path: latest.map(|record| record.path.display().to_string()),
            latest_capture_at: latest.map(|record| record.modified_ms),
            capture_count: captures.count,
            bytes: captures.bytes,
            message,
        }
    }

    fn capture_summary(&self) -> Result<CaptureSummary, String> {
        let entries = match fs::read_dir(&self.capture_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(CaptureSummary::default());
            }
            Err(error) => {
                return Err(format!(
                    "Failed to read Screen Memory capture directory {}: {error}",
                    self.capture_dir.display()
                ));
            }
        };
        let mut summary = CaptureSummary::default();
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("png") {
                continue;
            }
            #[cfg(not(coverage))]
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            #[cfg(coverage)]
            let metadata = entry
                .metadata()
                .expect("capture metadata should be readable");
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(system_time_to_millis)
                .unwrap_or(0);
            let record = CaptureRecord {
                path,
                modified_ms,
                bytes: metadata.len(),
            };
            summary.count += 1;
            summary.bytes += record.bytes;
            if summary
                .latest
                .as_ref()
                .is_none_or(|latest| record.modified_ms > latest.modified_ms)
            {
                summary.latest = Some(record);
            }
        }
        Ok(summary)
    }

    fn prune_expired_captures(&self) -> Result<(), String> {
        let Ok(entries) = fs::read_dir(&self.capture_dir) else {
            return Ok(());
        };
        let cutoff = SystemTime::now()
            .checked_sub(CAPTURE_TTL)
            .unwrap_or(UNIX_EPOCH);
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("png") {
                continue;
            }
            #[cfg(not(coverage))]
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            #[cfg(coverage)]
            let metadata = entry
                .metadata()
                .expect("capture metadata should be readable");
            if metadata
                .modified()
                .map(|modified| modified < cutoff)
                .unwrap_or(false)
            {
                let _ = fs::remove_file(path);
            }
        }
        Ok(())
    }

    fn write_memory_source(
        &self,
        settings: &ScreenMemorySettings,
        latest_capture: Option<&Path>,
    ) -> Result<(), String> {
        let Some(path) = &self.memory_path else {
            return Ok(());
        };
        let parent = path
            .parent()
            .expect("screen memory source path should include a parent directory");
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create Screen Memory source directory {}: {error}",
                parent.display()
            )
        })?;
        let status = self.status_with_settings(settings.clone(), None);
        let latest_capture_path = latest_capture
            .map(|path| path.display().to_string())
            .or(status.latest_capture_path);
        let body = format!(
            "# Screen Memory\n\n\
Status: {}\n\
Paused: {}\n\
Capture count: {}\n\
Latest capture: {}\n\
Capture directory: {}\n\n\
Screen Memory is an opt-in TaskForceAI Desktop feature. It stores temporary screen snapshots locally for future visual summarization; image contents are not summarized automatically yet.\n",
            if settings.enabled { "enabled" } else { "disabled" },
            if settings.paused { "yes" } else { "no" },
            status.capture_count,
            latest_capture_path.unwrap_or_else(|| "none".to_string()),
            self.capture_dir.display(),
        );
        fs::write(path, body).map_err(|error| {
            format!(
                "Failed to write Screen Memory source {}: {error}",
                path.display()
            )
        })
    }
}

#[derive(Debug)]
struct CaptureRecord {
    path: PathBuf,
    modified_ms: u64,
    bytes: u64,
}

#[derive(Debug, Default)]
struct CaptureSummary {
    latest: Option<CaptureRecord>,
    count: usize,
    bytes: u64,
}

#[cfg(not(coverage))]
pub fn start_screen_memory_background(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(BACKGROUND_CAPTURE_INITIAL_DELAY).await;
        loop {
            let manager = ScreenMemoryManager::with_app_handle(&app);
            let settings = manager.load_settings();
            if settings.enabled && !settings.paused {
                match manager.capture_now().await {
                    Ok(status) => debug!(
                        target: "screen_memory",
                        captures = status.capture_count,
                        "Background screen capture completed"
                    ),
                    Err(error) => warn!(
                        target: "screen_memory",
                        error = %error,
                        "Background screen capture failed"
                    ),
                }
            }
            tokio::time::sleep(BACKGROUND_CAPTURE_INTERVAL).await;
        }
    });
}

fn screen_memory_message(supported: bool, enabled: bool, paused: bool) -> String {
    if !supported {
        return "Screen Memory capture is only available on macOS.".to_string();
    }
    if !enabled {
        return "Screen Memory is off.".to_string();
    }
    if paused {
        return "Screen Memory is paused.".to_string();
    }
    "Screen Memory is capturing temporary local snapshots.".to_string()
}

fn screen_capture_supported() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(not(coverage))]
async fn run_screencapture(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("screencapture")
            .arg("-x")
            .arg("-t")
            .arg("png")
            .arg(path)
            .output()
            .await
            .map_err(|error| format!("Failed to run screencapture: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(
                "screencapture failed. Grant Screen Recording permission to TaskForceAI."
                    .to_string(),
            )
        } else {
            Err(format!("screencapture failed: {stderr}"))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Screen Memory capture is only available on macOS.".to_string())
    }
}

#[cfg(coverage)]
async fn run_screencapture(path: &Path) -> Result<(), String> {
    fs::write(path, b"coverage screen capture")
        .map_err(|error| format!("Failed to write coverage screen capture: {error}"))
}

fn unix_millis_now() -> u64 {
    system_time_to_millis(SystemTime::now()).unwrap_or(0)
}

fn system_time_to_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn screen_memory_file_path(home: PathBuf) -> PathBuf {
    MEMORY_FILE_RELATIVE_PATH
        .iter()
        .fold(home, |path, part| path.join(part))
}

#[cfg(test)]
#[path = "screen_memory_tests.rs"]
mod tests;
