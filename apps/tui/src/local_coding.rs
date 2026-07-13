use std::path::{Path, PathBuf};

use taskforceai_app_client::{local_coding, AppClientError, AppServerClient};

pub async fn enable_workspace_tools(
    client: &mut AppServerClient,
    workspace: impl AsRef<Path>,
) -> Result<PathBuf, AppClientError> {
    Ok(local_coding::enable_workspace_tools(client, workspace)
        .await?
        .workspace)
}

pub fn default_workspace() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn local_runs_allowed() -> bool {
    std::env::var("TASKFORCEAI_ALLOW_LOCAL_RUNS")
        .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::default_workspace;

    #[test]
    fn default_workspace_uses_current_directory() {
        assert!(default_workspace().is_absolute() || default_workspace() == Path::new("."));
    }
}
