use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use crate::api::{ApiArtifact, ApiArtifactVersion};
use crate::protocol::*;

use super::error::RuntimeError;
use super::format::*;
use super::util::{command_message, command_unhandled};

const ARTIFACT_LIST_LIMIT: usize = 10;

impl super::AppRuntime {
    pub(crate) async fn handle_artifacts_command(
        &mut self,
        args: &[&str],
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let action = args
            .first()
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_else(|| "list".to_string());
        match action.as_str() {
            "list" | "ls" | "recent" | "status" => self.handle_artifact_list_command().await,
            "show" | "detail" | "details" | "get" => {
                let artifact_id = required_artifact_id(args.get(1).copied())?;
                self.handle_artifact_detail_command(artifact_id).await
            }
            "share" | "link" | "public-link" => {
                let artifact_id = required_artifact_id(args.get(1).copied())?;
                self.handle_artifact_share_command(artifact_id).await
            }
            "delete" | "remove" | "rm" => {
                let artifact_id = required_artifact_id(args.get(1).copied())?;
                self.handle_artifact_delete_command(artifact_id).await
            }
            "download" | "save" => {
                let artifact_id = required_artifact_id(args.get(1).copied())?;
                self.handle_artifact_download_command(artifact_id, args.get(2).copied())
                    .await
            }
            _ => Ok(command_unhandled(
                "Artifacts",
                "Usage: /artifacts [list|show <id>|share <id>|delete <id>|download <id> [path]]"
                    .to_string(),
            )),
        }
    }

    async fn handle_artifact_list_command(&mut self) -> Result<CommandExecuteResult, RuntimeError> {
        let Some(token) = self.auth_token()? else {
            return Ok(command_unhandled(
                "Artifacts",
                "Login required. Use /login first.",
            ));
        };
        let artifacts = self
            .api_client
            .list_artifacts(&token, ARTIFACT_LIST_LIMIT)
            .await
            .map_err(|err| RuntimeError::network(err.detailed_message()))?;
        Ok(command_message("Artifacts", format_artifacts(&artifacts)))
    }

    async fn handle_artifact_detail_command(
        &mut self,
        artifact_id: &str,
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let Some(token) = self.artifact_auth_token()? else {
            return Ok(artifact_login_required());
        };
        let artifact = self
            .api_client
            .get_artifact(&token, artifact_id)
            .await
            .map_err(|err| RuntimeError::network(err.detailed_message()))?;
        let versions = self
            .api_client
            .list_artifact_versions(&token, artifact_id)
            .await
            .map_err(|err| RuntimeError::network(err.detailed_message()))?;
        Ok(command_message(
            "Artifact",
            format_artifact_detail(&artifact, &versions),
        ))
    }

    async fn handle_artifact_share_command(
        &mut self,
        artifact_id: &str,
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let Some(token) = self.artifact_auth_token()? else {
            return Ok(artifact_login_required());
        };
        let share = self
            .api_client
            .create_artifact_public_link(&token, artifact_id)
            .await
            .map_err(|err| RuntimeError::network(err.detailed_message()))?;
        Ok(command_message(
            "Artifact Link",
            format!(
                "Public link created for {}.\n{}\ntoken: {}",
                share.artifact.title, share.url, share.token
            ),
        ))
    }

    async fn handle_artifact_delete_command(
        &mut self,
        artifact_id: &str,
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let Some(token) = self.artifact_auth_token()? else {
            return Ok(artifact_login_required());
        };
        self.api_client
            .delete_artifact(&token, artifact_id)
            .await
            .map_err(|err| RuntimeError::network(err.detailed_message()))?;
        Ok(command_message(
            "Artifact Deleted",
            format!("Deleted artifact {artifact_id}."),
        ))
    }

    async fn handle_artifact_download_command(
        &mut self,
        artifact_id: &str,
        output_path: Option<&str>,
    ) -> Result<CommandExecuteResult, RuntimeError> {
        let Some(token) = self.artifact_auth_token()? else {
            return Ok(artifact_login_required());
        };
        let artifact = self
            .api_client
            .get_artifact(&token, artifact_id)
            .await
            .map_err(|err| RuntimeError::network(err.detailed_message()))?;
        let version = self.current_artifact_version(&token, &artifact).await?;
        let Some(file_id) = version.file_id.as_deref().filter(|value| !value.is_empty()) else {
            return Ok(command_unhandled(
                "Artifact Download",
                "Artifact has no downloadable file version.",
            ));
        };
        let bytes = self
            .api_client
            .download_file_content(&token, file_id)
            .await
            .map_err(|err| RuntimeError::network(err.detailed_message()))?;
        let path = output_path
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(default_download_filename(&artifact, &version)));
        write_new_file(&path, &bytes)?;
        Ok(command_message(
            "Artifact Downloaded",
            format!("Saved {} bytes to {}.", bytes.len(), path.display()),
        ))
    }

    fn artifact_auth_token(&self) -> Result<Option<String>, RuntimeError> {
        self.auth_token()
    }

    async fn current_artifact_version(
        &mut self,
        token: &str,
        artifact: &ApiArtifact,
    ) -> Result<ApiArtifactVersion, RuntimeError> {
        if let Some(version) = artifact.current_version.clone() {
            return Ok(version);
        }
        let versions = self
            .api_client
            .list_artifact_versions(token, &artifact.id)
            .await
            .map_err(|err| RuntimeError::network(err.detailed_message()))?;
        select_current_version(artifact, versions).ok_or_else(|| {
            RuntimeError::not_found("artifact has no versions available for download")
        })
    }
}

fn required_artifact_id(value: Option<&str>) -> Result<&str, RuntimeError> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Err(RuntimeError::invalid_params("artifact id is required"));
    };
    Ok(value)
}

fn artifact_login_required() -> CommandExecuteResult {
    command_unhandled("Artifacts", "Login required. Use /login first.")
}

fn format_artifact_detail(artifact: &ApiArtifact, versions: &[ApiArtifactVersion]) -> String {
    let mut lines = vec![
        format!("id: {}", artifact.id),
        format!("title: {}", artifact.title),
        format!("type: {}", artifact.artifact_type),
        format!("status: {}", artifact.status),
        format!("visibility: {}", artifact.visibility),
        format!(
            "created: {}",
            artifact.created_at.as_deref().unwrap_or("unknown")
        ),
        format!(
            "updated: {}",
            artifact.updated_at.as_deref().unwrap_or("unknown")
        ),
        format!("path: /artifacts/{}", artifact.id),
        format!("versions: {}", versions.len()),
    ];
    if versions.is_empty() {
        lines.push("No versions available.".to_string());
    } else {
        lines.extend(versions.iter().map(format_artifact_version));
    }
    lines.join("\n")
}

fn format_artifact_version(version: &ApiArtifactVersion) -> String {
    format!(
        "- v{} {} [{}] artifact={} file={} size={} created={}",
        version
            .version
            .map(|value| value.to_string())
            .unwrap_or_else(|| "?".to_string()),
        version.filename.as_deref().unwrap_or("unnamed"),
        version.mime_type.as_deref().unwrap_or("unknown"),
        version.artifact_id.as_deref().unwrap_or("unknown"),
        version.file_id.as_deref().unwrap_or("none"),
        version
            .size_bytes
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        version.created_at.as_deref().unwrap_or("unknown")
    )
}

fn select_current_version(
    artifact: &ApiArtifact,
    versions: Vec<ApiArtifactVersion>,
) -> Option<ApiArtifactVersion> {
    if let Some(current_version_id) = artifact.current_version_id.as_deref() {
        if let Some(version) = versions
            .iter()
            .find(|version| version.id == current_version_id)
            .cloned()
        {
            return Some(version);
        }
    }
    versions.into_iter().next()
}

fn default_download_filename(artifact: &ApiArtifact, version: &ApiArtifactVersion) -> String {
    let raw = version
        .filename
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&artifact.title);
    let sanitized = sanitize_filename(raw);
    if sanitized.is_empty() {
        format!("{}.artifact", sanitize_filename(&artifact.id))
    } else {
        sanitized
    }
}

fn sanitize_filename(value: &str) -> String {
    value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '\0' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string()
}

fn write_new_file(path: &PathBuf, bytes: &[u8]) -> Result<(), RuntimeError> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artifact() -> ApiArtifact {
        ApiArtifact {
            id: "artifact/id".to_string(),
            title: " ../report:name\u{0}.txt ".to_string(),
            artifact_type: "DOCUMENT".to_string(),
            status: "READY".to_string(),
            visibility: "PRIVATE".to_string(),
            created_at: None,
            updated_at: None,
            current_version_id: Some("version-2".to_string()),
            current_version: None,
        }
    }

    fn version(id: &str, filename: Option<&str>) -> ApiArtifactVersion {
        ApiArtifactVersion {
            id: id.to_string(),
            artifact_id: Some("artifact/id".to_string()),
            version: None,
            file_id: None,
            filename: filename.map(ToOwned::to_owned),
            mime_type: None,
            size_bytes: None,
            created_at: None,
        }
    }

    #[test]
    fn artifact_helpers_cover_required_id_login_detail_and_version_selection() {
        assert_eq!(
            required_artifact_id(Some(" artifact-1 ")).unwrap(),
            "artifact-1"
        );
        assert!(required_artifact_id(Some(" ")).is_err());
        assert!(required_artifact_id(None).is_err());

        let login = artifact_login_required();
        assert_eq!(login.title, "Artifacts");
        assert!(!login.handled);
        assert!(login.message.contains("Login required"));

        let detail = format_artifact_detail(&artifact(), &[]);
        assert!(detail.contains("created: unknown"));
        assert!(detail.contains("updated: unknown"));
        assert!(detail.contains("No versions available."));

        let selected = select_current_version(
            &artifact(),
            vec![version("version-1", None), version("version-2", None)],
        )
        .expect("current version id should select matching version");
        assert_eq!(selected.id, "version-2");
        let fallback = select_current_version(&artifact(), vec![version("version-1", None)])
            .expect("missing current version should fall back to first version");
        assert_eq!(fallback.id, "version-1");
        assert!(select_current_version(&artifact(), Vec::new()).is_none());
    }

    #[test]
    fn artifact_helpers_cover_default_filename_and_sanitizing() {
        assert_eq!(
            sanitize_filename(" ../bad:name\u{0}.txt "),
            "_bad_name_.txt"
        );
        assert_eq!(sanitize_filename("...\t"), "_");

        let artifact = artifact();
        assert_eq!(
            default_download_filename(&artifact, &version("version-1", Some(" report.pdf "))),
            "report.pdf"
        );
        assert_eq!(
            default_download_filename(&artifact, &version("version-1", Some("..."))),
            "artifact_id.artifact"
        );
        assert_eq!(
            default_download_filename(&artifact, &version("version-1", None)),
            "_report_name_.txt"
        );
    }
}
