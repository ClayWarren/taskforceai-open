use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub bare: bool,
    pub detached: bool,
    pub prunable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeListResult {
    pub repository_root: String,
    pub worktrees: Vec<GitWorktree>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeCreateResult {
    pub repository_root: String,
    pub worktree: GitWorktree,
    pub message: String,
}

pub fn resolve_repository_root(repository: &Path) -> Result<PathBuf, String> {
    let repository = repository
        .canonicalize()
        .map_err(|error| format!("Failed to resolve repository path: {error}"))?;
    if !repository.is_dir() {
        return Err("Repository path must be an existing directory.".to_string());
    }
    let output = git_command(&repository, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Err(git_error("rev-parse --show-toplevel", &output.stderr));
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        return Err("Repository path is not inside a Git repository.".to_string());
    }
    Ok(PathBuf::from(root))
}

pub fn list_git_worktrees(repository: &Path) -> Result<GitWorktreeListResult, String> {
    let root = resolve_repository_root(repository)?;
    let output = git_command(&root, &["worktree", "list", "--porcelain"])?;
    if !output.status.success() {
        return Err(git_error("worktree list --porcelain", &output.stderr));
    }
    Ok(GitWorktreeListResult {
        repository_root: root.display().to_string(),
        worktrees: parse_worktree_porcelain(&String::from_utf8_lossy(&output.stdout)),
    })
}

pub fn create_git_worktree(
    repository: &Path,
    requested_path: Option<&str>,
    requested_branch: Option<&str>,
    requested_base_ref: Option<&str>,
) -> Result<GitWorktreeCreateResult, String> {
    let root = resolve_repository_root(repository)?;
    let branch = requested_branch
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(default_worktree_branch);
    let target = requested_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_worktree_path(&root, &branch));
    let target = if target.is_absolute() {
        target
    } else {
        root.parent().unwrap_or(&root).join(target)
    };
    if target.exists() {
        return Err(format!(
            "Worktree path already exists: {}",
            target.display()
        ));
    }
    let base_ref = requested_base_ref
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("HEAD");
    let target_arg = target.to_string_lossy().to_string();
    let args = [
        "worktree",
        "add",
        "-b",
        branch.as_str(),
        "--",
        target_arg.as_str(),
        base_ref,
    ];
    let output = git_command(&root, &args)?;
    if !output.status.success() {
        return Err(git_error("worktree add", &output.stderr));
    }

    let created = target
        .canonicalize()
        .map_err(|error| format!("Failed to resolve created worktree: {error}"))?;
    let list = list_git_worktrees(&root)?;
    let created_display = created.display().to_string();
    let worktree = list
        .worktrees
        .into_iter()
        .find(|worktree| worktree.path == created_display)
        .unwrap_or(GitWorktree {
            path: created_display,
            head: None,
            branch: Some(branch),
            bare: false,
            detached: false,
            prunable: false,
        });

    Ok(GitWorktreeCreateResult {
        repository_root: root.display().to_string(),
        worktree,
        message: "Git worktree created.".to_string(),
    })
}

fn parse_worktree_porcelain(output: &str) -> Vec<GitWorktree> {
    let mut worktrees = Vec::new();
    let mut current: Option<GitWorktree> = None;

    for line in output.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            if let Some(worktree) = current.take() {
                worktrees.push(finalize_worktree(worktree));
            }
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(worktree) = current.replace(GitWorktree {
                path: path.to_string(),
                head: None,
                branch: None,
                bare: false,
                detached: false,
                prunable: false,
            }) {
                worktrees.push(finalize_worktree(worktree));
            }
            continue;
        }
        let Some(worktree) = current.as_mut() else {
            continue;
        };
        if let Some(head) = line.strip_prefix("HEAD ") {
            worktree.head = Some(head.to_string());
        } else if let Some(branch) = line.strip_prefix("branch ") {
            worktree.branch = Some(
                branch
                    .strip_prefix("refs/heads/")
                    .unwrap_or(branch)
                    .to_string(),
            );
        } else if line == "bare" {
            worktree.bare = true;
        } else if line == "detached" {
            worktree.detached = true;
        } else if line.starts_with("prunable") {
            worktree.prunable = true;
        }
    }

    if let Some(worktree) = current.take() {
        worktrees.push(finalize_worktree(worktree));
    }
    worktrees
}

fn finalize_worktree(mut worktree: GitWorktree) -> GitWorktree {
    worktree.detached |= worktree.branch.is_none() && !worktree.bare;
    worktree
}

fn default_worktree_branch() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("codex/worktree-{millis}")
}

fn default_worktree_path(root: &Path, branch: &str) -> PathBuf {
    let repo_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("worktree");
    let suffix = branch_path_suffix(branch);
    root.parent()
        .unwrap_or(root)
        .join(format!("{repo_name}-{suffix}"))
}

fn branch_path_suffix(branch: &str) -> String {
    let suffix = branch
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if suffix.is_empty() {
        "worktree".to_string()
    } else {
        suffix
    }
}

fn git_command(root: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git")
        .arg("-c")
        .arg("core.quotePath=false")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| format!("git command unavailable: {error}"))
}

fn git_error(command: &str, stderr: &[u8]) -> String {
    let detail = String::from_utf8_lossy(stderr).trim().to_string();
    if detail.is_empty() {
        format!("git {command} failed")
    } else {
        format!("git {command} failed: {detail}")
    }
}

#[cfg(test)]
#[path = "worktrees_tests.rs"]
mod tests;
