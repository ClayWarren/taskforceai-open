use super::{locked_computer_use_status_for_paths, LockedComputerUseManager};

fn temp_root(name: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!(
        "taskforceai-locked-computer-use-{}-{name}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&root);
    root
}

#[test]
fn status_matches_platform_support() {
    let status = locked_computer_use_status_for_paths(
        std::path::Path::new("/tmp/taskforceai-missing-auth-plugin.bundle"),
        None,
    );

    #[cfg(target_os = "macos")]
    {
        assert!(status.supported);
        assert!(status.requires_install);
        assert!(!status.enabled);
        assert!(!status.packaged);
    }
    #[cfg(not(target_os = "macos"))]
    {
        assert!(!status.supported);
        assert!(!status.requires_install);
        assert!(!status.enabled);
    }
}

#[test]
fn default_and_resource_dir_constructors_report_status() {
    let default_status = LockedComputerUseManager::default().status();
    assert_eq!(default_status.supported, cfg!(target_os = "macos"));

    let root = temp_root("resource-dir");
    let packaged = root.join("authorization-plugins");
    std::fs::create_dir_all(&packaged).expect("resource dir");

    let manager = LockedComputerUseManager::with_resource_dir(Some(root.clone()));
    let status = manager.status();

    #[cfg(target_os = "macos")]
    assert!(status
        .package_path
        .unwrap_or_default()
        .contains("authorization-plugins/TaskForceAILockedComputerUse.bundle"));
    #[cfg(not(target_os = "macos"))]
    assert!(status.package_path.is_none());

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn install_refuses_missing_packaged_plugin() {
    let manager = LockedComputerUseManager::with_paths(
        std::path::PathBuf::from("/tmp/taskforceai-missing-auth-plugin.bundle"),
        Some(std::path::PathBuf::from(
            "/tmp/taskforceai-missing-packaged-auth-plugin.bundle",
        )),
    );

    #[cfg(target_os = "macos")]
    assert!(manager
        .install()
        .expect_err("install should fail")
        .contains("authorization plug-in is not packaged yet"));
    #[cfg(not(target_os = "macos"))]
    assert_eq!(
        manager.install().expect_err("install should fail"),
        "Locked computer use is only available on macOS."
    );
}

#[test]
fn install_uses_default_packaged_path_when_resource_path_is_unknown() {
    let root = temp_root("install-default-package-path");
    let manager = LockedComputerUseManager::with_auth_plugin_path(root.join("missing.bundle"));

    #[cfg(target_os = "macos")]
    assert!(manager
        .install()
        .expect_err("install should fail")
        .contains("authorization-plugins/TaskForceAILockedComputerUse.bundle"));
    #[cfg(not(target_os = "macos"))]
    assert_eq!(
        manager.install().expect_err("install should fail"),
        "Locked computer use is only available on macOS."
    );

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn install_refuses_packaged_plugin_without_privileged_installer() {
    let root = temp_root("packaged-install");
    let packaged_path = root.join("TaskForceAILockedComputerUse.bundle");
    std::fs::create_dir_all(&packaged_path).expect("fixture bundle dir");
    let manager = LockedComputerUseManager::with_paths(
        root.join("missing-system.bundle"),
        Some(packaged_path),
    );

    #[cfg(target_os = "macos")]
    assert!(manager
        .install()
        .expect_err("install should fail")
        .contains("requires a privileged macOS installer"));
    #[cfg(not(target_os = "macos"))]
    assert_eq!(
        manager.install().expect_err("install should fail"),
        "Locked computer use is only available on macOS."
    );

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn install_returns_status_when_plugin_is_already_installed() {
    let root = temp_root("installed");
    let installed_path = root.join("TaskForceAILockedComputerUse.bundle");
    std::fs::create_dir_all(&installed_path).expect("fixture bundle dir");
    let manager = LockedComputerUseManager::with_auth_plugin_path(installed_path);

    #[cfg(target_os = "macos")]
    assert!(manager.install().expect("installed plugin").installed);
    #[cfg(not(target_os = "macos"))]
    assert_eq!(
        manager.install().expect_err("install should fail"),
        "Locked computer use is only available on macOS."
    );

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn status_reports_packaged_plugin_when_present() {
    let root = temp_root("packaged-status");
    let packaged_path = root.join("TaskForceAILockedComputerUse.bundle");
    std::fs::create_dir_all(&packaged_path).expect("fixture bundle dir");
    let manager = LockedComputerUseManager::with_paths(
        root.join("missing-system.bundle"),
        Some(packaged_path.clone()),
    );

    let status = manager.status();

    #[cfg(target_os = "macos")]
    {
        assert!(status.packaged);
        let expected = packaged_path.display().to_string();
        assert_eq!(status.package_path.as_deref(), Some(expected.as_str()));
    }
    #[cfg(not(target_os = "macos"))]
    assert!(!status.packaged);

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn enabling_requires_installed_plugin() {
    let root = temp_root("enable-missing");
    let manager = LockedComputerUseManager::with_paths(root.join("missing-system.bundle"), None);

    #[cfg(target_os = "macos")]
    assert!(manager
        .set_enabled(true)
        .expect_err("enable should fail without installed plugin")
        .contains("requires a packaged macOS authorization plug-in"));
    #[cfg(not(target_os = "macos"))]
    assert_eq!(
        manager.set_enabled(true).expect_err("enable should fail"),
        "Locked computer use is only available on macOS."
    );

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn disabling_missing_plugin_is_noop() {
    let root = temp_root("disable-missing");
    let manager = LockedComputerUseManager::with_paths(root.join("missing-system.bundle"), None);

    let status = manager
        .set_enabled(false)
        .expect("missing plugin is already disabled");

    assert!(!status.installed);
    assert!(!status.enabled);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn enabling_installed_plugin_returns_status() {
    let root = temp_root("enable-installed");
    let installed_path = root.join("TaskForceAILockedComputerUse.bundle");
    std::fs::create_dir_all(&installed_path).expect("fixture bundle dir");
    let manager = LockedComputerUseManager::with_auth_plugin_path(installed_path);

    #[cfg(target_os = "macos")]
    assert!(
        manager
            .set_enabled(true)
            .expect("installed plugin can be enabled")
            .enabled
    );
    #[cfg(not(target_os = "macos"))]
    assert_eq!(
        manager.set_enabled(true).expect_err("enable should fail"),
        "Locked computer use is only available on macOS."
    );

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn disabling_installed_plugin_returns_error_instead_of_noop() {
    let root = temp_root("disable-installed");
    let installed_path = root.join("TaskForceAILockedComputerUse.bundle");
    std::fs::create_dir_all(&installed_path).expect("fixture bundle dir");
    let manager = LockedComputerUseManager::with_auth_plugin_path(installed_path);

    #[cfg(target_os = "macos")]
    assert!(manager
        .set_enabled(false)
        .expect_err("disable should fail when installed")
        .contains("not wired yet"));
    #[cfg(not(target_os = "macos"))]
    assert!(!manager.set_enabled(false).expect("not installed").installed);

    let _ = std::fs::remove_dir_all(root);
}
