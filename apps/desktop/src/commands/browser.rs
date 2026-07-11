use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::de::DeserializeOwned;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewBuilder,
    WebviewUrl, Window,
};
use tokio::{process::Command, sync::oneshot, time};
use tracing::{info, warn};

use crate::state::AppState;

mod scripts;

use scripts::{
    browser_action_script, browser_annotations_script, browser_inspect_script,
    BROWSER_DIAGNOSTICS_CLEAR_SCRIPT, BROWSER_DIAGNOSTICS_SCRIPT, BROWSER_PREVIEW_INIT_SCRIPT,
};

const BROWSER_PREVIEW_WEBVIEW_LABEL: &str = "browser-preview";
const BROWSER_PREVIEW_HOST_WINDOW_LABEL: &str = "main";
const BROWSER_PREVIEW_START_PAGE: &str = "desktop-browser-start.html";
const BROWSER_PREVIEW_BACK_SCRIPT: &str = "window.history.back();";
const BROWSER_PREVIEW_FORWARD_SCRIPT: &str = "window.history.forward();";
const BROWSER_PREVIEW_EVAL_TIMEOUT: Duration = Duration::from_secs(5);
const BROWSER_PREVIEW_SELECTION_TIMEOUT: Duration = Duration::from_secs(60);
const BROWSER_PREVIEW_SCREENSHOT_DIR: &str = "taskforceai-browser-preview";
const MAX_BROWSER_EVAL_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_BROWSER_INSPECT_TEXT_BYTES: usize = 32 * 1024;
const MAX_BROWSER_INSPECT_ELEMENTS: usize = 60;
mod commands;
mod runtime;
mod types;

pub use commands::*;
pub(crate) use runtime::reset_browser_preview_workspace;
use runtime::*;
pub use runtime::{
    browser_preview_back, browser_preview_close, browser_preview_forward, browser_preview_reload,
};
pub use types::*;

#[cfg(test)]
mod tests;
