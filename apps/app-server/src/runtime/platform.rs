use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::protocol::{MemorySourceRecord, PluginRecord, SkillRecord};

use super::error::RuntimeError;
use super::util::{MAX_AUDIO_SIZE, MAX_DOCUMENT_SIZE, MAX_IMAGE_SIZE, MAX_VIDEO_SIZE};

pub(crate) fn memory_source_candidates() -> Vec<(String, PathBuf)> {
    let mut sources = Vec::new();
    let mut seen = BTreeSet::new();
    if let Ok(cwd) = std::env::current_dir() {
        for dir in cwd.ancestors() {
            push_memory_source(&mut sources, &mut seen, "project", dir.join("AGENTS.md"));
            push_memory_source(&mut sources, &mut seen, "project", dir.join("CLAUDE.md"));
            push_memory_source(
                &mut sources,
                &mut seen,
                "repo",
                dir.join(".agents").join("MEMORY.md"),
            );
        }
    } // coverage:ignore-line
    if let Some(home) = home_dir() {
        push_memory_source(
            &mut sources,
            &mut seen,
            "user",
            home.join(".agents").join("MEMORY.md"),
        );
        push_memory_source(
            &mut sources,
            &mut seen,
            "user",
            home.join(".codex").join("AGENTS.md"),
        );
        push_memory_source(
            &mut sources,
            &mut seen,
            "user",
            home.join(".codex")
                .join("memories")
                .join("memory_summary.md"),
        );
        push_memory_source(
            &mut sources,
            &mut seen,
            "user",
            home.join(".codex").join("memories").join("MEMORY.md"),
        );
        push_memory_source(
            &mut sources,
            &mut seen,
            "user",
            home.join(".taskforceai")
                .join("screen-memory")
                .join("MEMORY.md"),
        );
    }
    push_memory_source(
        &mut sources,
        &mut seen,
        "admin",
        PathBuf::from("/etc/codex/AGENTS.md"),
    );
    sources
}

pub(crate) fn push_memory_source(
    sources: &mut Vec<(String, PathBuf)>,
    seen: &mut BTreeSet<PathBuf>,
    scope: &str,
    path: PathBuf,
) {
    if seen.insert(path.clone()) {
        sources.push((scope.to_string(), path));
    }
}

pub(crate) fn memory_source_record(scope: String, path: PathBuf) -> MemorySourceRecord {
    let metadata = fs::metadata(&path).ok();
    let exists = metadata.is_some();
    let bytes = metadata
        .map(|metadata| usize::try_from(metadata.len()).unwrap_or(usize::MAX))
        .unwrap_or(0);
    MemorySourceRecord {
        scope,
        path: path.display().to_string(),
        exists,
        bytes,
        estimated_tokens: bytes.saturating_add(3) / 4,
    }
}

pub(crate) fn memory_suggestions(sources: &[MemorySourceRecord]) -> Vec<String> {
    let found_count = sources.iter().filter(|source| source.exists).count();
    let large_count = sources
        .iter()
        .filter(|source| source.estimated_tokens > 5_000)
        .count();
    let mut suggestions = Vec::new();
    if found_count == 0 {
        suggestions.push(
            "No memory files were found. Add AGENTS.md or .agents/MEMORY.md to document durable project behavior.".to_string(),
        );
    }
    if large_count > 0 {
        suggestions.push(
            "Some memory files are large; move detailed workflows into skills so they load only when needed.".to_string(),
        );
    }
    suggestions.push(
        "Keep root memory short and stable; put path-specific or workflow-specific guidance near the files or in skills.".to_string(),
    );
    suggestions
}

pub(crate) fn expand_user_path(value: &str) -> PathBuf {
    if value == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(value)
}

pub(crate) fn detect_attachment_mime_type(path: &Path, data: &[u8]) -> String {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return "image/png".to_string();
    }
    if data.starts_with(&[0xff, 0xd8, 0xff]) {
        return "image/jpeg".to_string();
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return "image/gif".to_string();
    }
    if data.starts_with(b"RIFF") && data.get(8..12).is_some_and(|value| value == b"WEBP") {
        return "image/webp".to_string();
    }
    if data.starts_with(b"RIFF") && data.get(8..12).is_some_and(|value| value == b"WAVE") {
        return "audio/wav".to_string();
    }
    if data.starts_with(b"ID3") || data.starts_with(&[0xff, 0xfb]) {
        return "audio/mpeg".to_string();
    }
    if extension
        .as_deref()
        .is_some_and(is_iso_bmff_audio_extension)
        && data.get(4..8).is_some_and(|value| value == b"ftyp")
    {
        return "audio/mp4".to_string();
    }
    if data.get(4..8).is_some_and(|value| value == b"ftyp") {
        return "video/mp4".to_string();
    }
    if let Some(extension) = extension.as_deref() {
        match extension {
            "txt" => return "text/plain".to_string(),
            "md" | "markdown" => return "text/markdown".to_string(),
            "csv" => return "text/csv".to_string(),
            "html" | "htm" => return "text/html".to_string(),
            "css" => return "text/css".to_string(),
            "json" => return "application/json".to_string(),
            "xml" => return "application/xml".to_string(),
            "js" | "mjs" | "cjs" => return "application/javascript".to_string(),
            "webm" => return "video/webm".to_string(),
            "mov" => return "video/quicktime".to_string(),
            "m4a" => return "audio/mp4".to_string(),
            "aac" => return "audio/aac".to_string(),
            "ogg" | "opus" => return "audio/ogg".to_string(),
            "flac" => return "audio/flac".to_string(),
            _ => {}
        }
    }
    if data
        .iter()
        .all(|byte| matches!(*byte, b'\t' | b'\n' | b'\r' | 0x20..=0x7e))
    {
        return "text/plain".to_string();
    }
    "application/octet-stream".to_string()
}

fn is_iso_bmff_audio_extension(extension: &str) -> bool {
    matches!(extension, "m4a" | "aac")
}

pub(crate) fn allowed_attachment_mime_type(mime_type: &str) -> bool {
    matches!(
        mime_type,
        "image/jpeg"
            | "image/png"
            | "image/gif"
            | "image/webp"
            | "audio/wav"
            | "audio/mpeg"
            | "audio/mp3"
            | "audio/mp4"
            | "audio/aac"
            | "audio/webm"
            | "audio/ogg"
            | "audio/opus"
            | "audio/flac"
            | "video/mp4"
            | "video/webm"
            | "video/ogg"
            | "video/quicktime"
            | "text/plain"
            | "text/html"
            | "text/css"
            | "application/json"
            | "application/xml"
            | "application/javascript"
            | "text/markdown"
            | "text/csv"
    )
}

pub(crate) fn attachment_size_limit(mime_type: &str) -> usize {
    if mime_type.starts_with("image/") {
        MAX_IMAGE_SIZE
    } else if mime_type.starts_with("audio/") {
        MAX_AUDIO_SIZE
    } else if mime_type.starts_with("video/") {
        MAX_VIDEO_SIZE
    } else {
        MAX_DOCUMENT_SIZE
    }
}

pub(crate) fn context_suggestions(
    run_count: usize,
    pending_count: usize,
    skill_count: usize,
) -> Vec<String> {
    let mut suggestions = vec![
        "Use focused file reads and searches; file contents dominate context usage.".to_string(),
        "Use Browser/Computer adapters for visual verification instead of pasting large screenshots or page dumps.".to_string(),
        "Use subagents for broad research so only their compact summary returns to the main thread.".to_string(),
    ];
    if run_count > 25 {
        suggestions.push("Use /search before reading long local history.".to_string());
    }
    if pending_count > 0 {
        suggestions
            .push("Use /pending to inspect queued prompts before retrying work.".to_string());
    }
    if skill_count > 10 {
        suggestions.push(
            "Mention a specific skill when you know the workflow; keep skill bodies focused."
                .to_string(),
        );
    }
    suggestions
}

pub(crate) fn skill_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        for ancestor in cwd.ancestors() {
            roots.push(ancestor.join(".agents").join("skills"));
            if ancestor.join(".git").exists() {
                break;
            }
        }
    } // coverage:ignore-line
    if let Some(home) = home_dir() {
        roots.push(home.join(".agents").join("skills"));
    }
    roots.push(PathBuf::from("/etc/codex/skills"));
    roots
}

pub(crate) fn skill_source(root: &Path) -> String {
    if root.starts_with("/etc/codex") {
        return "admin".to_string();
    }
    if home_dir()
        .map(|home| root == home.join(".agents").join("skills"))
        .unwrap_or(false)
    {
        return "user".to_string();
    }
    "repo".to_string()
}

pub(crate) fn skill_markdown_files(root: &Path) -> Result<Vec<PathBuf>, RuntimeError> {
    let mut files = Vec::new();
    let entries = fs::read_dir(root)?;
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let skill_file = path.join("SKILL.md");
            if skill_file.exists() {
                files.push(skill_file);
            }
        } // coverage:ignore-line
    }
    Ok(files)
}

pub(crate) fn parse_skill_file(
    path: &Path,
    source: &str,
) -> Result<Option<SkillRecord>, RuntimeError> {
    let content = fs::read_to_string(path)?;
    let Some(frontmatter) = frontmatter(&content) else {
        return Ok(None);
    };
    let Some(name) = frontmatter_value(frontmatter, "name") else {
        return Ok(None);
    };
    let Some(description) = frontmatter_value(frontmatter, "description") else {
        return Ok(None);
    };
    Ok(Some(SkillRecord {
        name,
        description,
        path: path.to_string_lossy().to_string(),
        source: source.to_string(),
        enabled: true,
    }))
}

pub(crate) fn plugin_manifest_files() -> Result<Vec<PathBuf>, RuntimeError> {
    let mut manifests = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        collect_named_files(&cwd, "plugin.json", 6, &mut manifests)?;
    } // coverage:ignore-line
    if let Some(home) = home_dir() {
        collect_named_files(
            &home.join(".codex").join("plugins"),
            "plugin.json",
            9,
            &mut manifests,
            // coverage:ignore-start
        )?;
    }
    // coverage:ignore-end
    Ok(manifests)
}

pub(crate) fn collect_named_files(
    root: &Path,
    file_name: &str,
    max_depth: usize,
    out: &mut Vec<PathBuf>,
) -> Result<(), RuntimeError> {
    if max_depth == 0 || !root.exists() {
        return Ok(());
    }
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if should_skip_plugin_scan_dir(&path) {
                continue;
            }
            collect_named_files(&path, file_name, max_depth - 1, out)?;
        } else if path.file_name().and_then(|name| name.to_str()) == Some(file_name) {
            out.push(path);
        }
    }
    Ok(())
}

fn should_skip_plugin_scan_dir(path: &Path) -> bool {
    // coverage:ignore-line
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false; // coverage:ignore-line
    };
    matches!(
        name,
        ".git"
            | ".hg"
            | ".svn"
            | ".next"
            | ".turbo"
            | "build"
            | "coverage"
            | "dist"
            | "node_modules"
            | "target"
            | "vendor"
    )
}

pub(crate) fn parse_plugin_manifest(path: &Path) -> Result<Option<PluginRecord>, RuntimeError> {
    let content = fs::read_to_string(path)?;
    let manifest: Value = serde_json::from_str(&content)?;
    let manifest_id = manifest
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| manifest.get("name").and_then(Value::as_str))
        .unwrap_or("unknown")
        .to_string();
    let id = plugin_id_for_manifest(path, &manifest_id);
    let name = manifest
        .pointer("/interface/displayName")
        .and_then(Value::as_str)
        .or_else(|| manifest.get("displayName").and_then(Value::as_str))
        .or_else(|| manifest.get("name").and_then(Value::as_str))
        .unwrap_or(&manifest_id)
        .to_string();
    let description = manifest
        .pointer("/interface/shortDescription")
        .and_then(Value::as_str)
        .or_else(|| manifest.get("description").and_then(Value::as_str))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let enabled = manifest
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    Ok(Some(PluginRecord {
        id,
        name,
        enabled,
        path: path.to_string_lossy().to_string(),
        description,
        source: plugin_source(path),
    }))
}

pub(crate) fn plugin_id_for_manifest(path: &Path, manifest_id: &str) -> String {
    let Some(marketplace) = plugin_marketplace(path) else {
        return manifest_id.to_string();
    };
    if manifest_id.contains('@') {
        manifest_id.to_string()
    } else {
        format!("{manifest_id}@{marketplace}")
    }
}

pub(crate) fn plugin_marketplace(path: &Path) -> Option<String> {
    let mut components = path
        .components()
        .filter_map(|component| component.as_os_str().to_str());
    while let Some(component) = components.next() {
        if component == "cache" {
            return components.next().map(ToOwned::to_owned);
        }
    }
    None
}

pub(crate) fn plugin_source(path: &Path) -> Option<String> {
    plugin_marketplace(path).or_else(|| {
        if path.to_string_lossy().contains("/.codex/plugins") {
            Some("local".to_string())
        } else {
            None
        }
    })
}

pub(crate) fn normalize_plugin_id(value: &str) -> Result<String, RuntimeError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(RuntimeError::invalid_params("plugin id is required"));
    }
    Ok(value.to_string())
}

pub(crate) fn plugin_enabled_config() -> BTreeMap<String, bool> {
    let Some(home) = home_dir() else {
        return BTreeMap::new();
    }; // coverage:ignore-line
    let Ok(content) = fs::read_to_string(home.join(".codex").join("config.toml")) else {
        return BTreeMap::new(); // coverage:ignore-line
    };
    parse_plugin_enabled_config(&content)
}

pub(crate) fn parse_plugin_enabled_config(content: &str) -> BTreeMap<String, bool> {
    let mut out = BTreeMap::new();
    let mut current_plugin: Option<String> = None;
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            current_plugin = line
                .strip_prefix("[plugins.\"")
                .and_then(|rest| rest.strip_suffix("\"]"))
                .map(ToOwned::to_owned);
            continue;
        }
        let Some(plugin_id) = current_plugin.as_ref() else {
            continue;
        };
        let Some(raw_enabled) = line.strip_prefix("enabled") else {
            continue;
        };
        let Some(raw_enabled) = raw_enabled.trim().strip_prefix('=') else {
            continue;
        };
        match raw_enabled.trim() {
            "true" => {
                out.insert(plugin_id.clone(), true);
            }
            "false" => {
                out.insert(plugin_id.clone(), false);
            }
            _ => {}
        }
    }
    out
}

pub(crate) fn frontmatter(content: &str) -> Option<&str> {
    let mut lines = content.lines();
    if lines.next()? != "---" {
        return None;
    }
    let start = content.find('\n')? + 1;
    let end = content[start..].find("\n---")? + start;
    Some(&content[start..end])
}

pub(crate) fn frontmatter_value(frontmatter: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    frontmatter.lines().find_map(|line| {
        let line = line.trim();
        let value = line.strip_prefix(&prefix)?.trim();
        Some(value.trim_matches('"').trim_matches('\'').to_string())
    })
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}
