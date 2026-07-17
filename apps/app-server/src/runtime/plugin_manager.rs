use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::error::RuntimeError;
use super::platform::{collect_named_files, home_dir, parse_plugin_manifest};

const MANAGED_DIRECTORY: &str = "installed";
const SOURCE_METADATA: &str = ".taskforceai-plugin-source.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ManagedPlugin {
    pub id: String,
    pub name: String,
    pub directory: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginSourceMetadata {
    source: String,
    kind: PluginSourceKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PluginSourceKind {
    Git,
    Local,
}

pub(crate) fn install_plugin(source: &str) -> Result<ManagedPlugin, RuntimeError> {
    let source = source.trim();
    if source.is_empty() {
        return Err(plugin_error("plugin source is required"));
    }
    let root = managed_plugins_root()?;
    fs::create_dir_all(&root)?;
    let temporary = temporary_directory(&root, "install");
    let (stored_source, kind) = if let Some(remote) = normalized_git_source(source) {
        clone_repository(&remote, &temporary)?;
        (remote, PluginSourceKind::Git)
    } else {
        let source_path = PathBuf::from(source).canonicalize().map_err(|error| {
            plugin_error(format!("cannot read plugin source {source}: {error}"))
        })?;
        let source_root = plugin_source_root(&source_path);
        copy_directory(&source_root, &temporary)?;
        (
            source_root.to_string_lossy().to_string(),
            PluginSourceKind::Local,
        )
    };

    let plugin = inspect_plugin(&temporary).inspect_err(|_| {
        let _ = fs::remove_dir_all(&temporary);
    })?;
    let destination = root.join(safe_plugin_directory_name(&plugin.id));
    if destination.exists() {
        let _ = fs::remove_dir_all(&temporary);
        return Err(plugin_error(format!(
            "plugin {} is already installed; use /plugins update {}",
            plugin.id, plugin.id
        )));
    }
    write_source_metadata(
        &temporary,
        &PluginSourceMetadata {
            source: stored_source,
            kind,
        },
    )?;
    fs::rename(&temporary, &destination).map_err(|error| {
        let _ = fs::remove_dir_all(&temporary);
        plugin_error(format!("could not finalize plugin installation: {error}"))
    })?;
    Ok(ManagedPlugin {
        directory: destination,
        ..plugin
    })
}

pub(crate) fn update_plugin(manifest_path: &Path) -> Result<ManagedPlugin, RuntimeError> {
    let directory = managed_directory_for_manifest(manifest_path)?;
    let metadata = read_source_metadata(&directory)?;
    match metadata.kind {
        PluginSourceKind::Git => {
            let output = Command::new("git")
                .args(["-C"])
                .arg(&directory)
                .args(["pull", "--ff-only"])
                .output()
                .map_err(|error| plugin_error(format!("could not start git: {error}")))?;
            if !output.status.success() {
                return Err(plugin_error(command_failure("git pull", &output)));
            }
        }
        PluginSourceKind::Local => {
            let source = PathBuf::from(&metadata.source)
                .canonicalize()
                .map_err(|error| plugin_error(format!("cannot read plugin source: {error}")))?;
            let root = managed_plugins_root()?;
            let temporary = temporary_directory(&root, "update");
            copy_directory(&source, &temporary)?;
            inspect_plugin(&temporary)?;
            write_source_metadata(&temporary, &metadata)?;
            replace_directory(&directory, &temporary)?;
        }
    }
    let plugin = inspect_plugin(&directory)?;
    Ok(ManagedPlugin {
        directory,
        ..plugin
    })
}

pub(crate) fn uninstall_plugin(manifest_path: &Path) -> Result<ManagedPlugin, RuntimeError> {
    let directory = managed_directory_for_manifest(manifest_path)?;
    let plugin = inspect_plugin(&directory)?;
    fs::remove_dir_all(&directory)
        .map_err(|error| plugin_error(format!("could not uninstall {}: {error}", plugin.id)))?;
    Ok(ManagedPlugin {
        directory,
        ..plugin
    })
}

fn managed_plugins_root() -> Result<PathBuf, RuntimeError> {
    home_dir()
        .map(|home| home.join(".codex").join("plugins").join(MANAGED_DIRECTORY))
        .ok_or_else(|| plugin_error("home directory is unavailable"))
}

fn inspect_plugin(directory: &Path) -> Result<ManagedPlugin, RuntimeError> {
    let mut manifests = Vec::new();
    collect_named_files(directory, "plugin.json", 8, &mut manifests)?;
    manifests.sort();
    let manifest = manifests
        .first()
        .ok_or_else(|| plugin_error("source does not contain a plugin.json manifest"))?;
    let plugin = parse_plugin_manifest(manifest)?
        .ok_or_else(|| plugin_error("plugin manifest is missing an id or name"))?;
    Ok(ManagedPlugin {
        id: plugin.id,
        name: plugin.name,
        directory: directory.to_path_buf(),
    })
}

fn plugin_source_root(source: &Path) -> PathBuf {
    if source.is_file() {
        let parent = source.parent().unwrap_or(source);
        if parent.file_name().and_then(|name| name.to_str()) == Some(".codex-plugin") {
            return parent.parent().unwrap_or(parent).to_path_buf();
        }
        return parent.to_path_buf();
    }
    source.to_path_buf()
}

fn normalized_git_source(source: &str) -> Option<String> {
    if let Some(repository) = source.strip_prefix("github:") {
        return Some(format!(
            "https://github.com/{}.git",
            repository.trim().trim_end_matches(".git")
        ));
    }
    (source.starts_with("https://")
        || source.starts_with("http://")
        || source.starts_with("ssh://")
        || source.starts_with("git@"))
    .then(|| source.to_string())
}

fn clone_repository(source: &str, destination: &Path) -> Result<(), RuntimeError> {
    let output = Command::new("git")
        .args(["clone", "--depth", "1", "--"])
        .arg(source)
        .arg(destination)
        .output()
        .map_err(|error| plugin_error(format!("could not start git: {error}")))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(plugin_error(command_failure("git clone", &output)))
    }
}

fn command_failure(command: &str, output: &std::process::Output) -> String {
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if detail.is_empty() {
        format!("{command} failed with {}", output.status)
    } else {
        format!("{command} failed: {detail}")
    }
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), RuntimeError> {
    if !source.is_dir() {
        return Err(plugin_error(format!(
            "plugin source is not a directory: {}",
            source.display()
        )));
    }
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        if matches!(name.to_str(), Some(".git" | "node_modules" | "target")) {
            continue;
        }
        let source_path = entry.path();
        let destination_path = destination.join(&name);
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            copy_directory(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path)?;
        }
    }
    Ok(())
}

fn managed_directory_for_manifest(manifest_path: &Path) -> Result<PathBuf, RuntimeError> {
    let root = managed_plugins_root()?;
    let canonical_root = root
        .canonicalize()
        .map_err(|_| plugin_error("managed plugin directory does not exist"))?;
    let canonical_manifest = manifest_path
        .canonicalize()
        .map_err(|error| plugin_error(format!("plugin manifest is unavailable: {error}")))?;
    canonical_manifest
        .ancestors()
        .find(|ancestor| ancestor.parent() == Some(canonical_root.as_path()))
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            plugin_error(
                "that plugin is not managed by TaskForceAI; disable it instead of uninstalling it",
            )
        })
}

fn replace_directory(destination: &Path, replacement: &Path) -> Result<(), RuntimeError> {
    let parent = destination
        .parent()
        .ok_or_else(|| plugin_error("managed plugin has no parent directory"))?;
    let backup = temporary_directory(parent, "backup");
    fs::rename(destination, &backup)
        .map_err(|error| plugin_error(format!("could not prepare plugin update: {error}")))?;
    if let Err(error) = fs::rename(replacement, destination) {
        let _ = fs::rename(&backup, destination);
        return Err(plugin_error(format!(
            "could not finalize plugin update: {error}"
        )));
    }
    let _ = fs::remove_dir_all(backup);
    Ok(())
}

fn temporary_directory(root: &Path, operation: &str) -> PathBuf {
    root.join(format!(
        ".{operation}-{}-{:016x}",
        std::process::id(),
        rand::random::<u64>()
    ))
}

fn safe_plugin_directory_name(id: &str) -> String {
    let value = id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let value = value.trim_matches(['-', '.']).to_string();
    if value.is_empty() {
        "plugin".to_string()
    } else {
        value
    }
}

fn write_source_metadata(
    directory: &Path,
    metadata: &PluginSourceMetadata,
) -> Result<(), RuntimeError> {
    fs::write(
        directory.join(SOURCE_METADATA),
        serde_json::to_vec_pretty(metadata)?,
    )?;
    Ok(())
}

fn read_source_metadata(directory: &Path) -> Result<PluginSourceMetadata, RuntimeError> {
    let path = directory.join(SOURCE_METADATA);
    let content = fs::read(&path).map_err(|error| {
        plugin_error(format!(
            "plugin source metadata is unavailable at {}: {error}",
            path.display()
        ))
    })?;
    serde_json::from_slice(&content)
        .map_err(|error| plugin_error(format!("plugin source metadata is invalid: {error}")))
}

fn plugin_error(message: impl Into<String>) -> RuntimeError {
    RuntimeError {
        code: -32021,
        message: format!("plugin error: {}", message.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_and_inspects_local_plugin_packages() {
        let source = tempfile::tempdir().expect("source tempdir");
        let manifest_dir = source.path().join(".codex-plugin");
        fs::create_dir_all(&manifest_dir).expect("manifest directory");
        fs::write(
            manifest_dir.join("plugin.json"),
            r#"{"id":"sample/plugin","name":"Sample"}"#,
        )
        .expect("manifest");
        fs::write(source.path().join("SKILL.md"), "skill").expect("skill");
        let destination = tempfile::tempdir().expect("destination tempdir");

        copy_directory(source.path(), destination.path()).expect("copy plugin");
        let plugin = inspect_plugin(destination.path()).expect("inspect plugin");

        assert_eq!(plugin.id, "sample/plugin");
        assert_eq!(plugin.name, "Sample");
        assert!(destination.path().join("SKILL.md").exists());
        assert_eq!(safe_plugin_directory_name(&plugin.id), "sample-plugin");
    }

    #[test]
    fn normalizes_supported_git_sources() {
        assert_eq!(
            normalized_git_source("github:owner/repo"),
            Some("https://github.com/owner/repo.git".to_string())
        );
        assert_eq!(
            normalized_git_source("git@github.com:owner/repo.git"),
            Some("git@github.com:owner/repo.git".to_string())
        );
        assert_eq!(normalized_git_source("/tmp/plugin"), None);
    }
}
