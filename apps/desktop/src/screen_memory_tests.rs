use super::*;

fn test_manager(name: &str) -> (ScreenMemoryManager, PathBuf) {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-test-{}-{name}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    let manager = ScreenMemoryManager::with_paths(
        Some(root.join("config").join("screen-memory.json")),
        root.join("captures"),
        Some(root.join("memory").join("MEMORY.md")),
    );
    (manager, root)
}

fn set_modified(path: &Path, time: SystemTime) {
    let file = fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("open fixture for mtime");
    file.set_times(fs::FileTimes::new().set_modified(time))
        .expect("set fixture mtime");
}

#[test]
fn status_defaults_to_disabled_and_paused() {
    let (manager, root) = test_manager("defaults");

    let status = manager.status();

    assert!(!status.enabled);
    assert!(status.paused);
    assert_eq!(status.capture_count, 0);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn status_defaults_when_paths_or_settings_are_unavailable() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-no-paths-{}",
        std::process::id()
    ));
    let manager = ScreenMemoryManager::with_paths(None, root.join("captures"), None);

    let status = manager.status();

    assert!(!status.enabled);
    assert!(status.paused);
    assert!(status.memory_path.is_none());
    assert_eq!(
        manager
            .set_enabled(true)
            .expect_err("settings path required"),
        "Screen Memory settings path is unavailable."
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn invalid_settings_file_uses_defaults() {
    let (manager, root) = test_manager("invalid-settings");
    let settings_path = manager.settings_path.clone().expect("settings path");
    fs::create_dir_all(settings_path.parent().expect("settings parent")).expect("settings dir");
    fs::write(settings_path, b"{not valid json").expect("settings fixture");

    let status = manager.status();

    assert!(!status.enabled);
    assert!(status.paused);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn enabling_unpauses_and_writes_memory_source() {
    let (manager, root) = test_manager("enable");

    let status = manager.set_enabled(true).expect("enable screen memory");
    let disabled = manager.set_enabled(false).expect("disable screen memory");

    assert!(status.enabled);
    assert!(!status.paused);
    assert!(!disabled.enabled);
    assert!(disabled.paused);
    let memory_path = manager.memory_path.clone().expect("memory path");
    let memory = fs::read_to_string(memory_path).expect("memory source");
    assert!(memory.contains("# Screen Memory"));
    assert!(memory.contains("Status: disabled"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn pause_can_resume_screen_memory() {
    let (manager, root) = test_manager("pause");

    manager.set_enabled(true).expect("enable");
    let paused = manager.set_paused(true).expect("pause");
    let resumed = manager.set_paused(false).expect("resume");

    assert!(paused.paused);
    assert!(resumed.enabled);
    assert!(!resumed.paused);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn set_paused_reports_settings_directory_creation_errors() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-pause-settings-parent-file-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("root");
    let parent_file = root.join("settings-parent");
    fs::write(&parent_file, b"not a directory").expect("settings parent file");
    let manager = ScreenMemoryManager::with_paths(
        Some(parent_file.join("screen-memory.json")),
        root.join("captures"),
        Some(root.join("memory").join("MEMORY.md")),
    );

    let err = manager
        .set_paused(false)
        .expect_err("settings parent should fail");

    assert!(err.contains("Failed to create Screen Memory settings directory"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn set_paused_reports_memory_source_errors() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-pause-memory-parent-file-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("root");
    let parent_file = root.join("memory-parent");
    fs::write(&parent_file, b"not a directory").expect("memory parent file");
    let manager = ScreenMemoryManager::with_paths(
        Some(root.join("config").join("screen-memory.json")),
        root.join("captures"),
        Some(parent_file.join("MEMORY.md")),
    );

    let err = manager
        .set_paused(false)
        .expect_err("memory parent should fail");

    assert!(err.contains("Failed to create Screen Memory source directory"));
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn capture_now_requires_enabled_and_unpaused() {
    let (manager, root) = test_manager("capture-preconditions");

    assert_eq!(
        manager.capture_now().await.expect_err("disabled"),
        "Screen Memory is disabled."
    );
    manager.set_enabled(true).expect("enable");
    manager.set_paused(true).expect("pause");
    assert_eq!(
        manager.capture_now().await.expect_err("paused"),
        "Screen Memory is paused."
    );

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn capture_current_screen_requires_enabled_and_unpaused() {
    let (manager, root) = test_manager("computer-use-capture-preconditions");

    assert_eq!(
        manager
            .capture_current_screen()
            .await
            .expect_err("disabled"),
        "Screen Memory is disabled."
    );
    manager.set_enabled(true).expect("enable");
    manager.set_paused(true).expect("pause");
    assert_eq!(
        manager.capture_current_screen().await.expect_err("paused"),
        "Screen Memory is paused."
    );

    let _ = fs::remove_dir_all(root);
}

#[cfg(coverage)]
#[tokio::test]
async fn capture_now_records_latest_capture_under_coverage() {
    let (manager, root) = test_manager("capture-now");
    manager.set_enabled(true).expect("enable");

    let status = manager.capture_now().await.expect("coverage capture");

    assert_eq!(status.capture_count, 1);
    assert_eq!(status.message, "Captured current screen.");
    assert!(status
        .latest_capture_path
        .unwrap_or_default()
        .ends_with(".png"));
    let memory = fs::read_to_string(manager.memory_path.clone().expect("memory path"))
        .expect("memory source");
    assert!(memory.contains("Latest capture:"));
    let _ = fs::remove_dir_all(root);
}

#[cfg(coverage)]
#[tokio::test]
async fn capture_current_screen_returns_image_under_coverage() {
    let (manager, root) = test_manager("computer-use-capture-current");
    manager.set_enabled(true).expect("enable");

    let capture = manager
        .capture_current_screen()
        .await
        .expect("coverage capture");

    assert_eq!(capture.media_type, "image/png");
    assert_eq!(capture.byte_length, b"coverage screen capture".len());
    assert_eq!(capture.message, "Captured current screen.");
    assert!(capture.path.ends_with(".png"));
    assert!(!capture.image_base64.is_empty());
    let _ = fs::remove_dir_all(root);
}

#[cfg(coverage)]
#[tokio::test]
async fn capture_now_reports_capture_directory_errors() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-capture-parent-file-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("root");
    let capture_parent = root.join("capture-parent");
    fs::write(&capture_parent, b"not a directory").expect("capture parent file");
    let settings_path = root.join("config").join("screen-memory.json");
    fs::create_dir_all(settings_path.parent().expect("settings parent")).expect("settings dir");
    fs::write(&settings_path, r#"{"enabled":true,"paused":false}"#).expect("settings");
    let manager = ScreenMemoryManager::with_paths(
        Some(settings_path),
        capture_parent.join("captures"),
        Some(root.join("memory").join("MEMORY.md")),
    );

    let err = manager
        .capture_now()
        .await
        .expect_err("capture directory should fail");

    assert!(err.contains("Failed to create Screen Memory capture directory"));
    let _ = fs::remove_dir_all(root);
}

#[cfg(coverage)]
#[tokio::test]
async fn capture_current_screen_reports_capture_directory_errors() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-computer-use-capture-parent-file-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("root");
    let capture_parent = root.join("capture-parent");
    fs::write(&capture_parent, b"not a directory").expect("capture parent file");
    let settings_path = root.join("config").join("screen-memory.json");
    fs::create_dir_all(settings_path.parent().expect("settings parent")).expect("settings dir");
    fs::write(&settings_path, r#"{"enabled":true,"paused":false}"#).expect("settings");
    let manager = ScreenMemoryManager::with_paths(
        Some(settings_path),
        capture_parent.join("captures"),
        Some(root.join("memory").join("MEMORY.md")),
    );

    let err = manager
        .capture_current_screen()
        .await
        .expect_err("capture directory should fail");

    assert!(err.contains("Failed to create screen capture directory"));
    let _ = fs::remove_dir_all(root);
}

#[cfg(coverage)]
#[tokio::test]
async fn capture_current_screen_reports_read_errors() {
    let (manager, root) = test_manager("missing-after-capture");
    manager.set_enabled(true).expect("enable");

    let err = manager
        .capture_current_screen()
        .await
        .expect_err("missing capture should fail");

    assert!(err.contains("Failed to read screen capture"));
    let _ = fs::remove_dir_all(root);
}

#[cfg(coverage)]
#[tokio::test]
async fn run_screencapture_reports_write_errors_under_coverage() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-capture-write-error-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("root");

    let err = run_screencapture(&root)
        .await
        .expect_err("directory path should not be writable as a capture file");

    assert!(err.contains("Failed to write coverage screen capture"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn capture_summary_counts_png_files_and_tracks_latest() {
    let (manager, root) = test_manager("summary");
    fs::create_dir_all(&manager.capture_dir).expect("capture dir");
    let old = manager.capture_dir.join("screen-old.png");
    let new = manager.capture_dir.join("screen-new.png");
    fs::write(&old, b"old").expect("old capture");
    fs::write(&new, b"newer").expect("new capture");
    fs::write(manager.capture_dir.join("ignore.txt"), b"text").expect("text fixture");
    set_modified(&old, UNIX_EPOCH + Duration::from_secs(10));
    set_modified(&new, UNIX_EPOCH + Duration::from_secs(20));

    let summary = manager.capture_summary().expect("summary");

    assert_eq!(summary.count, 2);
    assert_eq!(summary.bytes, 8);
    assert_eq!(summary.latest.expect("latest").path, new);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn capture_summary_reports_read_dir_errors() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-file-capture-dir-{}",
        std::process::id()
    ));
    let _ = fs::remove_file(&root);
    fs::write(&root, b"not a directory").expect("file capture dir");
    let manager = ScreenMemoryManager::with_paths(None, root.clone(), None);

    let err = manager.capture_summary().expect_err("read_dir should fail");

    assert!(err.contains("Failed to read Screen Memory capture directory"));
    let _ = fs::remove_file(root);
}

#[test]
fn prune_expired_captures_removes_old_pngs() {
    let (manager, root) = test_manager("prune");
    fs::create_dir_all(&manager.capture_dir).expect("capture dir");
    let old = manager.capture_dir.join("old.png");
    let recent = manager.capture_dir.join("recent.png");
    let text = manager.capture_dir.join("ignore.txt");
    fs::write(&old, b"old").expect("old capture");
    fs::write(&recent, b"recent").expect("recent capture");
    fs::write(&text, b"text").expect("text fixture");
    set_modified(
        &old,
        SystemTime::now() - CAPTURE_TTL - Duration::from_secs(60),
    );
    set_modified(&recent, SystemTime::now());

    manager.prune_expired_captures().expect("prune");

    assert!(!old.exists());
    assert!(recent.exists());
    assert!(text.exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn write_memory_source_allows_missing_memory_path() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-no-memory-{}",
        std::process::id()
    ));
    let manager = ScreenMemoryManager::with_paths(
        Some(root.join("config").join("screen-memory.json")),
        root.join("captures"),
        None,
    );

    let status = manager
        .set_enabled(true)
        .expect("enable without memory path");

    assert!(status.enabled);
    let _ = fs::remove_dir_all(root);
}

#[test]
fn write_memory_source_reports_directory_creation_errors() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-memory-parent-file-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("root");
    let parent_file = root.join("memory-parent");
    fs::write(&parent_file, b"not a directory").expect("parent file");
    let manager = ScreenMemoryManager::with_paths(
        Some(root.join("config").join("screen-memory.json")),
        root.join("captures"),
        Some(parent_file.join("MEMORY.md")),
    );

    let err = manager
        .set_enabled(true)
        .expect_err("memory parent should fail");

    assert!(err.contains("Failed to create Screen Memory source directory"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn save_settings_reports_directory_creation_errors() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-settings-parent-file-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("root");
    let parent_file = root.join("settings-parent");
    fs::write(&parent_file, b"not a directory").expect("settings parent file");
    let manager = ScreenMemoryManager::with_paths(
        Some(parent_file.join("screen-memory.json")),
        root.join("captures"),
        Some(root.join("memory").join("MEMORY.md")),
    );

    let err = manager
        .set_enabled(true)
        .expect_err("settings parent should fail");

    assert!(err.contains("Failed to create Screen Memory settings directory"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn save_settings_reports_write_errors() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-settings-directory-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    let settings_dir = root.join("settings-dir");
    fs::create_dir_all(&settings_dir).expect("settings dir");
    let manager = ScreenMemoryManager::with_paths(
        Some(settings_dir.clone()),
        root.join("captures"),
        Some(root.join("memory").join("MEMORY.md")),
    );

    let err = manager
        .set_enabled(true)
        .expect_err("settings write should fail");

    assert!(err.contains("Failed to write Screen Memory settings"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn write_memory_source_reports_write_errors() {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-screen-memory-memory-directory-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    let memory_dir = root.join("memory-dir");
    fs::create_dir_all(&memory_dir).expect("memory dir");
    let manager = ScreenMemoryManager::with_paths(
        Some(root.join("config").join("screen-memory.json")),
        root.join("captures"),
        Some(memory_dir.clone()),
    );

    let err = manager
        .set_enabled(true)
        .expect_err("memory write should fail");

    assert!(err.contains("Failed to write Screen Memory source"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn time_and_path_helpers_handle_boundaries() {
    assert_eq!(system_time_to_millis(UNIX_EPOCH), Some(0));
    assert_eq!(
        system_time_to_millis(UNIX_EPOCH - Duration::from_secs(1)),
        None
    );
    assert!(unix_millis_now() > 1_000_000_000_000);
    assert_eq!(
        screen_memory_file_path(PathBuf::from("/tmp/home")),
        PathBuf::from("/tmp/home/.taskforceai/screen-memory/MEMORY.md")
    );
    assert_eq!(home_dir(), std::env::var_os("HOME").map(PathBuf::from));
    assert_eq!(
        screen_memory_message(false, false, false),
        "Screen Memory capture is only available on macOS."
    );
}
