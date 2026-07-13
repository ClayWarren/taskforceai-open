use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use tracing::{error, info};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateStatus {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[tauri::command]
pub async fn desktop_update_check(app: AppHandle) -> Result<DesktopUpdateStatus, String> {
    let current_version = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(|err| format!("Failed to initialize updater: {err}"))?
        .check()
        .await
        .map_err(|err| format!("Failed to check for updates: {err}"))?;

    Ok(match update {
        Some(update) => DesktopUpdateStatus {
            available: true,
            current_version,
            version: Some(update.version),
            notes: update.body,
            date: update.date.map(|date| date.to_string()),
        },
        None => DesktopUpdateStatus {
            available: false,
            current_version,
            version: None,
            notes: None,
            date: None,
        },
    })
}

#[tauri::command]
pub async fn desktop_update_install(app: AppHandle) -> Result<DesktopUpdateStatus, String> {
    let status = desktop_update_check(app.clone()).await?;
    if !status.available {
        return Ok(status);
    }

    let update = app
        .updater()
        .map_err(|err| format!("Failed to initialize updater: {err}"))?
        .check()
        .await
        .map_err(|err| format!("Failed to fetch update metadata: {err}"))?
        .ok_or_else(|| "Update disappeared before installation.".to_string())?;

    let version = update.version.clone();
    info!(target: "updater", version = %version, "Installing desktop update");
    update
        .download_and_install(
            |_chunk_length, _content_length| {},
            || {
                info!(target: "updater", "Desktop update download finished");
            },
        )
        .await
        .map_err(|err| {
            error!(target: "updater", error = %err, "Desktop update installation failed");
            format!("Failed to install update: {err}")
        })?;

    app.restart();
}
