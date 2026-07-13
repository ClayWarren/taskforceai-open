use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
};

use crate::{app_server::DesktopAppServer, mcp::DesktopMcpManager};

#[derive(Clone)]
pub struct AppState {
    pub app_server: Arc<DesktopAppServer>,
    pub mcp: Arc<DesktopMcpManager>,
    pub local_coding_workspace: Arc<RwLock<Option<PathBuf>>>,
    pub local_coding_workspace_roots: Arc<RwLock<Vec<PathBuf>>>,
    local_coding_activation_generation: Arc<Mutex<u64>>,
    pub local_coding_session_workspaces: Arc<RwLock<BTreeMap<String, Vec<PathBuf>>>>,
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
            local_coding_workspace_roots: Arc::new(RwLock::new(Vec::new())),
            local_coding_activation_generation: Arc::new(Mutex::new(0)),
            local_coding_session_workspaces: Arc::new(RwLock::new(local_coding_session_workspaces)),
            local_coding_session_workspaces_path,
            browser_preview_workspace: Arc::new(RwLock::new(None)),
        }
    }

    #[cfg(test)]
    pub fn set_local_coding_workspace(&self, workspace: PathBuf) {
        if let Ok(mut current) = self.local_coding_workspace.write() {
            *current = Some(workspace);
        }
        if let Some(workspace) = self.local_coding_workspace() {
            if let Ok(mut roots) = self.local_coding_workspace_roots.write() {
                *roots = vec![workspace];
            }
        }
    }

    pub fn begin_local_coding_activation(&self) -> Result<u64, String> {
        let mut generation = self
            .local_coding_activation_generation
            .lock()
            .map_err(|_| "Local coding activation state is unavailable.".to_string())?;
        *generation = generation
            .checked_add(1)
            .ok_or_else(|| "Local coding activation generation overflowed.".to_string())?;
        Ok(*generation)
    }

    pub fn complete_local_coding_activation(
        &self,
        generation: u64,
        workspace: PathBuf,
    ) -> Result<bool, String> {
        self.complete_local_coding_roots_activation(generation, vec![workspace])
    }

    pub fn complete_local_coding_roots_activation(
        &self,
        generation: u64,
        workspace_roots: Vec<PathBuf>,
    ) -> Result<bool, String> {
        let current_generation = self
            .local_coding_activation_generation
            .lock()
            .map_err(|_| "Local coding activation state is unavailable.".to_string())?;
        if *current_generation != generation {
            return Ok(false);
        }
        let workspace = workspace_roots
            .first()
            .cloned()
            .ok_or_else(|| "At least one local coding workspace root is required.".to_string())?;
        let mut current = self
            .local_coding_workspace
            .write()
            .map_err(|_| "Local coding workspace state is unavailable.".to_string())?;
        *current = Some(workspace);
        let mut roots = self
            .local_coding_workspace_roots
            .write()
            .map_err(|_| "Local coding workspace roots state is unavailable.".to_string())?;
        *roots = workspace_roots;
        Ok(true)
    }

    pub fn clear_local_coding_workspace(&self) -> Result<(), String> {
        let _generation = self.begin_local_coding_activation()?;
        let mut current = self
            .local_coding_workspace
            .write()
            .map_err(|_| "Local coding workspace state is unavailable.".to_string())?;
        *current = None;
        self.local_coding_workspace_roots
            .write()
            .map_err(|_| "Local coding workspace roots state is unavailable.".to_string())?
            .clear();
        drop(current);
        self.set_browser_preview_workspace(None);
        Ok(())
    }

    pub fn local_coding_workspace(&self) -> Option<PathBuf> {
        self.local_coding_workspace
            .read()
            .ok()
            .and_then(|current| current.clone())
    }

    pub fn local_coding_workspace_roots(&self) -> Vec<PathBuf> {
        self.local_coding_workspace_roots
            .read()
            .map(|roots| roots.clone())
            .unwrap_or_default()
    }

    #[cfg(test)]
    pub fn bind_local_coding_session(
        &self,
        session_id: impl Into<String>,
        workspace: PathBuf,
    ) -> Result<(), String> {
        self.bind_local_coding_session_roots(session_id, vec![workspace])
    }

    pub fn bind_local_coding_session_roots(
        &self,
        session_id: impl Into<String>,
        workspace_roots: Vec<PathBuf>,
    ) -> Result<(), String> {
        let snapshot = {
            let mut workspaces = self
                .local_coding_session_workspaces
                .write()
                .map_err(|_| "Local coding session workspace state is unavailable.".to_string())?;
            workspaces.insert(session_id.into(), workspace_roots);
            workspaces.clone()
        };
        if let Some(path) = &self.local_coding_session_workspaces_path {
            save_session_workspaces(path, &snapshot)?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn local_coding_workspace_for_session(
        &self,
        session_id: &str,
    ) -> Result<Option<PathBuf>, String> {
        Ok(self
            .local_coding_workspace_roots_for_session(session_id)?
            .and_then(|roots| roots.into_iter().next()))
    }

    pub fn local_coding_workspace_roots_for_session(
        &self,
        session_id: &str,
    ) -> Result<Option<Vec<PathBuf>>, String> {
        let workspaces = self
            .local_coding_session_workspaces
            .read()
            .map_err(|_| "Local coding session workspace state is unavailable.".to_string())?
            .get(session_id)
            .cloned();
        if workspaces.is_some() || self.local_coding_workspace().is_none() {
            return Ok(workspaces);
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

fn load_session_workspaces(path: &Path) -> BTreeMap<String, Vec<PathBuf>> {
    let Ok(raw) = std::fs::read(path) else {
        return BTreeMap::new();
    };
    serde_json::from_slice(&raw).unwrap_or_else(|_| {
        serde_json::from_slice::<BTreeMap<String, PathBuf>>(&raw)
            .map(|legacy| {
                legacy
                    .into_iter()
                    .map(|(session, workspace)| (session, vec![workspace]))
                    .collect()
            })
            .unwrap_or_default()
    })
}

fn save_session_workspaces(
    path: &Path,
    workspaces: &BTreeMap<String, Vec<PathBuf>>,
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
