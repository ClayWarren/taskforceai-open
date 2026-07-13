use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tokio::process::Command;

const APPSHOTS_DIR: &str = "appshots";
const APPSHOT_TEXT_LIMIT: usize = 200_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppshotCaptureResult {
    pub supported: bool,
    pub captured_at: u64,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub image_path: Option<String>,
    pub text_path: Option<String>,
    pub metadata_path: Option<String>,
    pub text: Option<String>,
    pub permissions: AppshotPermissionHints,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppshotPermissionHints {
    pub screen_recording_required: bool,
    pub accessibility_required: bool,
}

#[derive(Debug, Clone)]
pub struct AppshotManager {
    root_dir: PathBuf,
}

impl AppshotManager {
    pub fn with_app_handle(app: &tauri::AppHandle) -> Result<Self, String> {
        let root_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
            .join(APPSHOTS_DIR);
        Ok(Self { root_dir })
    }

    pub async fn capture_frontmost(&self) -> Result<AppshotCaptureResult, String> {
        if !appshots_supported() {
            return Ok(AppshotCaptureResult {
                supported: false,
                captured_at: unix_millis_now(),
                app_name: None,
                window_title: None,
                image_path: None,
                text_path: None,
                metadata_path: None,
                text: None,
                permissions: AppshotPermissionHints {
                    screen_recording_required: false,
                    accessibility_required: false,
                },
                message: "Appshots are only available on macOS.".to_string(),
            });
        }

        fs::create_dir_all(&self.root_dir).map_err(|error| {
            format!(
                "Failed to create Appshots directory {}: {error}",
                self.root_dir.display()
            )
        })?;

        let captured_at = unix_millis_now();
        let slug = format!("appshot-{captured_at}");
        let image_path = self.root_dir.join(format!("{slug}.png"));
        let text_path = self.root_dir.join(format!("{slug}.txt"));
        let metadata_path = self.root_dir.join(format!("{slug}.json"));

        let window = frontmost_window().await?;
        let text_capture = frontmost_window_text().await;
        let text = text_capture
            .as_ref()
            .ok()
            .and_then(|capture| capture.text.as_ref())
            .map(|value| truncate_text(value, APPSHOT_TEXT_LIMIT));
        let accessibility_required = text_capture
            .as_ref()
            .map(|capture| capture.accessibility_required)
            .unwrap_or(true);
        let app_name = text_capture
            .as_ref()
            .ok()
            .and_then(|capture| capture.app_name.clone())
            .or_else(|| window.app_name.clone());
        let window_title = text_capture
            .as_ref()
            .ok()
            .and_then(|capture| capture.window_title.clone())
            .or_else(|| window.window_title.clone());

        capture_window_image(window.window_id, &image_path).await?;
        if let Some(text) = &text {
            fs::write(&text_path, text).map_err(|error| {
                format!(
                    "Failed to write Appshot text {}: {error}",
                    text_path.display()
                )
            })?;
        }

        let metadata = AppshotMetadata {
            captured_at,
            app_name: app_name.clone(),
            window_title: window_title.clone(),
            window_id: Some(window.window_id),
            image_path: Some(image_path.display().to_string()),
            text_path: text.as_ref().map(|_| text_path.display().to_string()),
            accessibility_text_captured: text
                .as_ref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false),
        };
        let raw_metadata =
            serde_json::to_string_pretty(&metadata).expect("appshot metadata should serialize");
        fs::write(&metadata_path, raw_metadata).map_err(|error| {
            format!(
                "Failed to write Appshot metadata {}: {error}",
                metadata_path.display()
            )
        })?;

        Ok(AppshotCaptureResult {
            supported: true,
            captured_at,
            app_name,
            window_title,
            image_path: Some(image_path.display().to_string()),
            text_path: text.as_ref().map(|_| text_path.display().to_string()),
            metadata_path: Some(metadata_path.display().to_string()),
            text,
            permissions: AppshotPermissionHints {
                screen_recording_required: false,
                accessibility_required,
            },
            message: if accessibility_required {
                "Captured the frontmost window image. Grant Accessibility permission to include available text."
                    .to_string()
            } else {
                "Captured the frontmost window image and available text.".to_string()
            },
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppshotMetadata {
    captured_at: u64,
    app_name: Option<String>,
    window_title: Option<String>,
    window_id: Option<u32>,
    image_path: Option<String>,
    text_path: Option<String>,
    accessibility_text_captured: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AppshotWindow {
    window_id: u32,
    app_name: Option<String>,
    window_title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AppshotTextCapture {
    app_name: Option<String>,
    window_title: Option<String>,
    text: Option<String>,
    accessibility_required: bool,
}

fn appshots_supported() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(target_os = "macos")]
async fn frontmost_window() -> Result<AppshotWindow, String> {
    use core_foundation::{base::TCFType, dictionary::CFDictionary};
    use core_graphics::window::{
        copy_window_info, kCGNullWindowID, kCGWindowAlpha, kCGWindowLayer, kCGWindowListOptionAll,
        kCGWindowName, kCGWindowNumber, kCGWindowOwnerName, kCGWindowSharingState,
    };

    let windows = copy_window_info(kCGWindowListOptionAll, kCGNullWindowID)
        .ok_or_else(|| "Failed to read macOS window list.".to_string())?;
    for window in windows.iter() {
        let dictionary = unsafe { CFDictionary::wrap_under_get_rule((*window).cast()) };
        let layer = dictionary_i64(&dictionary, unsafe { kCGWindowLayer });
        if layer != Some(0) {
            continue;
        }
        let sharing_state = dictionary_i64(&dictionary, unsafe { kCGWindowSharingState });
        if sharing_state == Some(0) {
            continue;
        }
        let alpha = dictionary_f64(&dictionary, unsafe { kCGWindowAlpha }).unwrap_or(1.0);
        if alpha <= 0.0 {
            continue;
        }
        let Some(window_id) = dictionary_i64(&dictionary, unsafe { kCGWindowNumber })
            .and_then(|value| u32::try_from(value).ok())
        else {
            continue;
        };
        let app_name = dictionary_string(&dictionary, unsafe { kCGWindowOwnerName });
        let window_title = dictionary_string(&dictionary, unsafe { kCGWindowName });
        if app_name.as_deref() == Some("TaskForceAI") {
            continue;
        }
        return Ok(AppshotWindow {
            window_id,
            app_name,
            window_title,
        });
    }

    Err("No frontmost capturable window was found.".to_string())
}

#[cfg(target_os = "macos")]
fn dictionary_i64(
    dictionary: &core_foundation::dictionary::CFDictionary,
    key: core_foundation::string::CFStringRef,
) -> Option<i64> {
    use core_foundation::number::CFNumber;

    dictionary_value(dictionary, key)
        .and_then(|value| value.downcast::<CFNumber>())
        .and_then(|value| value.to_i64())
}

#[cfg(target_os = "macos")]
fn dictionary_f64(
    dictionary: &core_foundation::dictionary::CFDictionary,
    key: core_foundation::string::CFStringRef,
) -> Option<f64> {
    use core_foundation::number::CFNumber;

    dictionary_value(dictionary, key)
        .and_then(|value| value.downcast::<CFNumber>())
        .and_then(|value| value.to_f64())
}

#[cfg(target_os = "macos")]
fn dictionary_string(
    dictionary: &core_foundation::dictionary::CFDictionary,
    key: core_foundation::string::CFStringRef,
) -> Option<String> {
    use core_foundation::string::CFString;

    dictionary_value(dictionary, key)
        .and_then(|value| value.downcast::<CFString>())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
}

#[cfg(target_os = "macos")]
fn dictionary_value(
    dictionary: &core_foundation::dictionary::CFDictionary,
    key: core_foundation::string::CFStringRef,
) -> Option<core_foundation::base::CFType> {
    use core_foundation::{
        base::{CFType, TCFType},
        string::CFString,
    };

    let key = unsafe { CFString::wrap_under_get_rule(key) };
    dictionary
        .find(key.as_CFTypeRef())
        .map(|value| unsafe { CFType::wrap_under_get_rule(*value as _) })
}

#[cfg(not(target_os = "macos"))]
async fn frontmost_window() -> Result<AppshotWindow, String> {
    Err("Appshots are only available on macOS.".to_string())
}

#[cfg(target_os = "macos")]
async fn capture_window_image(window_id: u32, path: &Path) -> Result<(), String> {
    let output = Command::new("screencapture")
        .arg("-x")
        .arg("-o")
        .arg("-t")
        .arg("png")
        .arg("-l")
        .arg(window_id.to_string())
        .arg(path)
        .output()
        .await
        .map_err(|error| format!("Failed to run Appshot window capture: {error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err("Appshot capture failed. Grant Screen & System Audio Recording permission to TaskForceAI.".to_string())
    } else {
        Err(format!("Appshot capture failed: {stderr}"))
    }
}

#[cfg(not(target_os = "macos"))]
async fn capture_window_image(_window_id: u32, _path: &Path) -> Result<(), String> {
    Err("Appshots are only available on macOS.".to_string())
}

#[cfg(target_os = "macos")]
async fn frontmost_window_text() -> Result<AppshotTextCapture, String> {
    let script = r#"
set output to ""
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set windowTitle to ""
  set windowText to ""
  try
    if (count of windows of frontApp) > 0 then
      set frontWindow to front window of frontApp
      set windowTitle to name of frontWindow
      try
        set windowText to value of entire contents of frontWindow as text
      end try
    end if
  end try
end tell
return appName & linefeed & windowTitle & linefeed & windowText
"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .await
        .map_err(|error| format!("Failed to inspect frontmost window text: {error}"))?;
    if !output.status.success() {
        return Ok(AppshotTextCapture {
            app_name: None,
            window_title: None,
            text: None,
            accessibility_required: true,
        });
    }
    Ok(parse_appshot_text_capture(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

#[cfg(not(target_os = "macos"))]
async fn frontmost_window_text() -> Result<AppshotTextCapture, String> {
    Err("Appshots are only available on macOS.".to_string())
}

fn parse_appshot_text_capture(output: &str) -> AppshotTextCapture {
    let mut parts = output.splitn(3, '\n');
    let app_name = non_empty_trimmed(parts.next());
    let window_title = non_empty_trimmed(parts.next());
    let text = non_empty_trimmed(parts.next());
    let accessibility_required = text.is_none();
    AppshotTextCapture {
        app_name,
        window_title,
        text,
        accessibility_required,
    }
}

fn non_empty_trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn truncate_text(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_string();
    }
    let mut end = limit;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n\n[Appshot text truncated]", &value[..end])
}

fn unix_millis_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "appshots_tests.rs"]
mod tests;
