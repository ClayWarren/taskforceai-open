use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const MAX_INSTRUCTION_FILE_BYTES: u64 = 64 * 1024;
const MAX_TOTAL_INSTRUCTION_BYTES: usize = 128 * 1024;
const INSTRUCTION_FILES: &[&str] = &["AGENTS.md", "CLAUDE.md"];

pub(crate) async fn enrich_with_project_instructions(
    workspace: Option<&str>,
    request: String,
) -> String {
    let Some(workspace) = workspace.map(PathBuf::from) else {
        return request;
    };
    let instructions = load_project_instructions(&workspace).await;
    if instructions.is_empty() {
        return request;
    }
    format!(
        "<project_instructions>\n{}\n</project_instructions>\n\n{request}",
        instructions.join("\n\n")
    )
}

async fn load_project_instructions(workspace: &Path) -> Vec<String> {
    let Ok(workspace) = tokio::fs::canonicalize(workspace).await else {
        return Vec::new();
    };
    let ancestors = workspace
        .ancestors()
        .map(Path::to_path_buf)
        .collect::<Vec<_>>();
    let (trusted_root, mut directories) = match ancestors
        .iter()
        .position(|directory| directory.join(".git").exists())
    {
        Some(root_index) => (
            ancestors[root_index].clone(),
            ancestors[..=root_index].to_vec(),
        ),
        None => (workspace.clone(), vec![workspace]),
    };
    directories.reverse();

    let mut seen = BTreeSet::new();
    let mut total = 0_usize;
    let mut loaded = Vec::new();
    for directory in directories {
        for filename in INSTRUCTION_FILES {
            let path = directory.join(filename);
            let Ok(canonical) = tokio::fs::canonicalize(&path).await else {
                continue;
            };
            if !canonical.starts_with(&trusted_root) || !seen.insert(canonical.clone()) {
                continue;
            }
            let Ok(metadata) = tokio::fs::metadata(&canonical).await else {
                // coverage:ignore-line -- canonical target can only disappear in a filesystem race.
                continue;
            };
            if !metadata.is_file() || metadata.len() > MAX_INSTRUCTION_FILE_BYTES {
                continue;
            }
            let Ok(content) = tokio::fs::read_to_string(&canonical).await else {
                continue;
            };
            if content.trim().is_empty()
                || total.saturating_add(content.len()) > MAX_TOTAL_INSTRUCTION_BYTES
            {
                continue;
            }
            total += content.len();
            loaded.push(format!(
                "<instructions_file path=\"{}\">\n{}\n</instructions_file>",
                path.display(),
                content.trim()
            ));
        }
    }
    loaded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn loads_root_to_workspace_instructions() {
        let root = tempfile::tempdir().expect("tempdir");
        tokio::fs::create_dir(root.path().join(".git"))
            .await
            .expect("git marker");
        let nested = root.path().join("apps/tui");
        tokio::fs::create_dir_all(&nested).await.expect("nested");
        tokio::fs::write(root.path().join("AGENTS.md"), "root rule")
            .await
            .expect("root instructions");
        tokio::fs::write(nested.join("CLAUDE.md"), "nested rule")
            .await
            .expect("nested instructions");

        let enriched =
            enrich_with_project_instructions(nested.to_str(), "Do the work".to_string()).await;
        assert!(enriched.contains("root rule"));
        assert!(enriched.contains("nested rule"));
        assert!(enriched.find("root rule") < enriched.find("nested rule"));
        assert!(enriched.ends_with("Do the work"));
    }

    #[tokio::test]
    async fn non_git_workspaces_do_not_load_parent_instructions() {
        let root = tempfile::tempdir().expect("tempdir");
        let workspace = root.path().join("workspace");
        tokio::fs::create_dir(&workspace).await.expect("workspace");
        tokio::fs::write(root.path().join("AGENTS.md"), "untrusted parent")
            .await
            .expect("parent instructions");
        tokio::fs::write(workspace.join("CLAUDE.md"), "workspace rule")
            .await
            .expect("workspace instructions");

        let enriched =
            enrich_with_project_instructions(workspace.to_str(), "Do the work".to_string()).await;

        assert!(!enriched.contains("untrusted parent"));
        assert!(enriched.contains("workspace rule"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn ignores_instruction_symlinks_that_escape_the_project() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().expect("tempdir");
        tokio::fs::create_dir(root.path().join(".git"))
            .await
            .expect("git marker");
        let workspace = root.path().join("workspace");
        tokio::fs::create_dir(&workspace).await.expect("workspace");
        let outside = tempfile::tempdir().expect("outside tempdir");
        let secret = outside.path().join("secret.txt");
        tokio::fs::write(&secret, "local secret")
            .await
            .expect("secret");
        symlink(&secret, workspace.join("AGENTS.md")).expect("outside symlink");

        let enriched =
            enrich_with_project_instructions(workspace.to_str(), "Do the work".to_string()).await;

        assert_eq!(enriched, "Do the work");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn loads_instruction_symlinks_that_stay_inside_the_project() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().expect("tempdir");
        tokio::fs::create_dir(root.path().join(".git"))
            .await
            .expect("git marker");
        let workspace = root.path().join("workspace");
        tokio::fs::create_dir(&workspace).await.expect("workspace");
        let shared = root.path().join("SHARED_INSTRUCTIONS.md");
        tokio::fs::write(&shared, "shared project rule")
            .await
            .expect("shared instructions");
        symlink(&shared, workspace.join("AGENTS.md")).expect("inside symlink");

        let enriched =
            enrich_with_project_instructions(workspace.to_str(), "Do the work".to_string()).await;

        assert!(enriched.contains("shared project rule"));
        assert!(enriched.ends_with("Do the work"));
    }

    #[tokio::test]
    async fn instruction_loader_skips_empty_invalid_oversized_and_excess_content() {
        let root = tempfile::tempdir().expect("tempdir");
        tokio::fs::create_dir(root.path().join(".git"))
            .await
            .expect("git marker");
        let level_one = root.path().join("one");
        let workspace = level_one.join("two");
        tokio::fs::create_dir_all(&workspace)
            .await
            .expect("workspace");

        tokio::fs::write(root.path().join("AGENTS.md"), "  \n")
            .await
            .expect("empty");
        tokio::fs::write(root.path().join("CLAUDE.md"), vec![b'a'; 65 * 1024])
            .await
            .expect("oversized");
        tokio::fs::write(level_one.join("AGENTS.md"), [0xff, 0xfe])
            .await
            .expect("invalid utf8");
        tokio::fs::write(level_one.join("CLAUDE.md"), "a".repeat(60 * 1024))
            .await
            .expect("first large file");
        tokio::fs::write(workspace.join("AGENTS.md"), "b".repeat(60 * 1024))
            .await
            .expect("second large file");
        tokio::fs::write(workspace.join("CLAUDE.md"), "c".repeat(20 * 1024))
            .await
            .expect("excess file");

        let loaded = load_project_instructions(&workspace).await;
        assert_eq!(loaded.len(), 2);
        assert!(loaded.iter().all(|value| !value.contains(&"c".repeat(100))));
    }
}
