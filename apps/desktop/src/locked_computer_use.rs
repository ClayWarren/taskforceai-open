use std::path::{Path, PathBuf};

use serde::Serialize;

const MACOS_AUTH_PLUGIN_PATH: &str =
    "/Library/Security/SecurityAgentPlugins/TaskForceAILockedComputerUse.bundle";
const PACKAGED_AUTH_PLUGIN_RELATIVE_PATH: &str =
    "authorization-plugins/TaskForceAILockedComputerUse.bundle";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockedComputerUseStatus {
    pub supported: bool,
    pub installed: bool,
    pub enabled: bool,
    pub requires_install: bool,
    pub install_path: Option<String>,
    pub packaged: bool,
    pub package_path: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct LockedComputerUseManager {
    auth_plugin_path: PathBuf,
    packaged_auth_plugin_path: Option<PathBuf>,
}

impl Default for LockedComputerUseManager {
    fn default() -> Self {
        Self {
            auth_plugin_path: PathBuf::from(MACOS_AUTH_PLUGIN_PATH),
            packaged_auth_plugin_path: None,
        }
    }
}

impl LockedComputerUseManager {
    pub fn with_resource_dir(resource_dir: Option<PathBuf>) -> Self {
        Self {
            auth_plugin_path: PathBuf::from(MACOS_AUTH_PLUGIN_PATH),
            packaged_auth_plugin_path: resource_dir
                .map(|dir| dir.join(PACKAGED_AUTH_PLUGIN_RELATIVE_PATH)),
        }
    }

    #[cfg(test)]
    pub fn with_auth_plugin_path(path: PathBuf) -> Self {
        Self {
            auth_plugin_path: path,
            packaged_auth_plugin_path: None,
        }
    }

    #[cfg(test)]
    pub fn with_paths(
        auth_plugin_path: PathBuf,
        packaged_auth_plugin_path: Option<PathBuf>,
    ) -> Self {
        Self {
            auth_plugin_path,
            packaged_auth_plugin_path,
        }
    }

    pub fn status(&self) -> LockedComputerUseStatus {
        locked_computer_use_status_for_paths(
            &self.auth_plugin_path,
            self.packaged_auth_plugin_path.as_deref(),
        )
    }

    pub fn install(&self) -> Result<LockedComputerUseStatus, String> {
        let status = self.status();
        if !status.supported {
            return Err(status.message);
        }
        if status.installed {
            return Ok(status);
        }
        if status.packaged {
            return Err(
                "Locked computer use authorization plug-in is packaged, but installation requires a privileged macOS installer that is not wired yet.".to_string(),
            );
        }
        Err(format!(
            "Locked computer use authorization plug-in is not packaged yet. Expected bundled plug-in at {}.",
            self.packaged_auth_plugin_path
                .as_deref()
                .unwrap_or_else(|| Path::new(PACKAGED_AUTH_PLUGIN_RELATIVE_PATH))
                .display()
        ))
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<LockedComputerUseStatus, String> {
        let status = self.status();
        if !enabled {
            if status.installed {
                return Err(
                    "Disabling locked computer use requires uninstalling or disabling the macOS authorization plug-in, which is not wired yet."
                        .to_string(),
                );
            }
            return Ok(status);
        }
        if !status.supported {
            return Err(status.message);
        }
        if !status.installed {
            return Err(status.message);
        }
        Ok(status)
    }
}

fn locked_computer_use_status_for_paths(
    auth_plugin_path: &Path,
    packaged_auth_plugin_path: Option<&Path>,
) -> LockedComputerUseStatus {
    #[cfg(target_os = "macos")]
    {
        let installed = auth_plugin_path.exists();
        let packaged = packaged_auth_plugin_path.is_some_and(Path::exists);
        LockedComputerUseStatus {
            supported: true,
            installed,
            enabled: installed,
            requires_install: !installed,
            install_path: Some(auth_plugin_path.display().to_string()),
            packaged,
            package_path: packaged_auth_plugin_path.map(|path| path.display().to_string()),
            message: if installed {
                "Locked computer use authorization plug-in is installed.".to_string()
            } else if packaged {
                "Locked computer use authorization plug-in is packaged and ready for privileged installation.".to_string()
            } else {
                "Locked computer use requires a packaged macOS authorization plug-in.".to_string()
            },
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = auth_plugin_path;
        let _ = packaged_auth_plugin_path;
        LockedComputerUseStatus {
            supported: false,
            installed: false,
            enabled: false,
            requires_install: false,
            install_path: None,
            packaged: false,
            package_path: None,
            message: "Locked computer use is only available on macOS.".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{locked_computer_use_status_for_paths, LockedComputerUseManager};

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
    fn status_reports_packaged_plugin_when_present() {
        let dir = std::env::temp_dir().join(format!(
            "taskforceai-packaged-auth-plugin-{}",
            std::process::id()
        ));
        let packaged_path = dir.join("TaskForceAILockedComputerUse.bundle");
        std::fs::create_dir_all(&packaged_path).expect("fixture bundle dir");
        let manager = LockedComputerUseManager::with_paths(
            dir.join("missing-system.bundle"),
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

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn disabling_installed_plugin_returns_error_instead_of_noop() {
        let dir = std::env::temp_dir().join(format!(
            "taskforceai-installed-auth-plugin-{}",
            std::process::id()
        ));
        let installed_path = dir.join("TaskForceAILockedComputerUse.bundle");
        std::fs::create_dir_all(&installed_path).expect("fixture bundle dir");
        let manager = LockedComputerUseManager::with_auth_plugin_path(installed_path);

        #[cfg(target_os = "macos")]
        assert!(manager
            .set_enabled(false)
            .expect_err("disable should fail when installed")
            .contains("not wired yet"));
        #[cfg(not(target_os = "macos"))]
        assert!(!manager.set_enabled(false).expect("not installed").installed);

        let _ = std::fs::remove_dir_all(dir);
    }
}
