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
