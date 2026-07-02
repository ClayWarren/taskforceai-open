use std::{
    path::PathBuf,
    sync::{Arc, RwLock},
};

use crate::{app_server::DesktopAppServer, mcp::DesktopMcpManager};

#[derive(Clone)]
pub struct AppState {
    pub app_server: Arc<DesktopAppServer>,
    pub mcp: Arc<DesktopMcpManager>,
    pub local_coding_workspace: Arc<RwLock<Option<PathBuf>>>,
}

impl AppState {
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
}

#[cfg(test)]
#[path = "app_state_tests.rs"]
mod tests;
