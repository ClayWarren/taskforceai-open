use tauri::Manager;
use tracing::info;

use super::privileged_origin_allowed;

const MAIN_WINDOW_LABEL: &str = "main";

fn open_external_url_impl(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|error| format!("Invalid URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http and https URLs can be opened externally".to_string());
    }

    let mut command = external_url_command(parsed.as_str());
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open external URL: {error}"))
}

fn external_url_command(url: &str) -> std::process::Command {
    #[cfg(target_os = "macos")]
    {
        let mut command = std::process::Command::new("open");
        command.arg(url);
        command
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler").arg(url);
        command
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut command = std::process::Command::new("xdg-open");
        command.arg(url);
        command
    }
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    open_external_url_impl(&url)?;
    info!(target: "desktop_ui", url = %url, "External URL open requested");
    Ok(())
}

#[tauri::command]
pub async fn locked_computer_use_status(
    app: tauri::AppHandle,
) -> Result<crate::locked_computer_use::LockedComputerUseStatus, String> {
    Ok(locked_computer_use_manager(&app).status())
}

#[tauri::command]
pub async fn install_locked_computer_use(
    app: tauri::AppHandle,
) -> Result<crate::locked_computer_use::LockedComputerUseStatus, String> {
    locked_computer_use_manager(&app).install()
}

#[tauri::command]
pub async fn set_locked_computer_use_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<crate::locked_computer_use::LockedComputerUseStatus, String> {
    let status = locked_computer_use_manager(&app).set_enabled(enabled)?;
    info!(
        target: "desktop_ui",
        enabled,
        "Locked computer use setting requested"
    );
    Ok(status)
}

fn locked_computer_use_manager(
    app: &tauri::AppHandle,
) -> crate::locked_computer_use::LockedComputerUseManager {
    crate::locked_computer_use::LockedComputerUseManager::with_resource_dir(
        app.path().resource_dir().ok(),
    )
}

#[tauri::command]
pub async fn screen_memory_status(
    app: tauri::AppHandle,
) -> Result<crate::screen_memory::ScreenMemoryStatus, String> {
    Ok(crate::screen_memory::ScreenMemoryManager::with_app_handle(&app).status())
}

#[tauri::command]
pub async fn set_screen_memory_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<crate::screen_memory::ScreenMemoryStatus, String> {
    let status =
        crate::screen_memory::ScreenMemoryManager::with_app_handle(&app).set_enabled(enabled)?;
    info!(
        target: "desktop_ui",
        enabled,
        "Screen Memory enabled setting changed"
    );
    Ok(status)
}

#[tauri::command]
pub async fn set_screen_memory_paused(
    app: tauri::AppHandle,
    paused: bool,
) -> Result<crate::screen_memory::ScreenMemoryStatus, String> {
    let status =
        crate::screen_memory::ScreenMemoryManager::with_app_handle(&app).set_paused(paused)?;
    info!(
        target: "desktop_ui",
        paused,
        "Screen Memory pause setting changed"
    );
    Ok(status)
}

#[tauri::command]
pub async fn screen_memory_capture_now(
    app: tauri::AppHandle,
) -> Result<crate::screen_memory::ScreenMemoryStatus, String> {
    crate::screen_memory::ScreenMemoryManager::with_app_handle(&app)
        .capture_now()
        .await
}

#[tauri::command]
pub async fn desktop_computer_use_observe(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<crate::screen_memory::ScreenCaptureResult, String> {
    authorize_desktop_computer_use_observe(&window)?;
    crate::screen_memory::ScreenMemoryManager::with_app_handle(&app)
        .capture_current_screen()
        .await
}

fn authorize_desktop_computer_use_observe(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != MAIN_WINDOW_LABEL {
        return Err(
            "Desktop computer use observation is only available from the main window.".to_string(),
        );
    }
    let url = window
        .url()
        .map_err(|error| format!("Failed to resolve desktop webview URL: {error}"))?;
    if privileged_origin_allowed(&url) {
        Ok(())
    } else {
        Err(
            "Desktop computer use observation is only available to local desktop origins."
                .to_string(),
        )
    }
}

#[tauri::command]
pub async fn appshot_capture_frontmost(
    app: tauri::AppHandle,
) -> Result<crate::appshots::AppshotCaptureResult, String> {
    crate::appshots::AppshotManager::with_app_handle(&app)?
        .capture_frontmost()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_web_external_urls() {
        assert!(open_external_url_impl("file:///tmp/secret").is_err());
    }

    #[test]
    fn external_url_opener_uses_shell_free_command() {
        let command = external_url_command("https://example.com/?x=1&calc");
        let program = command.get_program().to_string_lossy().to_string();
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        #[cfg(target_os = "windows")]
        {
            assert_ne!(program.to_ascii_lowercase(), "cmd");
            assert_eq!(program.to_ascii_lowercase(), "rundll32");
            assert_eq!(
                args,
                vec![
                    "url.dll,FileProtocolHandler".to_string(),
                    "https://example.com/?x=1&calc".to_string()
                ]
            );
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_ne!(program.to_ascii_lowercase(), "cmd");
            assert_eq!(args, vec!["https://example.com/?x=1&calc".to_string()]);
        }
    }

    #[test]
    fn desktop_privileged_origin_allows_packaged_and_local_urls() {
        for url in [
            "tauri://localhost/index.html",
            "asset://localhost/index.html",
            "http://localhost:3210",
            "http://127.0.0.1:3210",
            "http://app.localhost:3210",
        ] {
            let parsed = tauri::Url::parse(url).expect("fixture URL should parse");
            assert!(
                privileged_origin_allowed(&parsed),
                "expected {url} to be trusted"
            );
        }
    }

    #[test]
    fn desktop_privileged_origin_rejects_remote_and_file_urls() {
        for url in [
            "https://taskforceai.chat",
            "https://localhost.evil.example",
            "file:///tmp/index.html",
            "data:text/html,hi",
        ] {
            let parsed = tauri::Url::parse(url).expect("fixture URL should parse");
            assert!(
                !privileged_origin_allowed(&parsed),
                "expected {url} to be rejected"
            );
        }
    }
}
