use super::*;

pub(super) fn show_browser_preview(
    app: &AppHandle,
    window: &Window,
    workspace: PathBuf,
) -> Result<DesktopBrowserStatus, String> {
    if let Some(browser) = app.get_webview(BROWSER_PREVIEW_WEBVIEW_LABEL) {
        let _ = browser.show();
        let _ = browser.set_focus();
        return browser_preview_status(app);
    }

    let bounds = default_browser_preview_bounds(window)?;
    mount_browser_preview(app, window, workspace, bounds)?;
    browser_preview_status(app)
}

pub fn browser_preview_reload(app: &AppHandle) -> Result<(), String> {
    browser_preview_webview(app)?
        .reload()
        .map_err(|error| format!("Failed to reload browser preview: {error}"))
}

pub fn browser_preview_back(app: &AppHandle) -> Result<(), String> {
    browser_preview_eval(app, BROWSER_PREVIEW_BACK_SCRIPT, "go back")
}

pub fn browser_preview_forward(app: &AppHandle) -> Result<(), String> {
    browser_preview_eval(app, BROWSER_PREVIEW_FORWARD_SCRIPT, "go forward")
}

pub fn browser_preview_close(app: &AppHandle) -> Result<(), String> {
    if let Some(browser) = app.get_webview(BROWSER_PREVIEW_WEBVIEW_LABEL) {
        browser
            .close()
            .map_err(|error| format!("Failed to close browser preview: {error}"))?;
    }
    Ok(())
}

pub(super) fn browser_preview_eval(
    app: &AppHandle,
    script: &str,
    action: &str,
) -> Result<(), String> {
    browser_preview_webview(app)?
        .eval(script)
        .map_err(|error| format!("Failed to {action} in browser preview: {error}"))
}

pub(super) async fn browser_preview_eval_json<T>(
    app: &AppHandle,
    script: String,
    timeout: Duration,
    action: &str,
) -> Result<T, String>
where
    T: DeserializeOwned,
{
    let browser = browser_preview_webview(app)?;
    let (sender, receiver) = oneshot::channel::<String>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let callback_sender = Arc::clone(&sender);
    browser
        .eval_with_callback(script, move |value| {
            if let Some(sender) = callback_sender
                .lock()
                .ok()
                .and_then(|mut sender| sender.take())
            {
                let _ = sender.send(value);
            }
        })
        .map_err(|error| format!("Failed to {action}: {error}"))?;

    let value = time::timeout(timeout, receiver)
        .await
        .map_err(|_| format!("Timed out while trying to {action}."))?
        .map_err(|_| format!("Browser preview closed before it could {action}."))?;
    decode_browser_preview_json(&value, MAX_BROWSER_EVAL_RESPONSE_BYTES, action)
}

pub(super) fn decode_browser_preview_json<T>(
    value: &str,
    max_response_bytes: usize,
    action: &str,
) -> Result<T, String>
where
    T: DeserializeOwned,
{
    if value.len() > max_response_bytes {
        return Err(format!("Browser preview result for {action} is too large."));
    }
    serde_json::from_str(value)
        .map_err(|error| format!("Failed to decode browser preview result: {error}"))
}

pub(super) fn browser_preview_current_url(app: &AppHandle) -> Option<String> {
    app.get_webview(BROWSER_PREVIEW_WEBVIEW_LABEL)
        .and_then(|browser| browser.url().ok())
        .map(|url| url.to_string())
}

pub(super) fn browser_preview_webview(app: &AppHandle) -> Result<Webview, String> {
    app.get_webview(BROWSER_PREVIEW_WEBVIEW_LABEL)
        .ok_or_else(|| "Browser preview is not open.".to_string())
}

pub(super) async fn browser_preview_screenshot(
    app: &AppHandle,
) -> Result<DesktopBrowserScreenshotResult, String> {
    let browser = browser_preview_webview(app)?;
    let _ = browser.show();
    let _ = browser.set_focus();
    time::sleep(Duration::from_millis(150)).await;

    let screenshot_dir = std::env::temp_dir().join(BROWSER_PREVIEW_SCREENSHOT_DIR);
    tokio::fs::create_dir_all(&screenshot_dir)
        .await
        .map_err(|error| {
            format!(
                "Failed to create browser screenshot directory {}: {error}",
                screenshot_dir.display()
            )
        })?;
    let path = screenshot_dir.join(format!("browser-preview-{}.png", unix_millis_now()));
    run_browser_webview_screencapture(&browser, &path).await?;
    let bytes = tokio::fs::read(&path).await.map_err(|error| {
        format!(
            "Failed to read browser screenshot {}: {error}",
            path.display()
        )
    })?;
    let image_base64 = BASE64_STANDARD.encode(&bytes);

    Ok(DesktopBrowserScreenshotResult {
        path: path.display().to_string(),
        image_base64,
        media_type: "image/png".to_string(),
        byte_length: bytes.len(),
        current_url: browser.url().ok().map(|url| url.to_string()),
    })
}

#[cfg(target_os = "macos")]
pub(super) async fn run_browser_webview_screencapture(
    browser: &Webview,
    path: &Path,
) -> Result<(), String> {
    let region = browser_preview_capture_region(browser)?;
    let output = Command::new("screencapture")
        .arg("-x")
        .arg("-t")
        .arg("png")
        .arg("-R")
        .arg(region.as_screencapture_argument())
        .arg(path)
        .output()
        .await
        .map_err(|error| format!("Failed to run browser preview screenshot capture: {error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Err(
            "Browser preview screenshot failed. Grant Screen Recording permission to TaskForceAI."
                .to_string(),
        )
    } else {
        Err(format!("Browser preview screenshot failed: {stderr}"))
    }
}

#[cfg(target_os = "macos")]
pub(super) fn browser_preview_capture_region(
    browser: &Webview,
) -> Result<BrowserCaptureRegion, String> {
    let window = browser.window();
    let scale = window
        .scale_factor()
        .map_err(|error| format!("Failed to read browser preview scale factor: {error}"))?;
    let window_origin = window
        .inner_position()
        .map_err(|error| format!("Failed to locate browser preview host window: {error}"))?
        .to_logical::<f64>(scale);
    let webview_origin = browser
        .position()
        .map_err(|error| format!("Failed to locate browser preview webview: {error}"))?
        .to_logical::<f64>(scale);
    let webview_size = browser
        .size()
        .map_err(|error| format!("Failed to measure browser preview webview: {error}"))?
        .to_logical::<f64>(scale);
    BrowserCaptureRegion::new(
        window_origin.x + webview_origin.x,
        window_origin.y + webview_origin.y,
        webview_size.width,
        webview_size.height,
    )
}

#[cfg(not(target_os = "macos"))]
pub(super) async fn run_browser_webview_screencapture(
    _browser: &Webview,
    _path: &Path,
) -> Result<(), String> {
    Err("Browser preview screenshots are only available on macOS.".to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct BrowserCaptureRegion {
    pub(super) x: i32,
    pub(super) y: i32,
    pub(super) width: u32,
    pub(super) height: u32,
}

impl BrowserCaptureRegion {
    pub(super) fn new(x: f64, y: f64, width: f64, height: f64) -> Result<Self, String> {
        if !x.is_finite() || !y.is_finite() || !width.is_finite() || !height.is_finite() {
            return Err("Browser preview capture bounds must be finite.".to_string());
        }
        if width < 1.0 || height < 1.0 {
            return Err("Browser preview capture bounds are empty.".to_string());
        }
        Ok(Self {
            x: x.round() as i32,
            y: y.round() as i32,
            width: width.round().max(1.0) as u32,
            height: height.round().max(1.0) as u32,
        })
    }

    pub(super) fn as_screencapture_argument(self) -> String {
        format!("{},{},{},{}", self.x, self.y, self.width, self.height)
    }
}

pub(super) fn browser_preview_devtools_open(
    app: &AppHandle,
) -> Result<DesktopBrowserDevtoolsStatus, String> {
    let browser = browser_preview_webview(app)?;
    browser_preview_open_devtools_window(&browser);
    browser_preview_devtools_status(app)
}

pub(super) fn browser_preview_devtools_close(
    app: &AppHandle,
) -> Result<DesktopBrowserDevtoolsStatus, String> {
    let browser = browser_preview_webview(app)?;
    browser_preview_close_devtools_window(&browser);
    browser_preview_devtools_status(app)
}

pub(super) fn browser_preview_devtools_status(
    app: &AppHandle,
) -> Result<DesktopBrowserDevtoolsStatus, String> {
    let browser = browser_preview_webview(app)?;
    Ok(DesktopBrowserDevtoolsStatus {
        supported: browser_preview_devtools_supported(),
        open: browser_preview_is_devtools_open(&browser),
        message: browser_preview_devtools_message(),
    })
}

#[cfg(any(debug_assertions, feature = "devtools"))]
pub(super) fn browser_preview_open_devtools_window(browser: &Webview) {
    browser.open_devtools();
}

#[cfg(not(any(debug_assertions, feature = "devtools")))]
pub(super) fn browser_preview_open_devtools_window(_browser: &Webview) {}

#[cfg(any(debug_assertions, feature = "devtools"))]
pub(super) fn browser_preview_close_devtools_window(browser: &Webview) {
    browser.close_devtools();
}

#[cfg(not(any(debug_assertions, feature = "devtools")))]
pub(super) fn browser_preview_close_devtools_window(_browser: &Webview) {}

#[cfg(any(debug_assertions, feature = "devtools"))]
pub(super) fn browser_preview_is_devtools_open(browser: &Webview) -> bool {
    browser.is_devtools_open()
}

#[cfg(not(any(debug_assertions, feature = "devtools")))]
pub(super) fn browser_preview_is_devtools_open(_browser: &Webview) -> bool {
    false
}

pub(super) fn browser_preview_devtools_supported() -> bool {
    cfg!(any(debug_assertions, feature = "devtools"))
}

pub(super) fn browser_preview_devtools_message() -> String {
    if browser_preview_devtools_supported() {
        "Browser preview devtools are available.".to_string()
    } else {
        "Browser preview devtools require a debug build or the desktop devtools feature."
            .to_string()
    }
}

pub(super) fn open_browser_preview(
    app: &AppHandle,
    window: &Window,
    url: Url,
    workspace: PathBuf,
) -> Result<(), String> {
    if let Some(browser) = app.get_webview(BROWSER_PREVIEW_WEBVIEW_LABEL) {
        browser
            .navigate(url)
            .map_err(|error| format!("Failed to navigate browser preview: {error}"))?;
        let _ = browser.show();
        let _ = browser.set_focus();
        return Ok(());
    }

    let bounds = default_browser_preview_bounds(window)?;
    let browser = build_browser_preview(window, WebviewUrl::External(url), workspace, bounds)?;
    let _ = browser.set_focus();
    Ok(())
}

pub(super) fn mount_browser_preview(
    app: &AppHandle,
    window: &Window,
    workspace: PathBuf,
    bounds: DesktopBrowserMountBounds,
) -> Result<(), String> {
    validate_browser_preview_bounds(bounds)?;
    if let Some(browser) = app.get_webview(BROWSER_PREVIEW_WEBVIEW_LABEL) {
        if browser.window().label() != window.label() {
            let _ = browser.close();
        } else {
            set_browser_preview_bounds(&browser, bounds)?;
            let _ = browser.show();
            let _ = browser.set_focus();
            return Ok(());
        }
    }

    let browser = build_browser_preview(
        window,
        WebviewUrl::App(BROWSER_PREVIEW_START_PAGE.into()),
        workspace,
        bounds,
    )?;
    let _ = browser.set_focus();
    Ok(())
}

pub(super) fn build_browser_preview(
    window: &Window,
    url: WebviewUrl,
    workspace: PathBuf,
    bounds: DesktopBrowserMountBounds,
) -> Result<Webview, String> {
    validate_browser_preview_bounds(bounds)?;
    let browser = WebviewBuilder::new(BROWSER_PREVIEW_WEBVIEW_LABEL, url)
        .devtools(browser_preview_devtools_supported())
        .focused(false)
        .initialization_script(BROWSER_PREVIEW_INIT_SCRIPT)
        .on_navigation(move |target_url| {
            let allowed = browser_preview_navigation_allowed(target_url, &workspace);
            if let Err(error) = &allowed {
                warn!(
                    target: "desktop_browser",
                    url = %target_url,
                    error,
                    "Blocked browser preview navigation"
                );
            }
            allowed.is_ok()
        });
    let browser = window
        .add_child(
            browser,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|error| format!("Failed to mount browser preview: {error}"))?;
    set_browser_preview_bounds(&browser, bounds)?;
    Ok(browser)
}

pub(super) fn default_browser_preview_bounds(
    window: &Window,
) -> Result<DesktopBrowserMountBounds, String> {
    let size = window
        .inner_size()
        .map_err(|error| format!("Failed to measure main window for browser preview: {error}"))?;
    let scale = window
        .scale_factor()
        .map_err(|error| format!("Failed to read main window scale factor: {error}"))?;
    let logical = size.to_logical::<f64>(scale);
    let preferred_width = (logical.width * 0.42).clamp(420.0, 760.0);
    let width = preferred_width.min(logical.width.max(1.0));
    Ok(DesktopBrowserMountBounds {
        x: (logical.width - width).max(0.0),
        y: 0.0,
        width,
        height: logical.height.max(1.0),
    })
}

pub(super) fn validate_browser_preview_bounds(
    bounds: DesktopBrowserMountBounds,
) -> Result<(), String> {
    if !bounds.x.is_finite()
        || !bounds.y.is_finite()
        || !bounds.width.is_finite()
        || !bounds.height.is_finite()
    {
        return Err("Browser preview bounds must be finite numbers.".to_string());
    }
    if bounds.width < 120.0 || bounds.height < 160.0 {
        return Err("Browser preview bounds are too small.".to_string());
    }
    Ok(())
}

pub(super) fn set_browser_preview_bounds(
    browser: &Webview,
    bounds: DesktopBrowserMountBounds,
) -> Result<(), String> {
    browser
        .set_bounds(Rect {
            position: LogicalPosition::new(bounds.x, bounds.y).into(),
            size: LogicalSize::new(bounds.width, bounds.height).into(),
        })
        .map_err(|error| format!("Failed to position browser preview: {error}"))
}

pub(super) fn browser_preview_status(app: &AppHandle) -> Result<DesktopBrowserStatus, String> {
    let Some(browser) = app.get_webview(BROWSER_PREVIEW_WEBVIEW_LABEL) else {
        return Ok(DesktopBrowserStatus {
            open: false,
            current_url: None,
            message: "Browser preview is closed.".to_string(),
        });
    };
    let current_url = browser.url().ok().map(|url| url.to_string());
    Ok(DesktopBrowserStatus {
        open: true,
        current_url,
        message: "Browser preview is open.".to_string(),
    })
}

pub(super) fn ensure_main_window(window: &Window) -> Result<(), String> {
    if window.label() == BROWSER_PREVIEW_HOST_WINDOW_LABEL {
        return Ok(());
    }
    Err("Desktop browser controls are only available from the main window.".to_string())
}

pub(super) fn prepare_browser_preview_workspace(
    app: &AppHandle,
    state: &AppState,
    workspace: &Path,
) -> Result<(), String> {
    if state.browser_preview_workspace().as_deref() == Some(workspace) {
        return Ok(());
    }
    browser_preview_close(app)?;
    state.set_browser_preview_workspace(Some(workspace.to_path_buf()));
    Ok(())
}

pub(crate) fn reset_browser_preview_workspace(
    app: &AppHandle,
    state: &AppState,
    workspace: &Path,
) -> Result<(), String> {
    prepare_browser_preview_workspace(app, state, workspace)
}

pub(super) fn workspace_root(state: &AppState) -> Result<PathBuf, String> {
    let root = state
        .local_coding_workspace()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    root.canonicalize().map_err(|error| {
        format!(
            "Failed to resolve workspace root {}: {error}",
            root.display()
        )
    })
}

pub(super) fn normalize_browser_preview_url(
    input: &str,
    workspace_root: &Path,
) -> Result<Url, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Browser URL is required.".to_string());
    }

    let url = if looks_like_localhost(trimmed) {
        Url::parse(&format!("http://{trimmed}"))
            .map_err(|error| format!("Invalid browser URL: {error}"))?
    } else if has_explicit_url_scheme(trimmed) {
        Url::parse(trimmed).map_err(|error| format!("Invalid browser URL: {error}"))?
    } else if looks_like_file_path(trimmed) {
        let path = resolve_preview_file_path(trimmed, workspace_root);
        Url::from_file_path(path)
            .map_err(|_| "Failed to convert browser preview file path to URL.".to_string())?
    } else {
        Url::parse(&format!("https://{trimmed}"))
            .map_err(|error| format!("Invalid browser URL: {error}"))?
    };

    browser_preview_url_allowed(&url, workspace_root)?;
    Ok(url)
}

pub(super) fn has_explicit_url_scheme(input: &str) -> bool {
    if input.contains("://") {
        return true;
    }
    let Some(index) = input.find(':') else {
        return false;
    };
    matches!(
        input[..index].to_ascii_lowercase().as_str(),
        "about" | "asset" | "data" | "file" | "ftp" | "javascript" | "mailto" | "tauri"
    )
}

pub(super) fn looks_like_localhost(input: &str) -> bool {
    input == "localhost"
        || input.starts_with("localhost:")
        || input.starts_with("127.0.0.1")
        || input.starts_with("[::1]")
}

pub(super) fn looks_like_file_path(input: &str) -> bool {
    input.starts_with('/')
        || input.starts_with("./")
        || input.starts_with("../")
        || input.ends_with(".html")
        || input.ends_with(".htm")
}

pub(super) fn resolve_preview_file_path(input: &str, workspace_root: &Path) -> PathBuf {
    let path = PathBuf::from(input);
    if path.is_absolute() {
        path
    } else {
        workspace_root.join(path)
    }
}

pub(super) fn unix_millis_now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub(super) fn browser_preview_url_allowed(url: &Url, workspace_root: &Path) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" => {
            if url.host_str().is_none() {
                return Err("Browser URL must include a host.".to_string());
            }
            if !url.username().is_empty() || url.password().is_some() {
                return Err("Browser URL credentials are not allowed.".to_string());
            }
            Ok(())
        }
        "file" => {
            let path = url
                .to_file_path()
                .map_err(|_| "Browser file URL is invalid.".to_string())?;
            let canonical = path
                .canonicalize()
                .map_err(|error| format!("Failed to resolve browser preview file: {error}"))?;
            if !canonical.starts_with(workspace_root) {
                return Err("Browser file previews must stay inside the workspace.".to_string());
            }
            if !canonical.is_file() {
                return Err("Browser file preview must point to a file.".to_string());
            }
            Ok(())
        }
        _ => Err("Browser preview only supports http, https, and workspace file URLs.".to_string()),
    }
}

pub(super) fn browser_preview_navigation_allowed(
    url: &Url,
    workspace_root: &Path,
) -> Result<(), String> {
    if browser_preview_is_start_page_url(url) {
        return Ok(());
    }
    browser_preview_url_allowed(url, workspace_root)
}

pub(super) fn browser_preview_is_start_page_url(url: &Url) -> bool {
    if url.path().trim_start_matches('/') != BROWSER_PREVIEW_START_PAGE {
        return false;
    }
    match url.scheme() {
        "tauri" | "asset" => matches!(url.host_str(), Some("localhost" | "tauri.localhost")),
        "http" | "https" => url
            .host_str()
            .is_some_and(|host| matches!(host, "localhost" | "127.0.0.1" | "::1")),
        _ => false,
    }
}
