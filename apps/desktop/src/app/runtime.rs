use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{webview::PageLoadEvent, Emitter, Manager};
use thiserror::Error;

use tracing::{error, info, warn};

use crate::{
    app::{bootstrap, config},
    app_server::DesktopAppServer,
    mcp::DesktopMcpManager,
    observability,
    state::{AppState, BootstrapState},
};
use taskforceai_app_client::default_managed_app_server_root;

const MENU_CHECK_FOR_UPDATES: &str = "check_for_updates";
const MENU_BROWSER_BACK: &str = "browser_back";
const MENU_BROWSER_FORWARD: &str = "browser_forward";
const MENU_OPEN_BROWSER_PREVIEW: &str = "open_browser_preview";
const MENU_SETTINGS: &str = "settings";
const MENU_SHOW_MAIN_WINDOW: &str = "show_main_window";
const MENU_ZOOM_IN: &str = "zoom_in";
const MENU_ZOOM_OUT: &str = "zoom_out";
const MENU_ZOOM_RESET: &str = "zoom_reset";
const DEFAULT_ZOOM_SCALE: f64 = 1.0;
const MIN_ZOOM_SCALE: f64 = 0.5;
const MAX_ZOOM_SCALE: f64 = 2.0;
const ZOOM_STEP: f64 = 0.1;
static UI_ZOOM_SCALE_BITS: AtomicU64 = AtomicU64::new(DEFAULT_ZOOM_SCALE.to_bits());

pub fn run() {
    configure_linux_webkit_environment();

    let _telemetry = observability::init();

    if let Err(err) = build_and_run() {
        error!(
            target: "bootstrap",
            error = %err,
            "Desktop runtime failed to start"
        );
    }
}

#[cfg(target_os = "linux")]
fn configure_linux_webkit_environment() {
    const WEBKIT_DISABLE_DMABUF_RENDERER_ENV: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

    if std::env::var_os(WEBKIT_DISABLE_DMABUF_RENDERER_ENV).is_none() {
        std::env::set_var(WEBKIT_DISABLE_DMABUF_RENDERER_ENV, "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn configure_linux_webkit_environment() {}

#[tracing::instrument]
fn build_and_run() -> Result<(), InitError> {
    let start = std::time::Instant::now();
    let start_clone = start;
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .menu(build_app_menu)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_page_load(|webview, payload| {
            if webview.label() != "main" || payload.event() != PageLoadEvent::Finished {
                return;
            }

            let window = webview.window();
            let bootstrap = webview.state::<BootstrapState>().inner().clone();
            let app_server = webview.state::<AppState>().inner().app_server.clone();
            tauri::async_runtime::spawn(async move {
                if bootstrap.has_displayed() {
                    return;
                }

                if crate::commands::display_main_window(&window, &bootstrap, "page_load") {
                    warn!(
                        target: "bootstrap",
                        "Frontend page loaded; main window displayed"
                    );
                }
                tauri::async_runtime::spawn(async move {
                    if let Err(err) = app_server.initialize().await {
                        warn!(
                            target: "app_server",
                            error = %err,
                            "Failed to initialize app-server after page load"
                        );
                    }
                });
            });
        })
        .setup(move |app| {
            let res = setup_app(app).map_err(Box::from);
            metrics::histogram!("app.startup_latency").record(start_clone.elapsed());
            res
        })
        .invoke_handler(tauri::generate_handler![
            crate::commands::app_server_initialize,
            crate::commands::app_server_environment_status,
            crate::commands::app_server_environment_disconnect_remote,
            crate::commands::app_server_environment_use_local,
            crate::commands::app_server_http_pairing_info,
            crate::commands::app_server_ssh_connect,
            crate::commands::app_server_ssh_probe,
            crate::commands::app_server_status_summary,
            crate::commands::app_server_api_request,
            crate::commands::app_server_project_create,
            crate::commands::app_server_project_workspace_set,
            crate::commands::app_server_pet_get,
            crate::commands::app_server_pet_set,
            crate::commands::app_server_agent_session_list,
            crate::commands::app_server_thread_list,
            crate::commands::app_server_thread_handoff,
            crate::commands::app_server_agent_session_create,
            crate::commands::app_server_agent_session_pause,
            crate::commands::app_server_agent_session_resume,
            crate::commands::app_server_agent_session_cancel,
            crate::commands::app_server_agent_session_message,
            crate::commands::app_server_agent_session_fork,
            crate::commands::app_server_agent_session_run,
            crate::commands::app_server_thread_start,
            crate::commands::app_server_thread_resume,
            crate::commands::app_server_thread_archive,
            crate::commands::app_server_thread_fork,
            crate::commands::app_server_turn_start,
            crate::commands::app_server_turn_steer,
            crate::commands::app_server_turn_interrupt,
            crate::commands::app_server_diagnostics_inspect,
            crate::commands::app_server_channel_list,
            crate::commands::app_server_channel_add,
            crate::commands::app_server_channel_delete,
            crate::commands::app_server_channel_push,
            crate::commands::app_server_schedule_list,
            crate::commands::app_server_schedule_add,
            crate::commands::app_server_schedule_delete,
            crate::commands::app_server_schedule_enable,
            crate::commands::app_server_schedule_disable,
            crate::commands::app_server_schedule_tick,
            crate::commands::app_server_git_review_status,
            crate::commands::app_server_git_review_diff,
            crate::commands::app_server_git_review_stage,
            crate::commands::app_server_git_review_comment_list,
            crate::commands::app_server_git_review_comment_add,
            crate::commands::app_server_git_review_comment_resolve,
            crate::commands::app_server_git_review_pull_request_action,
            crate::commands::app_server_auth_status,
            crate::commands::app_server_history_list,
            crate::commands::app_server_command_execute,
            crate::commands::app_server_submit_run,
            crate::commands::app_server_enable_local_coding,
            crate::commands::app_server_disable_local_coding,
            crate::commands::app_server_run_status,
            crate::commands::app_server_cancel_run,
            crate::commands::app_server_auth_device_start,
            crate::commands::app_server_auth_device_poll,
            crate::commands::app_server_auth_logout,
            crate::commands::app_server_pending_change_list,
            crate::commands::app_server_pending_change_add,
            crate::commands::app_server_pending_change_update_data,
            crate::commands::app_server_pending_change_delete,
            crate::commands::app_server_pending_change_clear,
            crate::commands::app_server_conversation_list,
            crate::commands::app_server_conversation_get,
            crate::commands::app_server_conversation_upsert,
            crate::commands::app_server_conversation_delete,
            crate::commands::app_server_conversation_delete_all,
            crate::commands::app_server_conversation_replace_id,
            crate::commands::app_server_message_list,
            crate::commands::app_server_message_get,
            crate::commands::app_server_message_upsert,
            crate::commands::app_server_message_delete,
            crate::commands::app_server_sync_status,
            crate::commands::app_server_sync_configure,
            crate::commands::app_server_sync_ensure_device,
            crate::commands::app_server_metadata_clear_all,
            crate::commands::app_server_desktop_sync_pull,
            crate::commands::app_server_desktop_sync_push,
            crate::commands::app_server_quick_mode_get,
            crate::commands::app_server_quick_mode_set,
            crate::commands::app_server_autonomous_mode_get,
            crate::commands::app_server_autonomous_mode_set,
            crate::commands::app_server_computer_use_mode_get,
            crate::commands::app_server_computer_use_mode_set,
            crate::commands::app_server_hybrid_mode_get,
            crate::commands::app_server_hybrid_mode_set,
            crate::commands::app_server_local_settings_get,
            crate::commands::app_server_local_settings_update,
            crate::commands::app_server_remote_settings_get,
            crate::commands::app_server_remote_settings_update,
            crate::commands::app_server_remote_pairing_code_create,
            crate::commands::app_server_remote_controller_list,
            crate::commands::app_server_remote_controller_revoke,
            crate::commands::app_server_model_list,
            crate::commands::app_server_model_select,
            crate::commands::app_server_model_reset,
            crate::commands::app_server_skill_list,
            crate::commands::app_server_plugin_list,
            crate::commands::app_server_plugin_set_enabled,
            crate::commands::app_server_attachment_list,
            crate::commands::app_server_attachment_add,
            crate::commands::app_server_attachment_clear,
            crate::commands::app_server_computer_use_status,
            crate::commands::app_server_browser_status,
            crate::commands::app_server_context_summary,
            crate::commands::app_server_memory_summary,
            crate::commands::app_server_ollama_status,
            crate::commands::app_server_ollama_ensure,
            crate::commands::app_server_voice_transcribe,
            crate::commands::app_server_voice_speech_generate,
            crate::commands::app_server_voice_realtime_setup,
            crate::commands::mcp_discover,
            crate::commands::mcp_call_tool,
            crate::commands::mcp_close,
            crate::commands::mcp_close_all,
            crate::commands::frontend_ready,
            crate::commands::desktop_browser_open,
            crate::commands::desktop_browser_show,
            crate::commands::desktop_browser_mount,
            crate::commands::desktop_browser_status,
            crate::commands::desktop_browser_reload,
            crate::commands::desktop_browser_back,
            crate::commands::desktop_browser_forward,
            crate::commands::desktop_browser_close,
            crate::commands::desktop_browser_action,
            crate::commands::desktop_browser_inspect,
            crate::commands::desktop_browser_annotations_set,
            crate::commands::desktop_browser_screenshot,
            crate::commands::desktop_browser_devtools_open,
            crate::commands::desktop_browser_devtools_close,
            crate::commands::desktop_browser_devtools_status,
            crate::commands::desktop_browser_diagnostics,
            crate::commands::desktop_browser_diagnostics_clear,
            crate::commands::desktop_browser_developer_command,
            crate::commands::workspace_file_tree,
            crate::commands::workspace_file_read,
            crate::commands::workspace_file_write,
            crate::commands::desktop_workspace_open_in,
            crate::commands::desktop_worktree_list,
            crate::commands::desktop_worktree_create,
            crate::commands::desktop_worktree_reset,
            crate::commands::desktop_worktree_remove,
            crate::commands::desktop_workspace_checkpoint_capture,
            crate::commands::desktop_workspace_checkpoint_restore,
            crate::commands::open_external_url,
            crate::commands::show_terminal,
            crate::commands::terminal_execute,
            crate::commands::terminal_launch_config,
            crate::commands::app_server_process_list,
            crate::commands::app_server_process_start,
            crate::commands::app_server_process_read,
            crate::commands::app_server_process_write,
            crate::commands::app_server_process_resize,
            crate::commands::app_server_process_kill,
            crate::commands::local_environment_status,
            crate::commands::local_environment_save,
            crate::commands::local_environment_run_setup,
            crate::commands::local_environment_run_action,
            crate::commands::desktop_update_check,
            crate::commands::desktop_update_install,
            crate::commands::locked_computer_use_status,
            crate::commands::install_locked_computer_use,
            crate::commands::set_locked_computer_use_enabled,
            crate::commands::screen_memory_status,
            crate::commands::set_screen_memory_enabled,
            crate::commands::set_screen_memory_paused,
            crate::commands::screen_memory_capture_now,
            crate::commands::desktop_computer_use_observe,
            crate::commands::record_replay_skill_create,
            crate::commands::appshot_capture_frontmost,
            crate::commands::log_event,
            crate::voice::voice_init,
            crate::voice::voice_listen,
            crate::voice::voice_speak,
            crate::voice::voice_cancel,
        ])
        .run(tauri::generate_context!())
        .map_err(InitError::Runtime)?;
    Ok(())
}

fn build_app_menu(handle: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let settings = MenuItem::with_id(
        handle,
        MENU_SETTINGS,
        "Settings...",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let check_for_updates = MenuItem::with_id(
        handle,
        MENU_CHECK_FOR_UPDATES,
        "Check for Updates...",
        true,
        None::<&str>,
    )?;
    let show_main_window = MenuItem::with_id(
        handle,
        MENU_SHOW_MAIN_WINDOW,
        "Show TaskForceAI",
        true,
        None::<&str>,
    )?;
    let open_browser_preview = MenuItem::with_id(
        handle,
        MENU_OPEN_BROWSER_PREVIEW,
        "Open Browser Preview",
        true,
        Some("CmdOrCtrl+Shift+B"),
    )?;
    let browser_back = MenuItem::with_id(
        handle,
        MENU_BROWSER_BACK,
        "Browser Back",
        true,
        None::<&str>,
    )?;
    let browser_forward = MenuItem::with_id(
        handle,
        MENU_BROWSER_FORWARD,
        "Browser Forward",
        true,
        None::<&str>,
    )?;
    let zoom_reset = MenuItem::with_id(
        handle,
        MENU_ZOOM_RESET,
        "Actual Size",
        true,
        Some("CmdOrCtrl+0"),
    )?;
    let zoom_in = MenuItem::with_id(handle, MENU_ZOOM_IN, "Zoom In", true, Some("CmdOrCtrl+="))?;
    let zoom_out = MenuItem::with_id(handle, MENU_ZOOM_OUT, "Zoom Out", true, Some("CmdOrCtrl+-"))?;

    #[cfg(target_os = "macos")]
    let app_menu = Submenu::with_items(
        handle,
        "TaskForceAI",
        true,
        &[
            &PredefinedMenuItem::about(handle, Some("About TaskForceAI"), None)?,
            &check_for_updates,
            &PredefinedMenuItem::separator(handle)?,
            &settings,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::show_all(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let app_menu = Submenu::with_items(
        handle,
        "TaskForceAI",
        true,
        &[
            &settings,
            &check_for_updates,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &show_main_window,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &open_browser_preview,
            &PredefinedMenuItem::separator(handle)?,
            &browser_back,
            &browser_forward,
            &PredefinedMenuItem::separator(handle)?,
            &zoom_reset,
            &zoom_in,
            &zoom_out,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::fullscreen(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::bring_all_to_front(handle, None)?,
        ],
    )?;

    Menu::with_items(
        handle,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
    )
}

fn handle_menu_event(app: &tauri::AppHandle, id: &str) {
    match id {
        MENU_SETTINGS => emit_main_window_menu_event(app, "desktop-menu:settings"),
        MENU_CHECK_FOR_UPDATES => {
            emit_main_window_menu_event(app, "desktop-menu:check-for-updates");
        }
        MENU_OPEN_BROWSER_PREVIEW => {
            emit_main_window_menu_event(app, "desktop-menu:browser-preview");
        }
        MENU_BROWSER_BACK => {
            if let Err(error) = crate::commands::browser_preview_back(app) {
                warn!(
                    target: "desktop_ui",
                    error,
                    "Failed to go back in browser preview from menu"
                );
            }
        }
        MENU_BROWSER_FORWARD => {
            if let Err(error) = crate::commands::browser_preview_forward(app) {
                warn!(
                    target: "desktop_ui",
                    error,
                    "Failed to go forward in browser preview from menu"
                );
            }
        }
        MENU_ZOOM_RESET => set_main_window_zoom(app, DEFAULT_ZOOM_SCALE),
        MENU_ZOOM_IN => adjust_main_window_zoom(app, ZOOM_STEP),
        MENU_ZOOM_OUT => adjust_main_window_zoom(app, -ZOOM_STEP),
        MENU_SHOW_MAIN_WINDOW => show_main_window(app),
        _ => {}
    }
}

fn clamped_zoom_scale(scale: f64) -> f64 {
    scale.clamp(MIN_ZOOM_SCALE, MAX_ZOOM_SCALE)
}

fn adjust_main_window_zoom(app: &tauri::AppHandle, delta: f64) {
    let current = f64::from_bits(UI_ZOOM_SCALE_BITS.load(Ordering::Relaxed));
    set_main_window_zoom(app, clamped_zoom_scale(current + delta));
}

fn set_main_window_zoom(app: &tauri::AppHandle, scale: f64) {
    let scale = clamped_zoom_scale(scale);
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match window.set_zoom(scale) {
        Ok(()) => UI_ZOOM_SCALE_BITS.store(scale.to_bits(), Ordering::Relaxed),
        Err(error) => warn!(
            target: "desktop_ui",
            error = ?error,
            scale,
            "Failed to update desktop UI zoom"
        ),
    }
}

#[cfg(test)]
mod zoom_tests {
    use super::{clamped_zoom_scale, DEFAULT_ZOOM_SCALE, MAX_ZOOM_SCALE, MIN_ZOOM_SCALE};

    #[test]
    fn zoom_scale_is_clamped_to_supported_range() {
        assert_eq!(clamped_zoom_scale(0.1), MIN_ZOOM_SCALE);
        assert_eq!(clamped_zoom_scale(3.0), MAX_ZOOM_SCALE);
        assert_eq!(clamped_zoom_scale(DEFAULT_ZOOM_SCALE), DEFAULT_ZOOM_SCALE);
    }
}

fn emit_main_window_menu_event(app: &tauri::AppHandle, event: &'static str) {
    show_main_window(app);
    if let Err(error) = app.emit(event, ()) {
        warn!(
            target: "desktop_ui",
            error = ?error,
            event,
            "Failed to emit desktop menu event"
        );
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window.show() {
            warn!(
                target: "desktop_ui",
                error = ?error,
                "Failed to show main window from menu"
            );
        }
        let _ = window.set_focus();
    }
}

#[tracing::instrument(skip(app), err)]
fn setup_app(app: &mut tauri::App) -> Result<(), InitError> {
    info!(target: "bootstrap", "Tauri setup closure called");
    let handle = app.handle().clone();
    let bootstrap_state = BootstrapState::new();
    app.manage(bootstrap_state.clone());

    let api_base_url = config::resolve_api_base_url();
    let session_workspaces_path = app
        .path()
        .app_config_dir()
        .ok()
        .map(|directory| directory.join("local-coding-session-workspaces.json"));
    let app_server = default_managed_app_server_root()
        .or_else(|| {
            app.path()
                .app_data_dir()
                .ok()
                .map(|path| path.join("app-server"))
        })
        .map(|runtime_directory| {
            Arc::new(DesktopAppServer::with_managed_runtime(
                api_base_url.clone(),
                runtime_directory,
            ))
        })
        .unwrap_or_else(|| Arc::new(DesktopAppServer::new(api_base_url.clone())));
    app.manage(AppState::new(
        app_server.clone(),
        Arc::new(DesktopMcpManager::new()),
        session_workspaces_path,
    ));

    start_app_server_update_background(app_server);

    info!(target: "api", base_url = %api_base_url, "API client configured");

    crate::screen_memory::start_screen_memory_background(app.handle().clone());

    let server_url = config::resolve_dev_server_url(config::resolve_prod_port);
    bootstrap::start_bootstrap(handle, bootstrap_state, server_url);
    Ok(())
}

fn start_app_server_update_background(app_server: Arc<DesktopAppServer>) {
    tauri::async_runtime::spawn(async move {
        loop {
            match app_server.refresh_managed_runtime().await {
                Ok(true) => info!(
                    target: "app_server_update",
                    "Managed app-server updated; local runtime will restart on demand"
                ),
                Ok(false) => {}
                Err(error) => warn!(
                    target: "app_server_update",
                    error = %error,
                    "Managed app-server update check failed"
                ),
            }
            tokio::time::sleep(std::time::Duration::from_secs(60 * 60)).await;
        }
    });
}

#[derive(Debug, Error)]
pub(crate) enum InitError {
    #[error("tauri runtime failed: {0}")]
    Runtime(#[from] tauri::Error),
}
