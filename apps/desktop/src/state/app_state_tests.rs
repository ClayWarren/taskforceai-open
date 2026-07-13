use super::*;

fn poisoned_lock<T: Send + Sync + 'static>(value: T) -> Arc<RwLock<T>> {
    let lock = Arc::new(RwLock::new(value));
    let thread_lock = Arc::clone(&lock);
    let result = std::thread::spawn(move || {
        let _guard = thread_lock.write().expect("acquire lock before poisoning");
        panic!("poison test lock");
    })
    .join();
    assert!(result.is_err());
    lock
}

#[tokio::test]
async fn app_state_is_clonable() {
    let state = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        None,
    );
    let generation = state
        .begin_local_coding_activation()
        .expect("begin multi-root activation");
    state
        .complete_local_coding_roots_activation(
            generation,
            vec![PathBuf::from("/tmp/project"), PathBuf::from("/tmp/shared")],
        )
        .expect("complete multi-root activation");
    state
        .bind_local_coding_session_roots(
            "agent-1",
            vec![
                PathBuf::from("/tmp/project-agent"),
                PathBuf::from("/tmp/shared-agent"),
            ],
        )
        .expect("bind workspace");
    state.set_browser_preview_workspace(Some(PathBuf::from("/tmp/project")));
    let cloned = state.clone();
    assert!(Arc::strong_count(&cloned.app_server) >= 2);
    assert!(Arc::strong_count(&cloned.mcp) >= 2);
    assert_eq!(
        cloned.local_coding_workspace(),
        Some(PathBuf::from("/tmp/project"))
    );
    assert_eq!(
        cloned.local_coding_workspace_roots(),
        vec![PathBuf::from("/tmp/project"), PathBuf::from("/tmp/shared")]
    );
    assert_eq!(
        cloned
            .local_coding_workspace_for_session("agent-1")
            .expect("bound workspace"),
        Some(PathBuf::from("/tmp/project-agent"))
    );
    assert_eq!(
        cloned
            .local_coding_workspace_roots_for_session("agent-1")
            .expect("bound workspace roots"),
        Some(vec![
            PathBuf::from("/tmp/project-agent"),
            PathBuf::from("/tmp/shared-agent")
        ])
    );
    assert!(cloned
        .local_coding_workspace_for_session("agent-2")
        .expect_err("unbound session must not inherit current workspace")
        .contains("no saved workspace binding"));
    assert_eq!(
        cloned.browser_preview_workspace(),
        Some(PathBuf::from("/tmp/project"))
    );
    cloned
        .clear_local_coding_workspace()
        .expect("clear local coding workspace");
    assert_eq!(cloned.local_coding_workspace(), None);
    assert_eq!(cloned.browser_preview_workspace(), None);
}

#[tokio::test]
async fn disabling_local_coding_supersedes_an_in_flight_activation() {
    let state = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        None,
    );
    let pending_activation = state
        .begin_local_coding_activation()
        .expect("begin activation");

    state
        .clear_local_coding_workspace()
        .expect("disable local coding");

    assert!(!state
        .complete_local_coding_activation(pending_activation, PathBuf::from("/tmp/project"))
        .expect("complete stale activation"));
    assert_eq!(state.local_coding_workspace(), None);
}

#[test]
fn current_local_coding_activation_sets_the_workspace() {
    let state = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        None,
    );
    let generation = state
        .begin_local_coding_activation()
        .expect("begin activation");

    assert!(state
        .complete_local_coding_activation(generation, PathBuf::from("/tmp/project"))
        .expect("complete activation"));
    assert_eq!(
        state.local_coding_workspace(),
        Some(PathBuf::from("/tmp/project"))
    );
}

#[test]
fn local_coding_activation_reports_poisoned_and_overflowed_state() {
    let poisoned = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        None,
    );
    let generation = Arc::clone(&poisoned.local_coding_activation_generation);
    assert!(std::thread::spawn(move || {
        let _guard = generation.lock().expect("lock generation");
        panic!("poison generation");
    })
    .join()
    .is_err());
    assert!(poisoned.begin_local_coding_activation().is_err());
    assert!(poisoned
        .complete_local_coding_activation(1, PathBuf::from("/tmp/project"))
        .is_err());

    let overflowed = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        None,
    );
    *overflowed
        .local_coding_activation_generation
        .lock()
        .expect("lock generation") = u64::MAX;
    assert!(overflowed.begin_local_coding_activation().is_err());
}

#[test]
fn local_coding_workspace_writes_report_poisoned_state() {
    let state = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        None,
    );
    let generation = state
        .begin_local_coding_activation()
        .expect("begin activation");
    let workspace = Arc::clone(&state.local_coding_workspace);
    assert!(std::thread::spawn(move || {
        let _guard = workspace.write().expect("lock workspace");
        panic!("poison workspace");
    })
    .join()
    .is_err());
    assert!(state
        .complete_local_coding_activation(generation, PathBuf::from("/tmp/project"))
        .is_err());
    assert!(state.clear_local_coding_workspace().is_err());

    let empty_roots = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        None,
    );
    let generation = empty_roots
        .begin_local_coding_activation()
        .expect("begin empty-roots activation");
    assert!(empty_roots
        .complete_local_coding_roots_activation(generation, Vec::new())
        .expect_err("empty workspace roots should be rejected")
        .contains("At least one"));

    let mut poisoned_roots = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        None,
    );
    poisoned_roots.local_coding_workspace_roots = poisoned_lock(Vec::new());
    let generation = poisoned_roots
        .begin_local_coding_activation()
        .expect("begin poisoned-roots activation");
    assert!(poisoned_roots
        .complete_local_coding_activation(generation, PathBuf::from("/tmp/project"))
        .expect_err("activation should reject poisoned workspace roots")
        .contains("roots state is unavailable"));
    assert!(poisoned_roots
        .clear_local_coding_workspace()
        .expect_err("clear should reject poisoned workspace roots")
        .contains("roots state is unavailable"));
}

#[tokio::test]
async fn session_workspace_bindings_survive_desktop_restart() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-desktop-session-workspaces-{}",
        std::process::id()
    ));
    let path = root.join("bindings.json");
    let make_state = || {
        AppState::new(
            Arc::new(DesktopAppServer::new(
                "https://api.example.test".to_string(),
            )),
            Arc::new(DesktopMcpManager::new()),
            Some(path.clone()),
        )
    };

    let state = make_state();
    state
        .bind_local_coding_session("thread-1", PathBuf::from("/tmp/original-project"))
        .expect("persist workspace binding");
    drop(state);

    let restarted = make_state();
    restarted.set_local_coding_workspace(PathBuf::from("/tmp/different-project"));
    assert_eq!(
        restarted
            .local_coding_workspace_for_session("thread-1")
            .expect("restored workspace"),
        Some(PathBuf::from("/tmp/original-project"))
    );

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn session_workspace_loader_migrates_legacy_bindings_and_ignores_invalid_json() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-desktop-legacy-session-workspaces-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let path = root.join("bindings.json");

    std::fs::write(&path, r#"{"thread-1":"/tmp/legacy-project"}"#).expect("write legacy binding");
    assert_eq!(
        load_session_workspaces(&path),
        BTreeMap::from([(
            "thread-1".to_string(),
            vec![PathBuf::from("/tmp/legacy-project")],
        )])
    );

    std::fs::write(&path, b"not-json").expect("write invalid binding data");
    assert!(load_session_workspaces(&path).is_empty());

    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn session_workspace_persistence_reports_io_and_encoding_failures() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-desktop-session-workspace-errors-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).expect("create test root");

    let no_parent_error = save_session_workspaces(Path::new("/"), &BTreeMap::new())
        .expect_err("filesystem root has no parent");
    assert!(no_parent_error.contains("has no parent"));

    let blocker = root.join("blocker");
    std::fs::write(&blocker, b"file").expect("create directory blocker");
    let create_error = save_session_workspaces(&blocker.join("bindings.json"), &BTreeMap::new())
        .expect_err("a regular file cannot be used as a parent directory");
    assert!(create_error.contains("Failed to create"));

    let write_error = save_session_workspaces(&root, &BTreeMap::new())
        .expect_err("a directory cannot be replaced with the bindings file");
    assert!(write_error.contains("Failed to persist"));

    #[cfg(unix)]
    {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        let mut workspaces = BTreeMap::new();
        workspaces.insert(
            "invalid-path".to_string(),
            vec![PathBuf::from(OsString::from_vec(vec![0xff]))],
        );
        let encoding_error = save_session_workspaces(&root.join("bindings.json"), &workspaces)
            .expect_err("JSON cannot encode a non-UTF-8 path");
        assert!(encoding_error.contains("Failed to encode"));
    }

    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn workspace_setters_ignore_poisoned_state_locks() {
    let mut state = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        None,
    );
    state.local_coding_workspace = poisoned_lock(None);
    state.browser_preview_workspace = poisoned_lock(None);

    state.set_local_coding_workspace(PathBuf::from("/tmp/project"));
    state.set_browser_preview_workspace(Some(PathBuf::from("/tmp/project")));

    assert!(state.local_coding_workspace().is_none());
    assert!(state.browser_preview_workspace().is_none());
}

#[test]
fn session_workspace_methods_report_state_and_persistence_failures() {
    let mut poisoned_state = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        None,
    );
    poisoned_state.local_coding_session_workspaces = poisoned_lock(BTreeMap::new());

    let bind_error = poisoned_state
        .bind_local_coding_session("thread-1", PathBuf::from("/tmp/project"))
        .expect_err("binding should reject poisoned session state");
    assert!(bind_error.contains("state is unavailable"));
    let read_error = poisoned_state
        .local_coding_workspace_for_session("thread-1")
        .expect_err("reading should reject poisoned session state");
    assert!(read_error.contains("state is unavailable"));

    let root = std::env::temp_dir().join(format!(
        "taskforceai-desktop-session-workspace-bind-error-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).expect("create directory destination");
    let state = AppState::new(
        Arc::new(DesktopAppServer::new(
            "https://api.example.test".to_string(),
        )),
        Arc::new(DesktopMcpManager::new()),
        Some(root.clone()),
    );
    let persistence_error = state
        .bind_local_coding_session("thread-1", PathBuf::from("/tmp/project"))
        .expect_err("binding should propagate persistence failure");
    assert!(persistence_error.contains("Failed to persist"));

    std::fs::remove_dir_all(root).expect("remove directory destination");
}
