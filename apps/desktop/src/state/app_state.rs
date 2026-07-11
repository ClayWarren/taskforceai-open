use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
};

use crate::{app_server::DesktopAppServer, mcp::DesktopMcpManager};

#[derive(Clone)]
pub struct AppState {
    pub app_server: Arc<DesktopAppServer>,
    pub mcp: Arc<DesktopMcpManager>,
    pub local_coding_workspace: Arc<RwLock<Option<PathBuf>>>,
    pub local_coding_session_workspaces: Arc<RwLock<BTreeMap<String, PathBuf>>>,
    pub local_coding_session_workspaces_path: Option<PathBuf>,
    pub browser_preview_workspace: Arc<RwLock<Option<PathBuf>>>,
}

impl AppState {
    pub fn new(
        app_server: Arc<DesktopAppServer>,
        mcp: Arc<DesktopMcpManager>,
        local_coding_session_workspaces_path: Option<PathBuf>,
    ) -> Self {
        let local_coding_session_workspaces = local_coding_session_workspaces_path
            .as_deref()
            .map(load_session_workspaces)
            .unwrap_or_default();
        Self {
            app_server,
            mcp,
            local_coding_workspace: Arc::new(RwLock::new(None)),
            local_coding_session_workspaces: Arc::new(RwLock::new(local_coding_session_workspaces)),
            local_coding_session_workspaces_path,
            browser_preview_workspace: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_local_coding_workspace(&self, workspace: PathBuf) {
        if let Ok(mut current) = self.local_coding_workspace.write() {
            *current = Some(workspace);
        }
    }

    pub fn local_coding_workspace(&self) -> Option<PathBuf> {
        self.local_coding_workspace
            .read()
            .ok()
            .and_then(|current| current.clone())
    }

    pub fn bind_local_coding_session(
        &self,
        session_id: impl Into<String>,
        workspace: PathBuf,
    ) -> Result<(), String> {
        let snapshot = {
            let mut workspaces = self
                .local_coding_session_workspaces
                .write()
                .map_err(|_| "Local coding session workspace state is unavailable.".to_string())?;
            workspaces.insert(session_id.into(), workspace);
            workspaces.clone()
        };
        if let Some(path) = &self.local_coding_session_workspaces_path {
            save_session_workspaces(path, &snapshot)?;
        }
        Ok(())
    }

    pub fn local_coding_workspace_for_session(
        &self,
        session_id: &str,
    ) -> Result<Option<PathBuf>, String> {
        let workspace = self
            .local_coding_session_workspaces
            .read()
            .map_err(|_| "Local coding session workspace state is unavailable.".to_string())?
            .get(session_id)
            .cloned();
        if workspace.is_some() || self.local_coding_workspace().is_none() {
            return Ok(workspace);
        }
        Err(format!(
            "Session `{session_id}` has no saved workspace binding. Start a new session after selecting the intended workspace."
        ))
    }

    pub fn browser_preview_workspace(&self) -> Option<PathBuf> {
        self.browser_preview_workspace
            .read()
            .ok()
            .and_then(|workspace| workspace.clone())
    }

    pub fn set_browser_preview_workspace(&self, workspace: Option<PathBuf>) {
        if let Ok(mut current) = self.browser_preview_workspace.write() {
            *current = workspace;
        }
    }
}

fn load_session_workspaces(path: &Path) -> BTreeMap<String, PathBuf> {
    let Ok(raw) = std::fs::read(path) else {
        return BTreeMap::new();
    };
    serde_json::from_slice(&raw).unwrap_or_default()
}

fn save_session_workspaces(
    path: &Path,
    workspaces: &BTreeMap<String, PathBuf>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Local coding session workspace path has no parent.".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to create local coding session workspace directory {}: {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_vec_pretty(workspaces)
        .map_err(|error| format!("Failed to encode local coding session workspaces: {error}"))?;
    std::fs::write(path, raw).map_err(|error| {
        format!(
            "Failed to persist local coding session workspaces {}: {error}",
            path.display()
        )
    })
}

#[cfg(test)]
#[path = "app_state_tests.rs"]
mod tests;
