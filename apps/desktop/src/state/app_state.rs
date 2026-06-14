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
mod tests {
    use super::*;

    #[tokio::test]
    async fn app_state_is_clonable() {
        let state = AppState {
            app_server: Arc::new(DesktopAppServer::new(
                "https://api.example.test".to_string(),
            )),
            mcp: Arc::new(DesktopMcpManager::new()),
            local_coding_workspace: Arc::new(RwLock::new(None)),
        };
        state.set_local_coding_workspace(PathBuf::from("/tmp/project"));
        let cloned = state.clone();
        assert!(Arc::strong_count(&cloned.app_server) >= 2);
        assert!(Arc::strong_count(&cloned.mcp) >= 2);
        assert_eq!(
            cloned.local_coding_workspace(),
            Some(PathBuf::from("/tmp/project"))
        );
    }
}
