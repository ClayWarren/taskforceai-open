use std::io::Write;
use std::path::Path;
use std::process::Stdio;

use tempfile::NamedTempFile;
use thiserror::Error;
use tokio::process::Command;

#[derive(Debug, Error)]
pub enum ExternalEditorError {
    #[error("neither VISUAL nor EDITOR is set")]
    MissingEditor,
    #[error("external editor IO: {0}")]
    Io(#[from] std::io::Error),
    #[error("external editor exited with {0}")]
    Failed(std::process::ExitStatus),
}

// coverage:ignore-start -- spawns the user's configured interactive editor process.
pub async fn edit(seed: &str, cwd: Option<&Path>) -> Result<String, ExternalEditorError> {
    let editor = std::env::var("VISUAL")
        .or_else(|_| std::env::var("EDITOR"))
        .map_err(|_| ExternalEditorError::MissingEditor)?;
    let mut file = NamedTempFile::new()?;
    file.write_all(seed.as_bytes())?;
    file.flush()?;

    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", &format!("{editor} \"{}\"", file.path().display())]);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let mut command = Command::new(shell);
        command
            .arg("-lc")
            .arg(format!("exec {editor} \"$1\""))
            .arg("taskforceai-editor")
            .arg(file.path());
        command
    };
    if let Some(cwd) = cwd.filter(|cwd| cwd.is_dir()) {
        command.current_dir(cwd);
    }
    let status = command
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await?;
    if !status.success() {
        return Err(ExternalEditorError::Failed(status));
    }
    Ok(std::fs::read_to_string(file.path())?)
}
// coverage:ignore-end
