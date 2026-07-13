use super::*;

#[tauri::command]
pub async fn desktop_browser_open(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, AppState>,
    params: DesktopBrowserOpenParams,
) -> Result<DesktopBrowserStatus, String> {
    ensure_main_window(&window)?;
    let workspace = workspace_root(&state)?;
    prepare_browser_preview_workspace(&app, &state, &workspace)?;
    let target_url = normalize_browser_preview_url(&params.url, &workspace)?;
    open_browser_preview(&app, &window, target_url.clone(), workspace)?;
    info!(
        target: "desktop_browser",
        url = %target_url,
        "Desktop browser preview opened"
    );
    browser_preview_status(&app)
}

#[tauri::command]
pub async fn desktop_browser_show(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, AppState>,
) -> Result<DesktopBrowserStatus, String> {
    ensure_main_window(&window)?;
    let workspace = workspace_root(&state)?;
    prepare_browser_preview_workspace(&app, &state, &workspace)?;
    show_browser_preview(&app, &window, workspace)
}

#[tauri::command]
pub async fn desktop_browser_mount(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, AppState>,
    params: DesktopBrowserMountParams,
) -> Result<DesktopBrowserStatus, String> {
    ensure_main_window(&window)?;
    let workspace = workspace_root(&state)?;
    prepare_browser_preview_workspace(&app, &state, &workspace)?;
    mount_browser_preview(&app, &window, workspace, params.bounds)?;
    browser_preview_status(&app)
}

#[tauri::command]
pub async fn desktop_browser_status(
    app: AppHandle,
    window: Window,
) -> Result<DesktopBrowserStatus, String> {
    ensure_main_window(&window)?;
    browser_preview_status(&app)
}

#[tauri::command]
pub async fn desktop_browser_reload(app: AppHandle, window: Window) -> Result<(), String> {
    ensure_main_window(&window)?;
    browser_preview_reload(&app)?;
    info!(target: "desktop_browser", "Desktop browser preview reloaded");
    Ok(())
}

#[tauri::command]
pub async fn desktop_browser_back(app: AppHandle, window: Window) -> Result<(), String> {
    ensure_main_window(&window)?;
    browser_preview_back(&app)?;
    info!(target: "desktop_browser", "Desktop browser preview back requested");
    Ok(())
}

#[tauri::command]
pub async fn desktop_browser_forward(app: AppHandle, window: Window) -> Result<(), String> {
    ensure_main_window(&window)?;
    browser_preview_forward(&app)?;
    info!(target: "desktop_browser", "Desktop browser preview forward requested");
    Ok(())
}

#[tauri::command]
pub async fn desktop_browser_close(
    app: AppHandle,
    window: Window,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    browser_preview_close(&app)?;
    state.set_browser_preview_workspace(None);
    info!(target: "desktop_browser", "Desktop browser preview closed");
    Ok(())
}

#[tauri::command]
pub async fn desktop_browser_action(
    app: AppHandle,
    window: Window,
    params: DesktopBrowserActionParams,
) -> Result<DesktopBrowserActionResult, String> {
    ensure_main_window(&window)?;
    let action = params.action.trim().to_ascii_lowercase();
    if action == "wait" {
        let duration_ms = params.duration_ms.unwrap_or(500).clamp(0, 30_000);
        time::sleep(Duration::from_millis(duration_ms)).await;
        return Ok(DesktopBrowserActionResult {
            action,
            ok: true,
            message: format!("Waited {duration_ms}ms."),
            current_url: browser_preview_current_url(&app),
            selection: None,
            inspection: None,
        });
    }

    let timeout = if action.starts_with("select") {
        BROWSER_PREVIEW_SELECTION_TIMEOUT
    } else {
        BROWSER_PREVIEW_EVAL_TIMEOUT
    };
    let script = browser_action_script(&params)?;
    browser_preview_eval_json(&app, script, timeout, "run browser action").await
}

#[tauri::command]
pub async fn desktop_browser_inspect(
    app: AppHandle,
    window: Window,
    params: DesktopBrowserInspectParams,
) -> Result<DesktopBrowserInspection, String> {
    ensure_main_window(&window)?;
    let script = browser_inspect_script(&params)?;
    browser_preview_eval_json(
        &app,
        script,
        BROWSER_PREVIEW_EVAL_TIMEOUT,
        "inspect browser preview",
    )
    .await
}

#[tauri::command]
pub async fn desktop_browser_annotations_set(
    app: AppHandle,
    window: Window,
    params: DesktopBrowserAnnotationsParams,
) -> Result<DesktopBrowserActionResult, String> {
    ensure_main_window(&window)?;
    let script = browser_annotations_script(&params)?;
    browser_preview_eval_json(
        &app,
        script,
        BROWSER_PREVIEW_EVAL_TIMEOUT,
        "render browser annotations",
    )
    .await
}

#[tauri::command]
pub async fn desktop_browser_screenshot(
    app: AppHandle,
    window: Window,
) -> Result<DesktopBrowserScreenshotResult, String> {
    ensure_main_window(&window)?;
    browser_preview_screenshot(&app).await
}

#[tauri::command]
pub async fn desktop_browser_devtools_open(
    app: AppHandle,
    window: Window,
) -> Result<DesktopBrowserDevtoolsStatus, String> {
    ensure_main_window(&window)?;
    browser_preview_devtools_open(&app)
}

#[tauri::command]
pub async fn desktop_browser_devtools_close(
    app: AppHandle,
    window: Window,
) -> Result<DesktopBrowserDevtoolsStatus, String> {
    ensure_main_window(&window)?;
    browser_preview_devtools_close(&app)
}

#[tauri::command]
pub async fn desktop_browser_devtools_status(
    app: AppHandle,
    window: Window,
) -> Result<DesktopBrowserDevtoolsStatus, String> {
    ensure_main_window(&window)?;
    browser_preview_devtools_status(&app)
}

#[tauri::command]
pub async fn desktop_browser_diagnostics(
    app: AppHandle,
    window: Window,
) -> Result<DesktopBrowserDiagnostics, String> {
    ensure_main_window(&window)?;
    browser_preview_eval_json(
        &app,
        BROWSER_DIAGNOSTICS_SCRIPT.to_string(),
        BROWSER_PREVIEW_EVAL_TIMEOUT,
        "collect browser diagnostics",
    )
    .await
}

#[tauri::command]
pub async fn desktop_browser_diagnostics_clear(
    app: AppHandle,
    window: Window,
) -> Result<DesktopBrowserActionResult, String> {
    ensure_main_window(&window)?;
    browser_preview_eval_json(
        &app,
        BROWSER_DIAGNOSTICS_CLEAR_SCRIPT.to_string(),
        BROWSER_PREVIEW_EVAL_TIMEOUT,
        "clear browser diagnostics",
    )
    .await
}

#[tauri::command]
pub async fn desktop_browser_developer_command(
    app: AppHandle,
    window: Window,
    mut params: DesktopBrowserDeveloperCommandParams,
) -> Result<DesktopBrowserDeveloperCommandResult, String> {
    ensure_main_window(&window)?;
    if params.method == "Browser.startSession" {
        params.session_id = Some(format!("browser-dev-{}", unix_millis_now()));
        params.max_body_bytes = Some(
            params
                .max_body_bytes
                .unwrap_or(8 * 1024)
                .clamp(0, 32 * 1024),
        );
    } else if params
        .session_id
        .as_deref()
        .map(str::trim)
        .is_none_or(str::is_empty)
    {
        return Err("Browser developer session id is required.".to_string());
    }
    let script = browser_developer_command_script(&params)?;
    browser_preview_eval_json(
        &app,
        script,
        BROWSER_PREVIEW_EVAL_TIMEOUT,
        "run browser developer protocol command",
    )
    .await
}
