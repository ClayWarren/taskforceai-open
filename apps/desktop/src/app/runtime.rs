use std::sync::{Arc, RwLock};

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

const MENU_CHECK_FOR_UPDATES: &str = "check_for_updates";
const MENU_SETTINGS: &str = "settings";
const MENU_SHOW_MAIN_WINDOW: &str = "show_main_window";

pub fn run() {
    let _telemetry = observability::init();

    if let Err(err) = build_and_run() {
        error!(
            target: "bootstrap",
            error = %err,
            "Desktop runtime failed to start"
        );
    }
}

#[tracing::instrument]
fn build_and_run() -> Result<(), InitError> {
    let start = std::time::Instant::now();
    let start_clone = start;
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            crate::commands::app_server_pet_get,
            crate::commands::app_server_pet_set,
            crate::commands::app_server_agent_session_list,
            crate::commands::app_server_thread_list,
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
            crate::commands::app_server_auth_status,
            crate::commands::app_server_history_list,
            crate::commands::app_server_command_execute,
            crate::commands::app_server_submit_run,
            crate::commands::app_server_enable_local_coding,
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
            crate::commands::app_server_model_list,
            crate::commands::app_server_model_select,
            crate::commands::app_server_model_reset,
            crate::commands::app_server_skill_list,
            crate::commands::app_server_plugin_list,
            crate::commands::app_server_plugin_set_enabled,
            crate::commands::app_server_computer_use_status,
            crate::commands::app_server_browser_status,
            crate::commands::app_server_context_summary,
            crate::commands::app_server_memory_summary,
            crate::commands::app_server_ollama_status,
            crate::commands::app_server_ollama_ensure,
            crate::commands::mcp_discover,
            crate::commands::mcp_call_tool,
            crate::commands::mcp_close,
            crate::commands::mcp_close_all,
            crate::commands::frontend_ready,
            crate::commands::workspace_file_tree,
            crate::commands::workspace_file_read,
            crate::commands::open_external_url,
            crate::commands::show_terminal,
            crate::commands::terminal_execute,
            crate::commands::desktop_update_check,
            crate::commands::desktop_update_install,
            crate::commands::locked_computer_use_status,
            crate::commands::install_locked_computer_use,
            crate::commands::set_locked_computer_use_enabled,
            crate::commands::screen_memory_status,
            crate::commands::set_screen_memory_enabled,
            crate::commands::set_screen_memory_paused,
            crate::commands::screen_memory_capture_now,
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

    Menu::with_items(handle, &[&app_menu, &file_menu, &edit_menu, &window_menu])
}

fn handle_menu_event(app: &tauri::AppHandle, id: &str) {
    match id {
        MENU_SETTINGS => {
            show_main_window(app);
            if let Err(error) = app.emit("desktop-menu:settings", ()) {
                warn!(
                    target: "desktop_ui",
                    error = ?error,
                    "Failed to emit settings menu event"
                );
            }
        }
        MENU_CHECK_FOR_UPDATES => {
            show_main_window(app);
            if let Err(error) = app.emit("desktop-menu:check-for-updates", ()) {
                warn!(
                    target: "desktop_ui",
                    error = ?error,
                    "Failed to emit update menu event"
                );
            }
        }
        MENU_SHOW_MAIN_WINDOW => show_main_window(app),
        _ => {}
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
    app.manage(AppState {
        app_server: Arc::new(DesktopAppServer::new(api_base_url.clone())),
        mcp: Arc::new(DesktopMcpManager::new()),
        local_coding_workspace: Arc::new(RwLock::new(None)),
    });

    info!(target: "api", base_url = %api_base_url, "API client configured");

    crate::screen_memory::start_screen_memory_background(app.handle().clone());

    let server_url = config::resolve_dev_server_url(config::resolve_prod_port);
    bootstrap::start_bootstrap(handle, bootstrap_state, server_url);
    Ok(())
}

#[derive(Debug, Error)]
pub(crate) enum InitError {
    #[error("tauri runtime failed: {0}")]
    Runtime(#[from] tauri::Error),
}
